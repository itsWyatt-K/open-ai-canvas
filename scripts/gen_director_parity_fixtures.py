#!/usr/bin/env python3
"""Generate Go parity fixtures for backend/internal/director from the
authoritative Python validator (chaoge-film-director-flex/scripts/validate_prompt.py).

The fixtures are rebuilt by importing that module and replaying the exact
transformations its self_test() performs, so the Go parity test can never drift
from the Python contract by transcription. Output: scripts/_out/director_parity_fixtures.json
(git-ignored scratch; the generated Go test embeds the fixture inline).
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "backend" / "builtin" / "chaoge-film-director-flex"
SPEC = importlib.util.spec_from_file_location("validate_prompt", SKILL / "scripts" / "validate_prompt.py")
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)

jimeng = """【本批上传ID映射】
| 提示词槽位 | 用户应上传的资产 | 当前准备状态 | 唯一职责 |
|---|---|---|---|
| 图1 | 客厅场景图 | 用户已有 | 锁定空间 |
| 音频1 | 艾玛干声 | 待用户准备 | 锁定音色 |

【风格锁定】
自然主义雪夜惊悚片，使用ARRI Alexa 35与Cooke电影镜头，21:9，24fps；冷暗低饱和，雪反冷光，真实木材与皮肤质感。
【素材映射】
@用于锁定客厅，绑定后简称“图1”。
@为艾玛声音，绑定后简称“音频1”。
【场景与空间锚点】
午夜客厅内，艾玛站在图1门边；门在画面右侧，走廊在画面左侧。
【声音与音乐总则】
使用音频1，无BGM。
【镜头序列】
镜头1（0.0—2.0秒｜近景）
机位与构图：头肩近景，摄影机位于艾玛正前方；焦点落在艾玛双眼，背景轻微虚化。
运镜：固定机位。
    画面内容：艾玛转头。艾玛（音频1，呼吸急促、低声而坚决）：“快走。”
镜头2（2.0—4.0秒｜中景）
机位与构图：腰部中景，摄影机位于艾玛侧面；焦点落在艾玛面部，背景走廊轻微虚化。
运镜：侧向跟拍。
画面内容：艾玛跑开。
【全局补充】
无字幕。"""

# Guard against transcription drift: the fixture above must be byte-identical
# to the one inside self_test().
source = (SKILL / "scripts" / "validate_prompt.py").read_text(encoding="utf-8")
start = source.index('jimeng = """') + len('jimeng = """')
end = source.index('"""', start)
assert source[start:end] == jimeng, "transcribed jimeng fixture drifted from validate_prompt.py"

libtv = jimeng.replace(
    "@用于锁定客厅，绑定后简称“图1”。\n@为艾玛声音，绑定后简称“音频1”。",
    "{{Image 1}}用于锁定客厅。\n{{Audio 1}}为艾玛声音。",
)
bad = jimeng.replace("@用于锁定客厅，绑定后简称“图1”。", "@图片1用于锁定客厅。")
over_15 = jimeng.replace("2.0—4.0秒", "2.0—16.0秒")
missing_voice = jimeng.replace(
    "@为艾玛声音，绑定后简称“音频1”。\n", ""
).replace("艾玛（音频1，呼吸急促、低声而坚决）", "艾玛低声说")
text_model_voice = jimeng.replace(
    "【本批上传ID映射】\n| 提示词槽位 | 用户应上传的资产 | 当前准备状态 | 唯一职责 |\n|---|---|---|---|\n| 图1 | 客厅场景图 | 用户已有 | 锁定空间 |\n| 音频1 | 艾玛干声 | 待用户准备 | 锁定音色 |\n\n",
    "",
).replace(
    "【素材映射】\n@用于锁定客厅，绑定后简称“图1”。\n@为艾玛声音，绑定后简称“音频1”。\n",
    "",
).replace("图1门边", "旧木屋客厅门边").replace(
    "使用音频1，无BGM。", "保留安静房间底噪，无BGM。"
).replace(
    "艾玛（音频1，呼吸急促、低声而坚决）",
    "艾玛（呼吸急促、语速稍快、低声而坚决）",
)
bad_text_image = text_model_voice.replace(
    "旧木屋客厅门边", "{{Image 1}}中的客厅门边"
)
jimeng_payload_length = len(module.extract_prompt_payload(jimeng, "new"))
at_limit = jimeng + ("x" * (module.MAX_VIDEO_PROMPT_CHARS - jimeng_payload_length))
over_limit = at_limit + "x"
bloated = jimeng.replace(
    "无字幕。",
    "严禁换脸。严禁换装。严禁跳轴。严禁新增人物。"
    "严禁改变光线。严禁改变道具。严禁改变空间。",
)

cases = [
    ("jimeng", jimeng, "jimeng", "new", "2.5", "mapped", "mapped_dry_voice", True),
    ("libtv", libtv, "libtv", "new", "2.5", "mapped", "mapped_dry_voice", True),
    ("bad-at-alias", bad, "jimeng", "new", "2.5", "mapped", "mapped_dry_voice", False),
    ("over-15s-on-2.0", over_15, "jimeng", "new", "2.0", "mapped", "mapped_dry_voice", False),
    ("missing-voice", missing_voice, "jimeng", "new", "2.5", "mapped", "mapped_dry_voice", False),
    ("text-model-voice", text_model_voice, "jimeng", "new", "2.5", "text", "model_voice", True),
    ("text-with-image-placeholder", bad_text_image, "libtv", "new", "2.5", "text", "model_voice", False),
    ("at-limit", at_limit, "jimeng", "new", "2.5", "mapped", "mapped_dry_voice", True),
    ("over-limit", over_limit, "jimeng", "new", "2.5", "mapped", "mapped_dry_voice", False),
]

report = {"jimeng": jimeng, "payloadLength": jimeng_payload_length, "cases": []}
for name, text, platform, mode, model_version, asset_mode, voice_mode, expected in cases:
    errors, warnings = module.validate(text, platform, mode, model_version, asset_mode, voice_mode)
    report["cases"].append({
        "name": name, "platform": platform, "mode": mode,
        "modelVersion": model_version, "assetMode": asset_mode, "voiceMode": voice_mode,
        "expected": expected, "errors": errors, "warnings": warnings,
    })
_, limit_warnings = module.validate(at_limit, "jimeng", "new", "2.5")
report["atLimitWarnings"] = limit_warnings
_, bloat_warnings = module.validate(bloated, "jimeng", "new", "2.5")
report["bloatWarnings"] = bloat_warnings

out = ROOT / "scripts" / "_out" / "director_parity_fixtures.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"wrote {out}")
for case in report["cases"]:
    status = "OK" if (not case["errors"]) == case["expected"] else "MISMATCH"
    print(f"[{status}] {case['name']}: ok={not case['errors']} expected={case['expected']} errors={len(case['errors'])} warnings={len(case['warnings'])}")
