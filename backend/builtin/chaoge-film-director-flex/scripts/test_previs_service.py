"""Real local child startup/recovery/conflict tests; never changes login settings."""
import contextlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import previs_service as service


def wait_for(fn, timeout=25):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        value=fn()
        if value: return value
        time.sleep(.2)
    raise AssertionError('Timed out waiting for service state')


class ServiceTests(unittest.TestCase):
    def test_dead_supervisor_does_not_report_old_ready_snapshot(self):
        with tempfile.TemporaryDirectory(prefix='previs-status-') as tmp:
            root=Path(tmp)
            service.write_json(root/'status.json', {
                'supervisorPid': 123, 'updatedAt': time.time(),
                'projects': {'test': {'status': 'ready', 'pid': 456}}
            })
            status=service.runtime_status(root)
            self.assertFalse(status['supervisorRunning'])
            self.assertIsNone(status['supervisorPid'])
            self.assertEqual(status['projects']['test']['status'], 'stale_snapshot')
            self.assertIsNone(status['projects']['test']['pid'])

    def test_independent_launch_keeps_original_storage_environment(self):
        with tempfile.TemporaryDirectory(prefix='previs-data-') as tmp:
            root=Path(tmp); original=root/'original-data'; original.mkdir()
            before=dict(os.environ)
            service.write_json(root/'runtime-environment.json', {'LOCALAPPDATA': str(original)})
            self.assertEqual(service.child_environment(root)['LOCALAPPDATA'], str(original))
            self.assertEqual(dict(os.environ), before)
            original.rmdir()
            with self.assertRaises(ValueError):
                service.child_environment(root)

    def test_start_recovery_duplicate_and_foreign_port(self):
        with tempfile.TemporaryDirectory(prefix='previs-service-') as tmp:
            base=Path(tmp); root=base/'runtime'; project=base/'project'
            (project/'scripts').mkdir(parents=True)
            (project/'scripts/previs-health.mjs').write_text('test')
            (project/'vite.config.ts').write_text('previsHealth')
            service.write_json(project/'scene-project.json', {'projectKey':'test-only'})
            cli=project/'node_modules/vinext/dist/cli.js';cli.parent.mkdir(parents=True)
            cli.write_text("""const http=require('http'),fs=require('fs');
const id=JSON.parse(fs.readFileSync('.chaoge-previs-service.json'));
http.createServer((req,res)=>res.end(JSON.stringify({service:'chaoge-previs',schema:1,...id})))
 .listen(Number(process.argv[process.argv.indexOf('--port')+1]),'127.0.0.1');""")
            foreign=socket.socket(); foreign.bind(('127.0.0.1',0));foreign.listen()
            port=foreign.getsockname()[1]
            entry=service.register(root,project,port)
            self.assertEqual(service.register(root,project,port)['serviceId'],entry['serviceId'])
            self.assertEqual(len(service.read_json(root/'registry.json')['projects']),1)
            runner=subprocess.Popen([sys.executable,str(Path(service.__file__)),'--data-root',str(root),'serve'],
                                    creationflags=0x08000000 if os.name=='nt' else 0)
            try:
                def status():
                    with contextlib.suppress(OSError,ValueError):
                        return service.read_json(root/'status.json',{}).get('projects',{}).get(entry['serviceId'],{})
                    return {}
                wait_for(lambda: status().get('status')=='port_conflict')
                self.assertIsNone(status()['pid'])
                self.assertEqual(service.inspect_service(entry),'port_conflict')
                foreign.close()
                wait_for(lambda: status().get('status')=='ready')
                first=status()['pid']; self.assertTrue(first)
                live=service.runtime_status(root)
                self.assertTrue(live['supervisorRunning'])
                self.assertTrue(live['snapshotFresh'])
                self.assertEqual(live['projects'][entry['serviceId']]['status'], 'ready')
                self.assertEqual(service.inspect_service({**entry,'serviceId':'0'*32}),'port_conflict')
                duplicate=subprocess.run([sys.executable,str(Path(service.__file__)),'--data-root',str(root),'serve'],timeout=8)
                self.assertEqual(duplicate.returncode,0)
                self.assertEqual(status()['pid'],first)
                if os.name=='nt': subprocess.run(['taskkill','/PID',str(first),'/T','/F'],capture_output=True,check=True,creationflags=0x08000000)
                else: os.kill(first,15)
                wait_for(lambda: status().get('status')=='ready' and status().get('pid')!=first)
                self.assertEqual(service.inspect_service(entry),'ready')
            finally:
                foreign.close();service.request_stop(root);runner.wait(timeout=10)
            self.assertEqual(service.inspect_service(entry),'offline')


if __name__=='__main__': unittest.main()
