#!/usr/bin/env python3
"""Read and reuse the local rigged mannequin library; never rebuild or overwrite its source."""
from __future__ import annotations
import argparse
import json
from pathlib import Path

DEFAULT_LIBRARY = Path.home() / 'Documents' / 'Chaoge角色库' / '角色库.json'

def read_library(path: Path) -> dict:
    if path.stat().st_size > 2_000_000:
        raise ValueError('角色库文件过大')
    data = json.loads(path.read_text(encoding='utf-8-sig'))
    if data.get('schema') == 'chaoge-actor-library/1' and data.get('rigVersion') == 1:
        return {'schema': 'chaoge-actor-library/1', 'rigVersion': 2, 'templates': []}
    if data.get('schema') != 'chaoge-actor-library/1' or data.get('rigVersion') != 2:
        raise ValueError('不兼容的角色库结构')
    items = data.get('templates')
    if not isinstance(items, list) or len(items) > 500:
        raise ValueError('角色原型列表无效')
    ids = set()
    for item in items:
        if not isinstance(item, dict):
            raise ValueError('原型无效')
        for key in ('id', 'name'):
            if not isinstance(item.get(key), str) or not 0 < len(item[key]) <= 160:
                raise ValueError('角色ID或名称无效')
        if item['id'] in ids:
            raise ValueError('角色ID重复')
        ids.add(item['id'])
        for key, lo, hi in [('height', .45, 2.3), ('build', .65, 1.5)]:
            value = item.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not lo <= value <= hi:
                raise ValueError('角色尺寸无效')
        if item.get('model') not in ('male', 'female', 'child', 'infant'):
            raise ValueError('旧人物原型已停用，请使用新版人体网格库')
        if item.get('kind') not in ('adult', 'child') or item.get('outfit') not in ('casual', 'coat', 'work') or item.get('pose') not in ('stand', 'alert', 'lean', 'walk', 'sit', 'recline', 'lie', 'side', 'idle', 'crouch'):
            raise ValueError('角色类型或姿势无效')
        import re
        if any(not isinstance(item.get(k), str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', item[k]) for k in ('color', 'skin')):
            raise ValueError('角色颜色无效')
    return data

def seed(project: Path, library: Path = DEFAULT_LIBRARY) -> Path:
    data = read_library(library)
    public = project.resolve() / 'public'
    if not public.is_dir():
        raise ValueError('请提供已有预演工程目录（含public）')
    target = public / 'actor-library.json'
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return target

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['list', 'seed'])
    parser.add_argument('project', nargs='?', type=Path)
    parser.add_argument('--library', type=Path, default=DEFAULT_LIBRARY)
    args = parser.parse_args()
    try:
        data = read_library(args.library)
        if args.action == 'seed':
            if args.project is None:
                raise ValueError('seed需要工程目录')
            print(seed(args.project, args.library))
        else:
            print(json.dumps({'path': str(args.library), 'templates': data['templates']}, ensure_ascii=False, indent=2))
    except (OSError, ValueError, TypeError) as exc:
        parser.exit(1, f'ERROR: {exc}\n')
    return 0
if __name__ == '__main__':
    raise SystemExit(main())
