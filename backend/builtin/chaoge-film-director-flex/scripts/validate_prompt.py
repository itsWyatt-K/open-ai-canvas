#!/usr/bin/env python3
"""Validate Flagship prompt structure, references and optional execution context."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


MAX_VIDEO_PROMPT_CHARS = 6500
SOFT_VIDEO_PROMPT_CHARS = 5200
SUNO_SECTION = "Suno BGM备用提示词"
SCENE_REFERENCE_BOUNDARY = "本批场景图仅参考环境与氛围，不继承原图的空间结构、拍摄方向、焦段、透视、景别与构图；最终镜头以本提示词为准。"
SCENE_SHAPE_BOUNDARY = re.compile(
    r"本批场景图参考环境与氛围；[^。\n]+仅另参考已确认的[^。\n]+，"
    r"其余空间结构不继承，拍摄方向、焦段、透视、景别与构图不继承；最终镜头以本提示词为准。"
)
GENERATION_INFO_PATTERN = re.compile(
    r"(?m)^\s*【本段生成信息】\s*Seedance\s*(2\.[05])\s*｜\s*"
    r"叙事时长\s*(\d+(?:\.\d+)?)\s*秒\s*｜\s*"
    r"站位交接\s*(\d+(?:\.\d+)?)\s*秒\s*｜\s*"
    r"总时长\s*(\d+(?:\.\d+)?)\s*秒\s*｜\s*独立生成[。.]?\s*$"
)
PROMPT_META_LINE_PATTERN = re.compile(
    r"(?mi)^\s*(?:【本段生成信息】|"
    r"Seedance\s*2\.[05]\s*[｜|].*(?:叙事时长|总时长|独立生成)|"
    r"(?:叙事时长|生成总时长|总生成时长|总时长)\s*[：:]\s*\d|"
    r"独立生成[。.]?\s*$)"
)

ORDERED_SECTIONS = [
    "风格锁定",
    "素材映射",
    "场景与空间锚点",
    "镜头序列",
    "站位交接镜头",
    "声音设计",
    "全局补充",
]
RETIRED_SECTIONS = {
    "场景空间与动作轴", "第一帧与人物站位", "正向连续性锁定",
    "连续时间轴",
}
FORM_SECTIONS = {
    "shots": ["镜头序列"],
    "one_take": ["一镜到底执行声明", "起手式", "连续动作过程", "最终镜头落点"],
    "combat": ["起手式", "打斗过程", "结束状态"],
}
ORDERED_SECTIONS = list(dict.fromkeys(ORDERED_SECTIONS + [
    name for names in FORM_SECTIONS.values() for name in names
] + ["特效与运镜"]))
TOP_LEVEL = set(ORDERED_SECTIONS) | RETIRED_SECTIONS | {SUNO_SECTION}


def section_span(text: str, name: str) -> tuple[int, int] | None:
    match = re.search(rf"【{re.escape(name)}】", text)
    if not match:
        return None
    tail = text[match.end() :]
    following = re.search(r"\n【[^】\n]+】", tail)
    end = match.end() + following.start() if following else len(text)
    return match.start(), end


def section_text(text: str, name: str) -> str:
    span = section_span(text, name)
    return text[span[0] : span[1]] if span else ""


def prompt_payload(text: str) -> str:
    marker = "【风格锁定】"
    start = text.find(marker)
    payload = text[start:] if start >= 0 else text
    suno_start = payload.find(f"【{SUNO_SECTION}】")
    if suno_start >= 0:
        payload = payload[:suno_start]
    return payload.strip()


def video_prompt_fence(text: str) -> tuple[str, tuple[int, int]] | None:
    """Return the fenced code block that contains the actual video prompt."""
    for match in re.finditer(
        r"```(?:text)?[ \t]*\r?\n(.*?)```", text, re.DOTALL | re.IGNORECASE
    ):
        if "【风格锁定】" in match.group(1):
            return match.group(1).strip(), match.span()
    return None


def external_mapping_slots(text: str) -> set[tuple[str, int]]:
    """Read 图/音频/视频 slots from the delivery table before the prompt body."""
    head = text.split("【风格锁定】", 1)[0]
    return {
        (kind, int(number))
        for kind, number in re.findall(r"\|\s*(图|音频|视频)\s*(\d+)\s*\|", head)
    }


def internal_mapping_slots(mapping: str, platform: str) -> set[tuple[str, int]]:
    kinds = {"Image": "图", "Audio": "音频", "Video": "视频"}
    if platform == "libtv":
        return {
            (kinds[kind], int(number))
            for kind, number in re.findall(
                r"\{\{(Image|Audio|Video)\s+(\d+)\}\}", mapping
            )
        }
    return {
        (kind, int(number))
        for kind, number in re.findall(
            r"(?:简称[“\"]?)?(图|音频|视频)\s*(\d+)", mapping
        )
    }


def contiguous_slot_errors(
    slots: set[tuple[str, int]], scope: str
) -> list[str]:
    """Require visual, audio, and video slot sequences to restart at 1 without gaps."""
    errors: list[str] = []
    labels = {"图": "图片", "音频": "音频", "视频": "视频"}
    for kind in ("图", "音频", "视频"):
        numbers = sorted(number for slot_kind, number in slots if slot_kind == kind)
        if not numbers:
            continue
        expected = list(range(1, max(numbers) + 1))
        if numbers == expected:
            continue
        missing = sorted(set(expected) - set(numbers))
        missing_text = "、".join(f"{kind}{number}" for number in missing)
        detail = f"缺少{missing_text}" if missing_text else f"当前编号为{numbers}"
        errors.append(
            f"{scope}{labels[kind]}槽位必须从1连续编号且不得留空号（{detail}）；"
            "素材增删或替换后须按最终清单整体重排所属类别"
        )
    return errors


def has_normal_scene_mapping(mapping: str) -> bool:
    """A normal scene image is a mood/environment reference, not a start/continuity frame."""
    for line in mapping.splitlines():
        if SCENE_REFERENCE_BOUNDARY in line or "场景" not in line:
            continue
        if not re.search(r"@|\{\{Image\s+\d+\}\}|图\s*\d+", line):
            continue
        if re.search(r"起始帧|首帧|连续性帧|站位帧", line):
            continue
        return True
    return False



def boundary_lines(mapping: str) -> list[str]:
    """Recognize a short boundary structurally; its precise meaning needs cold reading."""
    return [line.strip() for line in mapping.splitlines()
            if not re.search(r"@|\{\{(?:Image|Audio|Video)\s+\d+\}\}|(?:图|音频|视频)\s*\d+", line)
            and re.search(r"场景图|原图|参考图", line)
            and re.search(r"参考|继承|沿用", line)]


def mapping_entries(mapping: str, platform: str) -> dict[tuple[str, int], str]:
    entries = {}
    for line in mapping.splitlines():
        if platform == "libtv":
            match = re.search(r"\{\{(Image|Audio|Video)\s+(\d+)\}\}", line)
            if not match:
                continue
            kind = {"Image": "图", "Audio": "音频", "Video": "视频"}[match[1]]
            tail = line[match.end():]
        else:
            match = re.search(r"(图|音频|视频)\s*(\d+)", line)
            if not match:
                continue
            kind = match[1]
            tail = line[match.end():] if platform != "jimeng" else line.lstrip("@ ")
        tail = re.split(r"[，,]?\s*绑定后", tail)[0]
        tail = re.sub(r"^(?:作为|是|为|用于指定|用于)\s*", "", tail).strip()
        tail = re.sub(r"(?:视觉|音色|环境|色彩)锚定[。.]?$", "", tail).strip()
        tail = re.sub(r"^(?:人物|角色|场景|道具|声音|连续性参考)\s*[：:]?\s*", "", tail).strip()
        tail = re.sub(r"(?:的)?(?:角色声音|声音|场景)[。.]?$", "", tail).strip(" 。.")
        entries[(kind, int(match[2]))] = tail
    return entries


def dialogue_lines(sequence: str) -> list[tuple[str, str, str]]:
    """Canonical named dialogue, quoted or unquoted; unknown prose needs semantic review."""
    pattern = r"(?m)^\s*([^\n：:（）()，。！？|]{1,40})\s*(?:[（(]([^）)\n]*)[）)])?\s*[：:]\s*([^\n]+)"
    return [(m[1].strip(), m[2] or "", m[3].strip()) for m in re.finditer(pattern, sequence)
            if not re.fullmatch(r"\d+(?:\.\d+)?\s*秒\s*[—–\-~至到]+\s*\d+(?:\.\d+)?\s*秒", m[1].strip())]


def spoken_text_removed(text: str) -> str:
    text = re.sub(r"(?m)^([^\n：:（）()，。！？|]{1,40})(?:[（(][^）)\n]*[）)])?[：:][^\n]+", "", text)
    return re.sub(r'“[^”]*”|「[^」]*」|"[^"]*"', "", text)


def has_micro_timing(body: str) -> bool:
    """Detect timing instructions, excluding quoted dialogue and other units."""
    prose = spoken_text_removed(body)
    return bool(re.search(
        r"\d{1,2}:\d{2}(?:\.\d+)?|"
        r"(?:\d+(?:\.\d+)?|[零一二两三四五六七八九十半]+)\s*秒",
        prose,
    ))


COMBAT_PHASE_HEADER = re.compile(
    r"(?m)^[ \t]*(?:阶段\s*(\d+)\s*[（(]\s*(\d+(?:\.\d+)?)\s*"
    r"[—–\-~至到]+\s*(\d+(?:\.\d+)?)\s*秒\s*｜[^）)\n]+[）)]|"
    r"(\d+(?:\.\d+)?)\s*秒\s*[—–\-~至到]+\s*"
    r"(\d+(?:\.\d+)?)\s*秒\s*[：:])[ \t]*"
)


def combat_phases(process: str) -> tuple[list[tuple[float, float]], list[str]]:
    """Read phase budgets; camera cuts inside a phase are not extra beat IDs."""
    headers = list(COMBAT_PHASE_HEADER.finditer(process))
    errors: list[str] = []
    numbered = [int(m[1]) for m in headers if m[1] is not None]
    if numbered and (len(numbered) != len(headers) or numbered != list(range(1, len(headers) + 1))):
        errors.append("打斗阶段须统一标题写法；使用阶段编号时从1连续排列")
    times = [(float(m[2] or m[4]), float(m[3] or m[5])) for m in headers]
    for i, (match, (start, end)) in enumerate(zip(headers, times)):
        stop = headers[i + 1].start() if i + 1 < len(headers) else len(process)
        if not process[match.end():stop].strip():
            errors.append(f"打斗阶段{i + 1}缺少攻防与结果正文")
        if end <= start:
            errors.append(f"打斗阶段{i + 1}结束时间须大于开始时间")
        if (i == 0 and abs(start) > 0.05) or (i and abs(start - times[i - 1][1]) > 0.05):
            errors.append("打斗阶段时间须从0开始连续衔接，不得重叠或留空")
    return times, errors


def validate(
    text: str,
    platform: str,
    model_version: str = "2.5",
    asset_mode: str = "mapped",
    bgm_mode: str = "none",
    handoff_mode: str = "on",
    delivery_kind: str = "initial",
    state_text: str | None = None,
    suno_action: str = "none",
) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    if bgm_mode != "none" or suno_action != "none":
        errors.append("视频生成统一无BGM；旧音乐模式须迁移，成片配乐走独立后期入口")
    state = fields = None
    if state_text is not None:
        from validate_ledger import validate as validate_record, parse_frontmatter
        from workflow_state import parse_execution
        state_errors, state_warnings = validate_record(state_text)
        errors.extend("项目状态：" + item for item in state_errors)
        warnings.extend("项目状态：" + item for item in state_warnings)
        try:
            state, fields = parse_execution(state_text), parse_frontmatter(state_text)
            unit = state["unit"]
            expected_platform = {"即梦": "jimeng", "LibTV": "libtv", "其他": "other", "generic": "other"}.get(fields["platform"], fields["platform"])
            actual_platform = "other" if platform == "generic" else platform
            for ok, label in (
                (expected_platform == actual_platform, "平台"),
                (fields["model_version"] == "Seedance " + model_version, "模型版本"),
                (fields["batch_material_mode"] == asset_mode, "素材方式"),
                (unit["bgm_mode"] == bgm_mode, "BGM模式"),
                (unit["handoff_mode"] == handoff_mode, "交接选择"),
                (fields["current_stage"] in {"P4", "P5", "P6", "P7"}, "编译阶段"),
            ):
                if not ok:
                    errors.append("本次交付与项目记录不一致：" + label)
            suno_action = unit["music"]["action"]
            if state_errors:
                state = None
        except (ValueError, KeyError, TypeError):
            errors.append("项目执行状态缺少本次编译上下文")
            state = None
    else:
        warnings.append("未传--state：仅检查孤立文本，不代表实际素材或流程门禁通过")
    payload = prompt_payload(text)
    fenced_prompt = video_prompt_fence(text)
    prompt_block = fenced_prompt[0] if fenced_prompt else payload
    delivery_without_prompt = text
    if fenced_prompt:
        start, end = fenced_prompt[1]
        delivery_without_prompt = text[:start] + text[end:]
        if re.search(r"```", delivery_without_prompt):
            errors.append("视频交付仅保留一个完整视频提示词代码块，不附音乐代码块")
    if re.search(r"BGM建议|BGM启用|是否[^。\n]*(?:BGM|背景音乐|配乐)|建议[^。\n]*(?:BGM|背景音乐|配乐)", delivery_without_prompt, re.I):
        errors.append("视频流程不得附加BGM建议或需求问答")
    generation_info = GENERATION_INFO_PATTERN.search(delivery_without_prompt)
    complete_delivery = bool(
        fenced_prompt
        or "【本批上传ID映射】" in text
        or "本批无需上传素材" in text
    )
    if complete_delivery and not generation_info:
        errors.append("视频提示词交付缺少代码块外的【本段生成信息】")
    if not prompt_block.lstrip().startswith("【风格锁定】"):
        errors.append("视频提示词代码块的第一个非空行必须是【风格锁定】")
    if PROMPT_META_LINE_PATTERN.search(prompt_block):
        errors.append("Seedance版本、叙事时长、总时长和独立生成必须放在视频提示词代码块外")

    count = len(prompt_block)
    if count > MAX_VIDEO_PROMPT_CHARS:
        errors.append(f"提示词正文{count}字符，超过{MAX_VIDEO_PROMPT_CHARS}字符硬上限")
    elif count > SOFT_VIDEO_PROMPT_CHARS:
        warnings.append(f"提示词正文{count}字符，超过{SOFT_VIDEO_PROMPT_CHARS}字符常规目标")

    form = ("one_take" if "【一镜到底执行声明】" in prompt_block else
            "combat" if "【打斗过程】" in prompt_block else "shots")
    required = ["风格锁定", "场景与空间锚点"]
    if form == "combat" and "【特效与运镜】" in prompt_block:
        required.append("特效与运镜")
    required.extend(FORM_SECTIONS[form])
    allowed = set(required) | {"素材映射", "站位交接镜头", "声音设计", "全局补充"}
    if handoff_mode == "on":
        required.append("站位交接镜头")
    required.extend(["声音设计", "全局补充"])
    for name in RETIRED_SECTIONS:
        if f"【{name}】" in prompt_block:
            errors.append(f"已退役栏目：【{name}】；请按当前叙事形式归位")
    headings = re.findall(r"(?m)^【([^】]+)】", prompt_block)
    if len(headings) != len(set(headings)):
        errors.append("视频提示词栏目不得重复")
    for name in headings:
        if name not in allowed:
            errors.append(f"当前{form}形式不允许栏目：【{name}】")
    mapping = section_text(text, "素材映射")
    if asset_mode in {"mapped", "hybrid"}:
        required.insert(1, "素材映射")
    for name in required:
        if f"【{name}】" not in prompt_block:
            errors.append(f"缺少栏目：【{name}】")
        elif not section_text(prompt_block, name).replace(f"【{name}】", "").strip():
            errors.append(f"栏目内容为空：【{name}】")

    normal_scene_mapping = has_normal_scene_mapping(mapping)
    boundaries = boundary_lines(mapping)
    boundary_count = len(boundaries)
    if normal_scene_mapping and boundary_count > 1:
        errors.append("本批映射普通场景图时，【素材映射】兼容旧稿的场景图职责边界不得重复")
    if not normal_scene_mapping and boundary_count:
        errors.append("纯文字、无普通场景图或仅起始帧/连续性帧时不得添加场景图职责边界")

    style = section_text(text, "风格锁定")
    if style:
        style_content = re.sub(r"^\s*【风格锁定】\s*", "", style).strip()
        style_paragraphs = [
            item.strip()
            for item in re.split(r"\n\s*\n", style_content)
            if item.strip()
        ]
        if len(style_paragraphs) != 2:
            errors.append("【风格锁定】必须严格写成两个自然段：视觉风格；成像、光线、影调与禁止项")
        reference_paragraph = style_paragraphs[0] if style_paragraphs else ""
        look_paragraph = style_paragraphs[1] if len(style_paragraphs) > 1 else ""
        film_titles = re.findall(r"《[^》]{1,80}》", style_content)
        if len(film_titles) > 1:
            errors.append("【风格锁定】最多保留1部已确认视觉参考影片；默认转译为可见特征")
        # Film names and visual semantics are not a closed keyword vocabulary.
        semantic_style = re.sub(r"《[^》]*》", "", style_content)
        if re.search(r"补充参考|声音参考|听觉借鉴|借鉴[^。；]*?(?:风声|脚步声|对白层级|音效|配乐|声场|混音)", semantic_style, re.IGNORECASE):
            errors.append("【风格锁定】不得加入补充声音影片或任何听觉借鉴；声音只进入【声音设计】")
        if not reference_paragraph or not look_paragraph:
            errors.append("风格锁定两段均需实际内容")
        # Camera/light/tone completeness is reviewed semantically, not by required jargon.
        overloaded_style_pattern = (
            r"国家|地域|地区|地点|发生在|故事|剧情|构图|运镜|镜头调度|逐镜焦段|"
            r"前景|后景|逐项资产清单"
        )
        if re.search(overloaded_style_pattern, semantic_style):
            warnings.append("【风格锁定】不得复述地点剧情、构图运镜或材质纹理清单；这些内容由其他栏目承担")
        if re.search(r"\b(?:16\s*:\s*9|9\s*:\s*16|21\s*:\s*9|\d+(?:\.\d+)?\s*:\s*1)\b|横屏|竖屏|横画幅|竖画幅", style):
            errors.append("【风格锁定】不得写画幅或横竖屏；画幅由用户作为项目设置单独选择")
        if re.search(r"\{\{\s*Mixed\s+\d+\s*\}\}|\[[^\]\n]*(?:待填写|占位|P1已确认|当前片段精确时间)[^\]\n]*\]", style, re.IGNORECASE):
            errors.append("【风格锁定】不得包含{{Mixed N}}或未解析模板占位符")

        from style_state import PRESETS, validate_preset_prompt
        profile = state.get('style_profile', {}) if isinstance(state, dict) else {}
        selected_id = profile.get('preset_id') if profile.get('source_kind') == 'preset' else None
        # A recorded custom/legacy style is not silently converted to a preset.
        # Standalone prompt checks can recognize the explicit public style name.
        if selected_id is None and not state_text:
            selected_id = next((p['id'] for p in PRESETS.values()
                                if p.get('prompt_rules') and
                                (style_content.startswith(p['name']) or
                                 style_content.startswith(p['prompt_rules'].get('video_style_prefix', '\0')))), None)
        errors.extend(validate_preset_prompt(prompt_block, selected_id, video_style=style_content))

    external_slots = external_mapping_slots(text)
    internal_slots = internal_mapping_slots(mapping, platform)
    errors.extend(contiguous_slot_errors(external_slots, "外部上传表"))
    errors.extend(contiguous_slot_errors(internal_slots, "【素材映射】"))
    if (delivery_kind == "initial" or external_slots) and external_slots != internal_slots:
        missing_inside = sorted(external_slots - internal_slots)
        missing_outside = sorted(internal_slots - external_slots)
        if missing_inside:
            errors.append(
                "上传表存在但【素材映射】缺失："
                + "、".join(f"{kind}{number}" for kind, number in missing_inside)
            )
        if missing_outside:
            errors.append(
                "【素材映射】存在但上传表缺失："
                + "、".join(f"{kind}{number}" for kind, number in missing_outside)
            )

    positions = [text.find(f"【{name}】") for name in required if f"【{name}】" in text]
    if positions != sorted(positions):
        errors.append("栏目顺序不符合模板")

    if asset_mode == "text" and re.search(r"\{\{Image\s+\d+\}\}|\b图\d+\b", mapping):
        errors.append("纯文字素材方式不得映射视觉图片")

    mapping_description_pattern = (
        r"外貌|骨相|五官|脸型|发型|肤色|体型|服装|穿着|声线|音色|年龄感|口音|气质|"
        r"装修|材质|固定地标|空间结构|光线关系|色温|摄影参数"
    )
    identity_mapping = "\n".join(line for line in mapping.splitlines() if line.strip() not in boundaries)
    if re.search(mapping_description_pattern, identity_mapping.replace("音色锚定", "声音锚定")):
        warnings.append("【素材映射】只能指定人物、场景、道具、声音或连续性参考的身份，不得复述外貌、服装、音色或场景资产描述")

    payload_mapping_span = section_span(payload, "素材映射")
    body_without_mapping = payload
    if payload_mapping_span:
        body_without_mapping = (
            payload[: payload_mapping_span[0]] + payload[payload_mapping_span[1] :]
        )
    visual_slot_alias_pattern = r"(?:图片|图)\s*\d+|Image\s*\d+|\{\{\s*Image\s+\d+\s*\}\}"
    if re.search(visual_slot_alias_pattern, body_without_mapping, re.IGNORECASE):
        errors.append("离开【素材映射】后，人物、场景和道具必须使用具体名称，不得出现图N/图片N/Image N视觉槽位编号")

    cardinal_pattern = r"东北|西北|东南|西南|东侧|西侧|南侧|北侧|东面|西面|南面|北面|东墙|西墙|南墙|北墙|向东|向西|向南|向北|正东|正西|正南|正北"
    if re.search(cardinal_pattern, spoken_text_removed(body_without_mapping)):
        errors.append("视频提示词不得使用东西南北；请转换为画面左右、前中后景、靠近/远离摄影机或上坡/下坡")

    mapping_span = section_span(text, "素材映射")
    outside = text
    if mapping_span:
        outside = text[: mapping_span[0]] + text[mapping_span[1] :]

    placeholders = re.compile(r"\{\{(?:Image|Audio|Video)\s+\d+\}\}")
    if platform == "jimeng":
        if placeholders.search(text):
            errors.append("即梦提示词不得出现LibTV占位符")
        if "@" in outside:
            errors.append("即梦的裸@只能出现在【素材映射】")
        if re.search(r"@(图片|图|音频|视频)\s*\d+", mapping):
            errors.append("即梦素材应使用裸@，不能写@图片1/@音频1")
    elif platform == "libtv":
        if "@" in text:
            errors.append("LibTV提示词不得出现即梦裸@")
        if placeholders.search(outside):
            errors.append("LibTV占位符只能出现在【素材映射】")
        if re.search(r"图\s*\d+\s*=", mapping):
            errors.append("LibTV素材映射禁止使用“图1=”前缀")
        seen = re.findall(r"\{\{(Image|Audio|Video)\s+(\d+)\}\}", mapping)
        if len(seen) != len(set(seen)):
            errors.append("每个LibTV素材占位符只能出现1次")
    else:
        if "@" in text or placeholders.search(text):
            errors.append("其他平台使用通用中文图号，不得出现@或{{Image/Audio/Video N}}占位符")
        if re.search(r"图\s*\d+\s*=", mapping):
            errors.append("其他平台通用映射应写“图1作为……锚定。”，不能写“图1=”")
        seen = re.findall(r"(?:^|\n)\s*(图|音频|视频)\s*(\d+)\s*(?:用于|作为)", mapping)
        if len(seen) != len(set(seen)):
            errors.append("其他平台每个中文图号只能映射1次")

    banned_context = {
        r"上一条(?:视频)?|上一段|上个批次|前一批": "提示词引用了模型不可见的上一批上下文",
        r"\bU\d{2}\b|延续U\d+": "提示词引用了外部批次编号",
        r"全新生成|生成方式|延长任务|编辑任务": "提示词包含工作流生成模式元话语",
    }
    for pattern, message in banned_context.items():
        if re.search(pattern, payload, re.IGNORECASE):
            errors.append(message)

    sequence = "\n".join(section_text(prompt_block, name) for name in FORM_SECTIONS[form])
    if state is not None and state["unit"].get("prompt_form", "shots") != form:
        errors.append("提示词形式与当前已确认单元prompt_form不一致")
    if form == "shots":
        header_pattern = re.compile(
            r"镜头\s*(\d+)\s*[（(]\s*(\d+(?:\.\d+)?)\s*[—–\-~至到]+"
            r"\s*(\d+(?:\.\d+)?)\s*秒\s*｜\s*([^｜）)]+)\s*[）)]"
        )
        shots = list(header_pattern.finditer(sequence))
        if not shots:
            errors.append("【镜头序列】未检测到“镜头N（时间码｜简短拍摄策略）”格式")
        header_count = len(re.findall(r"镜头\s*\d+\s*[（(]", sequence))
        if header_count != len(shots):
            errors.append("镜头标题应只含完整时间范围与简短拍摄策略")
        if [int(m.group(1)) for m in shots] != list(range(1, len(shots) + 1)):
            errors.append("镜头编号必须从1连续排列")
        for index, match in enumerate(shots):
            end = shots[index + 1].start() if index + 1 < len(shots) else len(sequence)
            body = sequence[match.end():end].strip()
            if not body:
                errors.append(f"镜头{match.group(1)}缺少画面正文")
            if re.search(r"机位与构图：|运镜：|画面内容：", body):
                errors.append(f"镜头{match.group(1)}仍使用旧三字段，应改为连续导演段落")
            if has_micro_timing(body):
                errors.append(f"镜头{match.group(1)}镜内不得细分秒数；用动作因果衔接")
        # Semantic camera/acting/causality review belongs to the cold-read gate, not field quotas.
        timecodes = [(float(match.group(2)), float(match.group(3))) for match in shots]
        if state is not None:
            board = state["unit"]["storyboard"]
            if board.get("exception") is None:
                expected = board["shots"]
                expected_ids = [item["id"].lstrip("0") or "0" for item in expected]
                if [str(int(match.group(1))) for match in shots] != expected_ids:
                    errors.append("提示词镜号/镜序与已确认宫格不一致；同镜A/B不能新增切镜")
                expected_times = [(item["start"], item["end"]) for item in expected]
                if (len(timecodes) != len(expected_times) or any(
                        abs(a - c) > 0.05 or abs(b - d) > 0.05
                        for (a, b), (c, d) in zip(timecodes, expected_times))):
                    errors.append("提示词镜头时间与已确认宫格不一致")
        if shots and abs(timecodes[0][0]) > 0.05:
            errors.append("叙事镜头时间码必须从0秒开始")
        if "一镜到底" in sequence and len(shots) != 1:
            errors.append("一镜到底在【镜头序列】中只能有一个叙事镜头")

        if not timecodes:
            errors.append("未检测到叙事时段连续时间码")
            narrative_end = None
        else:
            for index, (start, end) in enumerate(timecodes):
                if end <= start:
                    errors.append(f"第{index + 1}个时间段结束时间不大于开始时间")
                if index and abs(start - timecodes[index - 1][1]) > 0.11:
                    errors.append(
                        f"时间码不连续：{timecodes[index - 1][1]:g}秒→{start:g}秒"
                    )
            narrative_end = max(end for _, end in timecodes)

    else:
        # One take has a single duration; combat may add continuous phase budgets.
        narrative_end = float(generation_info.group(2)) if generation_info else None
        if narrative_end is None or narrative_end <= 0:
            errors.append("一镜到底/打斗须在代码块外提供正数叙事时长")
        phase_times = []
        untimed_sequence = sequence
        if form == "combat":
            process = section_text(prompt_block, "打斗过程")
            phase_times, phase_errors = combat_phases(process)
            errors.extend(phase_errors)
            untimed_sequence = sequence.replace(process, COMBAT_PHASE_HEADER.sub("", process))
            if re.search(r"(?m)^\s*(?:阶段\s*\d+\s*[（(]|\d+(?:\.\d+)?\s*秒\s*[—–\-~至到]+)", untimed_sequence):
                errors.append("打斗阶段标题格式不完整，或时间标题出现在【打斗过程】之外")
            if phase_times and narrative_end is not None and abs(phase_times[-1][1] - narrative_end) > 0.05:
                errors.append("打斗阶段总长与代码块外叙事时长不一致")
        if has_micro_timing(untimed_sequence) or re.search(r"镜头\s*\d+|t\s*=\s*\d", untimed_sequence, re.I):
            errors.append("一镜到底/打斗正文不得嵌套编号镜头或逐秒调度；打斗阶段时间仅写在阶段标题")
        effects = section_text(prompt_block, "特效与运镜")
        if has_micro_timing(effects) or re.search(r"镜头\s*\d+|t\s*=\s*\d", effects, re.I):
            errors.append("打斗整体特效与运镜不得藏入逐秒镜头序列")
        if form == "one_take":
            declaration = section_text(prompt_block, "一镜到底执行声明")
            if not re.search(r"不切镜|无切镜|连续拍摄|连续长镜头", declaration):
                errors.append("一镜到底执行声明须明确连续不切镜")
            cut_prose = re.sub(
                r"(?:不使用|不用|不采用|禁止|不得使用)(?:黑场|遮挡|闪光|闪白|白闪|、|或|和|与)+(?:藏切|隐藏切点)",
                "", sequence,
            )
            if re.search(r"伪一镜到底|遮挡[^。；\n]*(?:藏切|转场|切点)|切到|硬切|\bHARD CUT\b", cut_prose, re.I):
                errors.append("真一镜到底叙事不能含切镜或遮挡藏切")
            if handoff_mode == "on" and re.search(r"全片|整条视频|整段视频|含交接", declaration):
                errors.append("追加硬切交接时只能声明叙事一镜到底，不能声称整个生成视频无切镜")
        if state is not None:
            board = state["unit"]["storyboard"]
            if board.get("exception") is None and narrative_end is not None:
                if abs(board["shots"][-1]["end"] - narrative_end) > 0.05:
                    errors.append("连续叙事时长与已确认宫格总时长不一致")
                if phase_times:
                    expected_times = [(s["start"], s["end"]) for s in board["shots"]]
                    if len(phase_times) != len(expected_times) or any(
                        abs(a - c) > 0.05 or abs(b - d) > 0.05
                        for (a, b), (c, d) in zip(phase_times, expected_times)
                    ):
                        errors.append("打斗阶段时间与已确认宫格攻防阶段不一致")

    total_end = narrative_end or 0.0
    handoff = section_text(text, "站位交接镜头")
    if handoff_mode == "off":
        if handoff:
            errors.append("handoff_mode=off时不得出现【站位交接镜头】或额外交接秒")
    else:
        handoff_match = re.search(
            r"(?m)^\s*(\d+(?:\.\d+)?)\s*[—–\-~至到]+\s*(\d+(?:\.\d+)?)\s*秒\s*$",
            handoff,
        )
        if not handoff_match:
            errors.append("handoff_mode=on时【站位交接镜头】必须包含独立时间码")
        else:
            handoff_start = float(handoff_match.group(1))
            handoff_end = float(handoff_match.group(2))
            total_end = handoff_end
            if abs((handoff_end - handoff_start) - 1.0) > 0.05:
                errors.append("【站位交接镜头】必须完整占用最后1.0秒")
            if narrative_end is not None and abs(narrative_end - handoff_start) > 0.11:
                errors.append(
                    f"叙事时段结束于{narrative_end:g}秒，但站位交接从{handoff_start:g}秒开始"
                )
            if "硬切" not in handoff:
                errors.append("【站位交接镜头】必须从叙事硬切")
            # Natural visibility/motion is semantic; do not require all faces/feet or frozen coordinates.

    limit = 15.0 if model_version == "2.0" else 30.0
    if state and isinstance(state["capabilities"].get("max_duration"), (int, float)):
        limit = min(limit, state["capabilities"]["max_duration"])
    if total_end > limit + 0.05:
        errors.append(f"时间码达到{total_end:g}秒，超过Seedance {model_version}的{limit:g}秒上限")
    if generation_info:
        info_version = generation_info.group(1)
        info_narrative = float(generation_info.group(2))
        info_handoff = float(generation_info.group(3))
        info_total = float(generation_info.group(4))
        expected_handoff = 1.0 if handoff_mode == "on" else 0.0
        if info_version != model_version:
            errors.append(
                f"【本段生成信息】写Seedance {info_version}，与当前Seedance {model_version}不一致"
            )
        if narrative_end is not None and abs(info_narrative - narrative_end) > 0.05:
            errors.append(
                f"【本段生成信息】叙事时长{info_narrative:g}秒，与镜头时间码{narrative_end:g}秒不一致"
            )
        if abs(info_handoff - expected_handoff) > 0.05:
            errors.append(
                f"【本段生成信息】站位交接应为{expected_handoff:g}秒"
            )
        if abs(info_total - total_end) > 0.05:
            errors.append(
                f"【本段生成信息】总时长{info_total:g}秒，与最终时间码{total_end:g}秒不一致"
            )
        if abs(info_total - info_narrative - info_handoff) > 0.05:
            errors.append("【本段生成信息】总时长必须等于叙事时长加站位交接秒数")

    sound = section_text(text, "声音设计")
    if has_micro_timing(sound):
        errors.append("【声音设计】以事件串联声场变化，不另列逐秒音轨表")
    if re.search(r"【[^】]*(?:BGM|配乐|Suno)[^】]*】", text, re.I):
        errors.append("视频交付不得附带BGM/Suno配乐栏目或备用提示词")
    no_music = re.findall(r"(?:无\s*BGM|无背景音乐|(?:不使用|不生成|不加入|禁止|不得|不要)\s*(?:BGM|背景音乐|配乐))", sound, re.I)
    if len(no_music) != 1 or not sound.rstrip().endswith("无BGM。"):
        errors.append("【声音设计】最后一句须为“无BGM。”且只声明一次")
    outside_sound = prompt_block.replace(sound, "")
    if re.search(r"无\s*BGM|(?:不使用|不生成|不加入|禁止)\s*(?:BGM|背景音乐)", outside_sound, re.I):
        errors.append("无BGM只在【声音设计】末尾声明一次，不在其他栏目重复")
    # Review directive clauses, not quoted script speech; a no-BGM sentence
    # cannot excuse a separate instruction to add a score elsewhere.
    music_terms = (r"BGM|背景音乐|配乐|音乐(?:渐|响|进入|压低|铺底|推动)|"
                   r"(?:鼓点|低弦|弦乐|大提琴|钢琴)[^。；]{0,20}(?:伴奏|铺底|动机|和声)|"
                   r"合成器铺底|soundtrack|background music|\bscore\b")
    music_prose = prompt_block
    for line in sequence.splitlines():
        # Exclude explicitly bound spoken script, not arbitrary instructions with a colon.
        if re.search(r"[（(][^）)\n]*音频\s*\d+[^）)\n]*[）)]\s*[：:]", line):
            music_prose = music_prose.replace(line, "")
    for clause in re.split(r"[。；;，,\n]|但|不过|然而", music_prose):
        if re.search(music_terms, clause, re.I):
            if not re.search(r"不使用|不生成|不加入|无BGM|无背景音乐|禁止|不得|不要|杜绝|no music|no bgm|no score", clause, re.I):
                errors.append("视频正文仍含正向音乐指令：" + clause.strip()[:90])
    # This is lexical protection only; sound-source semantics need cold reading.

    entries = mapping_entries(mapping, platform)
    # All body references must resolve, not merely have some audio somewhere.
    refs = {(kind, int(number)) for kind, number in re.findall(r"(音频|视频)\s*(\d+)", body_without_mapping)}
    for kind, number in refs - internal_slots:
        errors.append(f"正文引用未映射的{kind}{number}")
    for name, direction, words in dialogue_lines(sequence):
        numbers = re.findall(r"音频\s*(\d+)", direction)
        has_reference = any(kind == "音频" and owner == name for (kind, _), owner in entries.items())
        if len(numbers) > 1 or (has_reference and not numbers):
            errors.append(f"台词{name}须就近引用唯一角色音频")
        elif numbers and entries.get(("音频", int(numbers[0]))) != name:
            errors.append(f"台词{name}引用的音频不属于该角色")
    if state:
        assets = {item["id"]: item for item in state["snapshot"]["assets"] if isinstance(item, dict) and "id" in item}
        expected = {(b["kind"], b["slot"]): assets.get(b.get("asset_id")) for b in state["unit"]["bindings"]
                    if isinstance(b, dict) and "kind" in b and "slot" in b and isinstance(b["slot"], int)}
        if set(expected) != internal_slots:
            errors.append("本次映射槽位与当前单元实际资产绑定不一致")
        for slot, asset in expected.items():
            if asset and entries.get(slot) != asset.get("name"):
                errors.append(f"本次{slot[0]}{slot[1]}规范身份与实际资产不一致")
        table_rows = {}
        for line in text.split("【风格锁定】", 1)[0].splitlines():
            if not line.strip().startswith("|"):
                continue
            cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
            match = re.fullmatch(r"(图|音频|视频)\s*(\d+)", cells[1]) if len(cells) >= 3 else None
            if not match:
                continue
            key = (match[1], int(match[2]))
            if key in table_rows:
                errors.append("外部上传表存在重复素材槽位")
            link = re.search(r"\]\(<?(.*?)>?\)", cells[2])
            table_rows[key] = link[1] if link else cells[2]
        for slot, source in table_rows.items():
            asset = expected.get(slot)
            if asset and source.replace("\\", "/").casefold() != str(asset.get("source", "")).replace("\\", "/").casefold():
                errors.append(f"上传表{slot[0]}{slot[1]}文件来源与实际绑定不一致")
        voice_set = set(state["unit"]["required_voices"])
        for name, _, _ in dialogue_lines(sequence):
            if name not in voice_set:
                errors.append(f"台词{name}未登记为当前人声需求")
        for kind, number in refs:
            if kind == "音频" and entries.get((kind, number)) not in voice_set:
                errors.append(f"角色人声{kind}{number}未登记为当前需求")
    if re.search(r'说[：:]?["“]|问[：:]?["“]', sequence) and not dialogue_lines(sequence):
        errors.append("检测到未明确说话者的台词，请使用角色（表演，可选音频N）：台词格式")

    if re.search(r"后期配音|声音由后期替换|后期替换声音", payload):
        errors.append("视频提示词不应以待后期补配替代本段应生成的人声")

    supplement = section_text(text, "全局补充")
    if re.search(
        r"站位交接|交接镜头|交接图|交接帧|直接结束|额外时长|"
        r"Seedance\s*2\.[05]|叙事时长|生成总时长|总生成时长|总时长|独立生成",
        supplement,
        re.IGNORECASE,
    ):
        errors.append("【全局补充】不得描述站位交接状态、直接结束秒数、额外时长或生成元信息")
    prohibitions = len(re.findall(r"严禁|禁止|不得|不能|不允许|无字幕|无水印", supplement))
    if prohibitions > 6:
        warnings.append(f"【全局补充】检测到{prohibitions}项禁止表达，通常应压缩到6项以内")

    director_names = re.findall(
        r"诺兰|芬奇|斯皮尔伯格|希区柯克|斯科塞斯|库布里克|维伦纽瓦|卡梅隆|Christopher Nolan|David Fincher|Steven Spielberg",
        payload,
        re.IGNORECASE,
    )
    if director_names:
        warnings.append("视频提示词出现导演姓名；优先转译为具体摄影、调度和叙事参数")

    return errors, warnings


def self_test() -> int:
    from test_regressions import run
    return run()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("file", nargs="?", help="UTF-8 prompt file; omit to read stdin")
    parser.add_argument("--platform", choices=["jimeng", "libtv", "other", "generic"], default="jimeng")
    parser.add_argument("--model-version", choices=["2.0", "2.5"], default="2.5")  # 本地兼容：恢复默认值（旧 CLI 可省略）
    parser.add_argument("--asset-mode", choices=["mapped", "text", "hybrid"], default="mapped")
    parser.add_argument("--bgm-mode", choices=["none", "suno"], default="none")
    parser.add_argument("--handoff-mode", choices=["on", "off"], default="on")  # 本地兼容：旧 CLI 无此参数，默认放行不阻断
    parser.add_argument("--delivery-kind", choices=["initial", "revision"], default="initial")
    parser.add_argument("--state", help="Current project record for actual asset/authorization gates")
    parser.add_argument("--suno-action", choices=["none", "new", "reuse"], default="none", help="兼容旧参数；new/reuse已退役，视频阶段只允许none")
    parser.add_argument("--mode", choices=["new", "extend", "edit"], help="本地兼容参数：旧 CLI --mode 已由 --delivery-kind 取代，传入仅记录不改判定")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    if not args.model_version:
        parser.error("生成提示词前必须通过--model-version明确指定2.0或2.5")
    if not args.handoff_mode:
        parser.error("生成提示词前必须通过--handoff-mode明确指定on或off")
    text = Path(args.file).read_text(encoding="utf-8") if args.file else sys.stdin.read()
    errors, warnings = validate(
        text,
        args.platform,
        args.model_version,
        args.asset_mode,
        args.bgm_mode,
        args.handoff_mode,
        args.delivery_kind,
        Path(args.state).read_text(encoding="utf-8-sig") if args.state else None,
        args.suno_action,
    )
    result = {"ok": not errors, "errors": errors, "warnings": warnings}
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print("PASS" if result["ok"] else "FAIL")
        for item in errors:
            print("ERROR:", item)
        for item in warnings:
            print("WARN:", item)
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
