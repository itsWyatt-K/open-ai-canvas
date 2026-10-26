"""Emit the approved native-chat two-column video gallery from installed media."""
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
import os as _os
from pathlib import Path as _Path
# 资产解析：包内 assets/ 优先；重资产（风格预置/预演模板/字体）外置时回退外置目录。
# 外置目录可用环境变量 CHAOGE_ASSETS_DIR 覆盖，默认 D:/AlcheMvision/nxf/_engine/assets/chaoge-v324。
CHAOGE_ASSETS_DIR = _Path(_os.environ.get("CHAOGE_ASSETS_DIR", r"D://AlcheMvision//nxf//_engine//assets//chaoge-v324"))

def _asset(*parts):
    """包内 assets/<parts> 存在则用之，否则回退 CHAOGE_ASSETS_DIR/<parts>。"""
    local = _Path(__file__).resolve().parents[1] / "assets" / _Path(*parts)
    return local if local.exists() else CHAOGE_ASSETS_DIR / _Path(*parts)



def render(root=ROOT):
    folder=_asset('style-presets')
    presets=json.loads((folder/'catalog.json').read_text(encoding='utf-8'))['presets']
    cells=[]
    for i,p in enumerate(presets,1):
        media=(folder/p.get('selection_preview',p['preview_video'])['file']).resolve(strict=True)
        cells.append(f"**{i}｜{p['name']}** ![{p['name']}]({media.as_posix()}){p['selection_caption']}<br><br>")
    lines=['| | | |','|---|---|---|']
    for i in range(0,len(cells),2):
        lines.append('| '+cells[i]+' | '+(cells[i+1] if i+1<len(cells) else '')+' | |')
    return '\n'.join(lines)+'\n\n回复 **1—6** 选择风格，随后进入十项剧本分析与全片情绪曲线图。\n'


if __name__=='__main__': print(render())
