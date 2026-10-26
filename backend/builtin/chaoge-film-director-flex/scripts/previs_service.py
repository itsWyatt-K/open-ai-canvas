"""User-scoped Windows startup and recovery for explicitly registered previs projects."""
from __future__ import annotations

import argparse
import contextlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import uuid
import traceback

RUN_NAME = 'ChaogePrevisSupervisor'
HEALTH_PATH = '/__previs/health'


def data_root() -> Path:
    return Path(os.environ.get('LOCALAPPDATA', Path.home() / '.local/share')) / 'Chaoge/PrevisService'


def read_json(path: Path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding='utf-8'))


def write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.replace(temp, path)


@contextlib.contextmanager
def file_lock(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a+b') as handle:
        handle.seek(0)
        if not handle.read(1):
            handle.write(b'0')
            handle.flush()
        handle.seek(0)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            handle.seek(0)
            if os.name == 'nt':
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def inspect_service(entry):
    # Bypass HTTP_PROXY: probes must never leave the local computer.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(f"http://127.0.0.1:{entry['port']}{HEALTH_PATH}", timeout=2) as response:
            value = json.loads(response.read(8192))
        if (value.get('service') == 'chaoge-previs' and value.get('schema') == 1
                and value.get('serviceId') == entry['serviceId']
                and value.get('projectKey') == entry['projectKey']):
            return 'ready'
    except (OSError, ValueError):
        pass
    with socket.socket() as sock:
        sock.settimeout(.3)
        return 'port_conflict' if sock.connect_ex(('127.0.0.1', entry['port'])) == 0 else 'offline'


def register(root: Path, project: Path, port: int, node: str | None = None):
    project = project.resolve(strict=True)
    metadata = read_json(project / 'scene-project.json')
    if not isinstance(metadata, dict) or not metadata.get('projectKey'):
        raise ValueError('工程缺少 scene-project.json / projectKey')
    plugin = project / 'scripts/previs-health.mjs'
    config = project / 'vite.config.ts'
    if not plugin.is_file() or not config.is_file() or 'previsHealth' not in config.read_text(encoding='utf-8'):
        raise ValueError('先为此工程接入 scripts/previs-health.mjs 和 previsHealth() 插件')
    cli = project / 'node_modules/vinext/dist/cli.js'
    if not cli.is_file():
        raise ValueError('此工程尚未安装锁文件对应依赖；先完成 npm ci')
    node = node or shutil.which('node')
    if not node:
        raise ValueError('未找到 Node，请先安装 Node >=22.13')
    node = str(Path(node).resolve())
    version = subprocess.check_output([node, '--version'], text=True, creationflags=0x08000000 if os.name == 'nt' else 0).strip()
    parts = tuple(int(x) for x in version.lstrip('v').split('.')[:2])
    if parts < (22, 13):
        raise ValueError('预演服务需要 Node >=22.13')
    if not 1024 <= port <= 65535:
        raise ValueError('固定端口必须位于1024—65535')
    with file_lock(root / 'registry.lock'):
        registry = read_json(root / 'registry.json', {'schema': 1, 'projects': []})
        others = [x for x in registry['projects'] if Path(x['project']).resolve() != project]
        if any(x['port'] == port for x in others):
            raise ValueError('此固定端口已登记给其他工程；不会更改旧工程地址')
        service_file = project / '.chaoge-previs-service.json'
        identity = read_json(service_file, {})
        if identity and identity.get('projectKey') != metadata['projectKey']:
            raise ValueError('服务身份与工程不一致；请核对，不能覆盖已有身份')
        entry = {'project': str(project), 'projectKey': metadata['projectKey'], 'port': port,
                 'serviceId': identity.get('serviceId') or uuid.uuid4().hex, 'node': node, 'enabled': True}
        write_json(service_file, {'schema': 1, 'serviceId': entry['serviceId'], 'projectKey': entry['projectKey'], 'port': port})
        registry['projects'] = others + [entry]
        write_json(root / 'registry.json', registry)
    return entry


def stop_child(child):
    # Only a Popen created by this supervisor can reach this function.
    if child.poll() is not None:
        return
    if os.name == 'nt':
        subprocess.run(['taskkill', '/PID', str(child.pid), '/T', '/F'], capture_output=True,
                       creationflags=0x08000000, timeout=15)
    else:
        child.terminate()
    with contextlib.suppress(subprocess.TimeoutExpired):
        child.wait(timeout=10)


def supervise(root: Path, interval: float = 2):
    with contextlib.ExitStack() as stack:
        try:
            stack.enter_context(file_lock(root / 'supervisor.lock'))
        except OSError as exc:
            if getattr(exc, 'errno', None) in (13, 11):
                return
            raise
        (root / 'stop.request').unlink(missing_ok=True)
        children, states, retry_at, failures, started_at = {}, {}, {}, {}, {}
        try:
            while not (root / 'stop.request').exists():
                registry = read_json(root / 'registry.json', {'projects': []})
                enabled = {x['serviceId']: x for x in registry['projects'] if x.get('enabled')}
                for key in list(children):
                    if key not in enabled:
                        stop_child(children.pop(key))
                for key, entry in enabled.items():
                    now = time.time()
                    child = children.get(key)
                    if child and child.poll() is not None:
                        failures[key] = failures.get(key, 0) + 1
                        retry_at[key] = now + min(60, 2 ** min(failures[key], 6))
                        del children[key]
                        child = None
                    health = inspect_service(entry)
                    if health == 'ready':
                        failures[key] = 0
                        states[key] = {}
                    elif child:
                        health = 'starting'
                        # A listening socket alone is never considered a ready project.
                        if now - started_at[key] > 180:
                            stop_child(child)
                            health = 'startup_failed'
                    elif health == 'offline' and now >= retry_at.get(key, 0):
                        try:
                            project = Path(entry['project'])
                            identity = read_json(project / '.chaoge-previs-service.json', {})
                            if identity.get('serviceId') != key or identity.get('projectKey') != entry['projectKey']:
                                raise ValueError('工程服务身份不一致')
                            log = root / 'logs' / (key + '.log')
                            log.parent.mkdir(parents=True, exist_ok=True)
                            if log.exists() and log.stat().st_size > 8_000_000:
                                log.replace(log.with_suffix('.previous.log'))
                            with log.open('ab') as output:
                                environment = child_environment(root)
                                child = subprocess.Popen([
                                    entry['node'], str(project / 'node_modules/vinext/dist/cli.js'),
                                    'dev', '--hostname', '127.0.0.1', '--port', str(entry['port']),
                                ], cwd=project, env=environment, stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                                   creationflags=0x08000000 | 0x00000200 if os.name == 'nt' else 0)
                            children[key] = child
                            started_at[key] = now
                            health = 'starting'
                        except (OSError, ValueError) as exc:
                            health = 'startup_failed'
                            states[key] = {'error': str(exc)}
                            retry_at[key] = now + 60
                    states[key] = {**states.get(key, {}), 'status': health, 'port': entry['port'],
                                   'projectKey': entry['projectKey'], 'pid': child.pid if child and child.poll() is None else None,
                                   'url': f"http://127.0.0.1:{entry['port']}/"}
                write_json(root / 'status.json', {'schema': 1, 'supervisorPid': os.getpid(), 'updatedAt': time.time(),
                                               'projects': {k: states[k] for k in enabled}})
                time.sleep(interval)
        finally:
            for child in children.values():
                stop_child(child)
            write_json(root / 'status.json', {'schema': 1, 'supervisorPid': None, 'updatedAt': time.time(), 'projects': {}})
            (root / 'stop.request').unlink(missing_ok=True)


def request_stop(root: Path):
    root.mkdir(parents=True, exist_ok=True)
    (root / 'stop.request').write_text('stop', encoding='ascii')
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        try:
            with file_lock(root / 'supervisor.lock'):
                return
        except OSError:
            time.sleep(.2)
    raise RuntimeError('后台服务尚未退出；未强制终止未知进程')


def child_environment(root: Path):
    result = dict(os.environ)
    pinned = read_json(root / 'runtime-environment.json', {})
    if 'LOCALAPPDATA' in pinned:
        directory = Path(pinned['LOCALAPPDATA'])
        if not directory.is_absolute() or not directory.is_dir():
            raise ValueError('已登记的本机数据目录不可用，未改用空目录')
        result['LOCALAPPDATA'] = str(directory)
    return result


def windows_task(root: Path, action: str):
    powershell = Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
    result = subprocess.run([str(powershell), '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                             '-File', str(root / 'previs_windows_task.ps1'), '-Action', action,
                             '-Config', str(root / 'task-launch.json')],
                            capture_output=True, text=True, encoding='utf-8', errors='replace',
                            creationflags=0x08000000, timeout=40)
    if result.returncode:
        raise RuntimeError('Windows独立启动失败，未回退到Codex子进程：' + result.stderr.strip())
    return json.loads(result.stdout.lstrip('\ufeff'))


def remove_legacy_run(root: Path):
    import winreg
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Run') as key:
        with contextlib.suppress(FileNotFoundError):
            old, _ = winreg.QueryValueEx(key, RUN_NAME)
            if str(root / 'previs_service.py').lower() not in old.lower():
                raise ValueError('旧登录项指向其他程序，未删除')
            winreg.DeleteValue(key, RUN_NAME)


def runtime_status(root: Path):
    result = read_json(root / 'status.json', {})
    fresh = time.time() - result.get('updatedAt', 0) < 15
    try:
        with file_lock(root / 'supervisor.lock'):
            running = False
    except OSError:
        running = True
    result['supervisorRunning'] = running
    result['snapshotFresh'] = fresh
    if not running or not fresh:
        result['supervisorPid'] = None
        for state in result.get('projects', {}).values():
            state['status'] = 'stale_snapshot'
            state['pid'] = None
    return result


def install(root: Path):
    if os.name != 'nt':
        raise ValueError('此自动登录启动入口仅支持Windows；其他系统仍可手动启动预演')
    root.mkdir(parents=True, exist_ok=True)
    installed = root / 'previs_service.py'
    source = Path(__file__).resolve()
    pythonw = Path(sys.executable).with_name('pythonw.exe')
    if not pythonw.is_file():
        raise ValueError('当前Python没有pythonw.exe；无法保证后台无窗口启动')
    helper = source.with_name('previs_windows_task.ps1')
    if not helper.is_file():
        raise ValueError('缺少Windows独立启动脚本，请恢复完整Skill')
    changed = not installed.exists() or source.read_bytes() != installed.read_bytes()
    if changed:
        request_stop(root)
        if installed.exists():
            shutil.copy2(installed, root / 'previs_service.previous.py')
        shutil.copy2(source, installed)
    target = root / helper.name
    if helper.resolve() != target.resolve():
        shutil.copy2(helper, target)
    write_json(root / 'task-launch.json', {'root': str(root), 'pythonw': str(pythonw),
               'arguments': subprocess.list2cmdline([str(installed), '--data-root', str(root), 'serve'])})
    # MSIX-launched tools can see a virtualized LOCALAPPDATA. Pin its physical
    # Chaoge directory before moving the process to the Windows scheduler.
    environment_file = root / 'runtime-environment.json'
    if not environment_file.exists():
        shared = Path(os.environ['LOCALAPPDATA']) / 'Chaoge'
        shared.mkdir(parents=True, exist_ok=True)
        write_json(environment_file, {'LOCALAPPDATA': str(shared.resolve().parent)})
    # Schedule.Service starts the process outside the caller's kill-on-close Job.
    # CREATE_NO_WINDOW / DETACHED_PROCESS alone do NOT remove that membership.
    result = windows_task(root, 'install')
    remove_legacy_run(root)
    return {'startup_registered': True, **result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-root', type=Path, default=data_root())
    commands = parser.add_subparsers(dest='command', required=True)
    add = commands.add_parser('register')
    add.add_argument('project', type=Path)
    add.add_argument('--port', required=True, type=int)
    add.add_argument('--node')
    add.add_argument('--autostart', action='store_true')
    commands.add_parser('install')
    commands.add_parser('serve')
    commands.add_parser('status')
    commands.add_parser('stop')
    commands.add_parser('disable')
    args = parser.parse_args()
    root = args.data_root.resolve()
    if args.command == 'register':
        result = register(root, args.project, args.port, args.node)
        if args.autostart:
            result['startup'] = install(root)
    elif args.command == 'install':
        result = install(root)
    elif args.command == 'serve':
        supervise(root)
        return
    elif args.command == 'status':
        registry = read_json(root / 'registry.json', {'projects': []})
        result = {'runtime': runtime_status(root),
                  'projects': [{**x, 'health': inspect_service(x)} for x in registry['projects']]}
    else:
        if args.command == 'disable' and os.name == 'nt':
            if (root / 'task-launch.json').is_file():
                windows_task(root, 'disable')
            remove_legacy_run(root)
        request_stop(root)
        result = {'stopped': True, 'startup_disabled': args.command == 'disable'}
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        # pythonw has no console; retain failures for diagnosis and return nonzero
        # so Windows can restart the supervisor, including unexpected failures.
        with contextlib.suppress(Exception):
            location = Path(sys.argv[sys.argv.index('--data-root') + 1]) if '--data-root' in sys.argv else data_root()
            location.mkdir(parents=True, exist_ok=True)
            with (location / 'supervisor.log').open('a', encoding='utf-8') as log:
                log.write(time.strftime('%Y-%m-%d %H:%M:%S') + '\n' + traceback.format_exc() + '\n')
        if sys.stderr:
            print(f'ERROR: {exc}', file=sys.stderr)
        raise SystemExit(1)
