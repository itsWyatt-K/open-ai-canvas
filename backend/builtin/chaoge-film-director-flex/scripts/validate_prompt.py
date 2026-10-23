#!/usr/bin/env python3
"""Validate 3+2 AI video prompt structure and platform asset syntax."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


MAX_VIDEO_PROMPT_CHARS = 5000
SOFT_VIDEO_PROMPT_CHARS = 4200

SECTION_SOFT_LIMITS = {
    "风格锁定": 500,
    "场景与空间锚点": 700,
    "声音与音乐总则": 350,
    "全局补充": 450,
}


SECTIONS = {
    "new": [
        "风格锁定",
        "素材映射",
        "场景与空间锚点",
        "声音与音乐总则",
        "镜头序列",
        "全局补充",
    ],
    "extend": [
        "延长任务",
        "素材映射",
        "衔接与连续性锁定",
        "新增故事与情绪目标",
        "声音与音乐延续",
        "新增镜头序列",
        "全局补充",
    ],
    "edit": [
        "编辑任务",
        "素材映射",
        "生效时段",
        "修改要求",
        "保持不变",
        "全局补充",
    ],
}

TOP_LEVEL_SECTIONS = {
    section for ordered_sections in SECTIONS.values() for section in ordered_sections
}
TOP_LEVEL_SECTIONS.add("一镜到底执行声明")


def section_span(text: str, name: str) -> tuple[int, int] | None:
    match = re.search(rf"【{re.escape(name)}】", text)
    if not match:
        return None
    tail = text[match.end() :]
    next_positions = []
    for section in TOP_LEVEL_SECTIONS:
        next_header = re.search(rf"\n【{re.escape(section)}】", tail)
        if next_header:
            next_positions.append(next_header.start())
    end = match.end() + min(next_positions) if next_positions else len(text)
    return match.start(), end


def section_text(text: str, name: str) -> str:
    span = section_span(text, name)
    return text[span[0] : span[1]] if span else ""


def extract_prompt_payload(text: str, mode: str) -> str:
    """Return only the copyable video-prompt body for deterministic counting."""

    first_section = SECTIONS[mode][0]
    marker = f"【{first_section}】"
    start = text.find(marker)
    if start < 0:
        return text.strip()

    payload = text[start:]
    next_markdown_heading = re.search(r"\n#{1,6}\s+", payload)
    if next_markdown_heading:
        payload = payload[: next_markdown_heading.start()]
    return payload.strip()


def validate(
    text: str,
    platform: str,
    mode: str,
    model_version: str = "2.5",
    asset_mode: str = "mapped",
    voice_mode: str = "mapped_dry_voice",
) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    prompt_payload = extract_prompt_payload(text, mode)
    prompt_char_count = len(prompt_payload)
    if prompt_char_count > MAX_VIDEO_PROMPT_CHARS:
        errors.append(
            f"文生视频提示词正文共{prompt_char_count}个字符，超过"
            f"{MAX_VIDEO_PROMPT_CHARS}个字符上限"
        )
    elif prompt_char_count > SOFT_VIDEO_PROMPT_CHARS:
        warnings.append(
            f"文生视频提示词正文共{prompt_char_count}个字符，已超过"
            f"{SOFT_VIDEO_PROMPT_CHARS}个字符常规目标；请先去重再交付"
        )

    for section_name, soft_limit in SECTION_SOFT_LIMITS.items():
        body = section_text(text, section_name)
        if body and len(body) > soft_limit:
            warnings.append(
                f"【{section_name}】共{len(body)}个字符，超过{soft_limit}个字符建议预算"
            )

    global_supplement = section_text(text, "全局补充")
    prohibition_count = len(
        re.findall(
            r"严禁|禁止|不得|不能|不允许|无字幕|无水印|无背景音乐",
            global_supplement,
        )
    )
    if prohibition_count > 6:
        warnings.append(
            f"【全局补充】检测到{prohibition_count}项禁止表达，通常应压缩到6项以内"
        )

    normalized_clauses: dict[str, int] = {}
    for clause in re.split(r"[。；\n]", prompt_payload):
        normalized = re.sub(r"[\s，、：:（）()【】]", "", clause)
        if len(normalized) >= 18:
            normalized_clauses[normalized] = normalized_clauses.get(normalized, 0) + 1
    repeated_clauses = sum(1 for count in normalized_clauses.values() if count > 1)
    if repeated_clauses:
        warnings.append(f"提示词中检测到{repeated_clauses}条重复长句，请按栏目职责去重")

    ordered_sections = [
        section
        for section in SECTIONS[mode]
        if not (section == "素材映射" and asset_mode == "text")
    ]
    positions: list[int] = []
    for section in ordered_sections:
        marker = f"【{section}】"
        if (
            mode == "new"
            and section == "镜头序列"
            and "【一镜到底执行声明】" in text
        ):
            marker = "【一镜到底执行声明】"
        pos = text.find(marker)
        if pos < 0:
            errors.append(f"缺少栏目：{marker}")
        else:
            positions.append(pos)
    if len(positions) == len(ordered_sections) and positions != sorted(positions):
        errors.append("栏目顺序不符合模板")

    mapping_span = section_span(text, "素材映射")
    mapping = section_text(text, "素材映射")
    outside = text
    if mapping_span:
        outside = text[: mapping_span[0]] + text[mapping_span[1] :]

    placeholders = re.compile(r"\{\{(?:Image|Audio|Video)\s+\d+\}\}")
    image_placeholders = re.compile(r"\{\{Image\s+\d+\}\}")
    mapped_aliases: set[str] = set()
    audio_speakers: dict[str, str] = {}

    if platform == "jimeng":
        if placeholders.search(text):
            errors.append("即梦版不得出现LibTV占位符")
        if "@" in outside:
            errors.append("即梦版的@只能出现在【素材映射】")
        if re.search(r"@(图片|图|音频|视频)\s*\d+", mapping):
            errors.append("即梦素材必须使用裸@，禁止写成@图片1/@音频1/@视频1")
        at_lines = [line.strip() for line in mapping.splitlines() if line.strip().startswith("@")]
        if not at_lines and mapping:
            warnings.append("【素材映射】中没有检测到裸@素材")
        for line in at_lines:
            alias = re.search(r"绑定后简称[“\"]([^”\"]+)[”\"]", line)
            if not alias:
                errors.append(f"即梦素材缺少绑定后简称：{line}")
            else:
                mapped_alias = alias.group(1)
                mapped_aliases.add(mapped_alias)
                if mapped_alias.startswith("音频"):
                    speaker = re.search(
                        r"^@(?:为|用于锁定)?([^，。]{1,24}?)(?:全部)?(?:台词|旁白|干声|声音|音色)",
                        line,
                    )
                    if speaker:
                        audio_speakers[mapped_alias] = speaker.group(1).strip("的 ")
    else:
        if "@" in text:
            errors.append("LibTV版不得出现@素材语法")
        if placeholders.search(outside):
            errors.append("LibTV占位符只能出现在【素材映射】")
        if re.search(r"(?:图|音频|视频)\s*\d+\s*=\s*\{\{", mapping):
            errors.append("LibTV素材行必须直接以占位符开头，禁止写图1={{Image 1}}")
        for kind, number in re.findall(r"\{\{(Image|Audio|Video)\s+(\d+)\}\}", mapping):
            prefix = {"Image": "图", "Audio": "音频", "Video": "视频"}[kind]
            mapped_alias = f"{prefix}{number}"
            mapped_aliases.add(mapped_alias)
            if kind == "Audio":
                mapping_line = next(
                    (
                        line.strip()
                        for line in mapping.splitlines()
                        if f"{{{{Audio {number}}}}}" in line
                    ),
                    "",
                )
                speaker = re.search(
                    rf"\{{\{{Audio\s+{number}\}}\}}(?:为|用于锁定)?([^，。]{{1,24}}?)(?:全部)?(?:台词|旁白|干声|声音|音色)",
                    mapping_line,
                )
                if speaker:
                    audio_speakers[mapped_alias] = speaker.group(1).strip("的 ")
        if not mapped_aliases and mapping:
            warnings.append("【素材映射】中没有检测到LibTV素材占位符")

    if asset_mode == "text":
        if image_placeholders.search(text):
            errors.append("纯文生视频版不得出现{{Image N}}视觉占位符")
        if re.search(r"(?<![A-Za-z{])图\s*\d+", text):
            errors.append("纯文生视频版不得引用图N")
        if platform == "jimeng" and any(
            re.search(r"绑定后简称[“\"]图\s*\d+[”\"]", line)
            for line in mapping.splitlines()
        ):
            errors.append("纯文生视频版不得映射视觉图片")

    external_mapping_aliases = {
        re.sub(r"\s+", "", alias)
        for alias in re.findall(
            r"(?m)^\|\s*((?:图|音频|视频)\s*\d+)\s*\|", text
        )
    }
    if mapped_aliases:
        if not external_mapping_aliases:
            errors.append("提示词使用了素材槽位，但缺少外部【本批上传ID映射】表")
        else:
            missing_external = sorted(mapped_aliases - external_mapping_aliases)
            unused_external = sorted(external_mapping_aliases - mapped_aliases)
            if missing_external:
                errors.append("提示词素材未列入外部上传映射：" + "、".join(missing_external))
            if unused_external:
                errors.append("外部上传映射包含本批未使用槽位：" + "、".join(unused_external))

    used_aliases = set(re.findall(r"(?<![A-Za-z{])(?:图|音频|视频)\s*\d+", outside))
    normalized_used = {re.sub(r"\s+", "", value) for value in used_aliases}
    missing = sorted(normalized_used - mapped_aliases)
    if missing:
        errors.append("后文引用但未映射：" + "、".join(missing))

    # Any intelligible spoken language must bind the correct dry voice at the
    # exact point of performance. A global audio mapping alone is insufficient.
    spoken_scope_names = (
        "镜头序列",
        "一镜到底执行声明",
        "新增镜头序列",
        "修改要求",
    )
    spoken_scope = "\n".join(
        section_text(text, name) for name in spoken_scope_names if section_text(text, name)
    )
    speech_trigger = re.compile(
        r"(?:说|说道|喊|哭喊|大喊|低语|耳语|回答|问道|念出|旁白|画外音|广播|电话)[^\n。；]{0,60}[：:]?\s*[“\"]"
    )
    role_cue = re.compile(
        r"[A-Za-z\u4e00-\u9fff]{1,20}\s*[（(][^）)\n]{0,100}[）)]\s*[：:]\s*[“\"]"
    )
    dialogue_lines: list[tuple[int, str]] = []
    for line_number, line in enumerate(spoken_scope.splitlines(), start=1):
        if speech_trigger.search(line) or role_cue.search(line):
            dialogue_lines.append((line_number, line.strip()))

    mapped_audio = sorted(alias for alias in mapped_aliases if alias.startswith("音频"))
    if voice_mode == "mapped_dry_voice":
        if dialogue_lines and not mapped_audio:
            errors.append("检测到对白/旁白，但【素材映射】没有对应干声音频")
        for line_number, line in dialogue_lines:
            local_binding = re.search(
                r"(?P<speaker>[A-Za-z\u4e00-\u9fff]{1,20})\s*[（(][^）)\n]{0,100}?音频\s*(?P<number>\d+)[^）)\n]*[）)]",
                line,
            )
            if not local_binding:
                preview = line[:80] + ("…" if len(line) > 80 else "")
                errors.append(
                    f"对白/旁白须写成‘角色/旁白（音频N，表演参数）：台词’（声音段第{line_number}行）：{preview}"
                )
                continue
            alias = f"音频{local_binding.group('number')}"
            local_speaker = local_binding.group("speaker")
            mapped_speaker = audio_speakers.get(alias)
            if mapped_speaker and mapped_speaker != local_speaker:
                errors.append(
                    f"角色音频错配：{local_speaker}使用{alias}，但素材映射标记为{mapped_speaker}"
                )
    elif voice_mode == "model_voice":
        if mapped_audio or re.search(r"音频\s*\d+", spoken_scope):
            errors.append("model_voice模式不得绑定或引用干声音频编号")
        if dialogue_lines:
            warnings.append("model_voice模式含可辨识语言：跨单元音色一致性需要实测")
    elif voice_mode == "post_dub":
        if mapped_audio or re.search(r"音频\s*\d+", spoken_scope):
            errors.append("post_dub模式不得绑定或引用虚构干声音频编号")
        if dialogue_lines and not re.search(r"后期配音|后期替换|后期声音", spoken_scope):
            errors.append("post_dub模式的台词镜头必须声明声音由后期配音替换")

    style_text = section_text(text, "风格锁定")
    if re.search(r"总(?:长|时长)\s*[：:]?\s*\d+(?:\.\d+)?\s*秒", style_text):
        errors.append("【风格锁定】不得声明总长/总时长，时长由平台控制")
    style_body = style_text.replace("【风格锁定】", "").strip()
    if mode == "new" and len(style_body) < 40:
        warnings.append("【风格锁定】内容过短，可能不足以锁定摄影、光线、色彩与材质")
    if mode == "new" and not re.search(
        r"摄影机|胶片|film|ARRI|Alexa|RED|Sony|Kodak|Panavision|镜头|lens",
        style_body,
        re.IGNORECASE,
    ):
        warnings.append("【风格锁定】未检测到明确的摄影或镜头系统")

    for forbidden in ("镜头设计", "角色表演与声音"):
        if f"【{forbidden}】" in text:
            errors.append(f"不得单设【{forbidden}】，具体要求应写入对应镜头")

    chinese_number_patterns = (
        r"[一二三四五六七八九十百千万两〇零]+\s*(?:毫米|厘米|米|度|秒|帧|档|步|记|句|倍|格|人)",
        r"第[一二三四五六七八九十百千万两〇零]+(?:秒|帧|镜|次|句)",
        r"[一二三四五六七八九十百千万两〇零]+分之[一二三四五六七八九十百千万两〇零]+",
        r"(?:午夜|凌晨|早上|上午|中午|下午|晚上)\s*[一二三四五六七八九十百千万两〇零]+点",
    )
    if any(re.search(pattern, text) for pattern in chinese_number_patterns):
        errors.append("所有可量化数字须使用阿拉伯数字，不得使用中文数字")

    if mode == "new":
        for obsolete in ("故事与情绪曲线", "地形、空间与连续性锁定"):
            if f"【{obsolete}】" in text:
                errors.append(
                    f"全新生成不再使用【{obsolete}】；故事情绪放在提示词外，空间信息写入【场景与空间锚点】"
                )

    if mode == "new":
        external_context_patterns = {
            r"\bU\d{2}\b": "全新生成提示词不得引用U01/U02等批次编号",
            r"上一条(?:视频)?|上一段|前一批|上个批次|前文": "全新生成提示词不得引用未上传的上一批次内容",
            r"硬切进入(?:新的?)?(?:动态)?画面|重新开始|延续U\d+|不重复(?:前文|上一段|U\d+)": "全新生成提示词含有模型无法执行的剪辑或上下文说明",
        }
        for pattern, message in external_context_patterns.items():
            if re.search(pattern, text, re.IGNORECASE):
                errors.append(message)

        one_take_header = "【一镜到底执行声明】" in text
        sequence = section_text(
            text, "一镜到底执行声明" if one_take_header else "镜头序列"
        )
        shot_matches = list(re.finditer(r"镜头\s*(\d+)\s*[（(]", sequence))
        is_one_take = one_take_header
        if is_one_take:
            if shot_matches:
                errors.append("一镜到底不设置【镜头序列】或镜头编号，直接使用【一镜到底执行声明】")
            for section in ("一镜到底执行声明", "起手式", "连续时间轴", "最终镜头落点"):
                if f"【{section}】" not in sequence:
                    errors.append(f"一镜到底缺少【{section}】")
            internal_timecodes = [
                (float(start), float(end))
                for start, end in re.findall(
                    r"(?m)^\s*(\d+(?:\.\d+)?)\s*[—–\-~至到]+\s*(\d+(?:\.\d+)?)\s*秒\s*$",
                    sequence,
                )
            ]
            if len(internal_timecodes) < 2:
                errors.append("一镜到底的【连续时间轴】至少需要两个连续时间段")
            else:
                for index, (start, end) in enumerate(internal_timecodes):
                    if end <= start:
                        errors.append(f"一镜到底第{index + 1}个时间段结束时间不大于开始时间")
                    if index and abs(start - internal_timecodes[index - 1][1]) > 0.11:
                        errors.append(
                            f"一镜到底时间轴不连续：{internal_timecodes[index - 1][1]:g}秒 → {start:g}秒"
                        )
            for cut_match in re.finditer(r"硬切|切镜|切到|转场|遮挡转场|匹配切", sequence):
                preceding = sequence[max(0, cut_match.start() - 18) : cut_match.start()]
                if not re.search(r"禁止|严禁|不得|不能|不允许|没有|无任何", preceding):
                    errors.append("一镜到底的镜头序列中出现了切镜或转场指令")
                    break
            if re.search(r"定焦[^\n。；]*(?:焦段从|焦段由|焦段逐渐|变为\s*\d+\s*mm|过渡到\s*\d+\s*mm)", sequence, re.IGNORECASE):
                errors.append("一镜到底使用定焦镜头时不得连续改变焦段")
        for index, match in enumerate(shot_matches):
            end = shot_matches[index + 1].start() if index + 1 < len(shot_matches) else len(sequence)
            body = sequence[match.start() : end]
            missing_fields = [] if is_one_take else [
                field for field in ("机位与构图：", "运镜：", "画面内容：") if field not in body
            ]
            if missing_fields:
                errors.append(
                    f"镜头{match.group(1)}缺少固定字段：" + "、".join(missing_fields)
                )
            camera = None if is_one_take else re.search(r"机位与构图：(.*?)(?=\n运镜：)", body, re.DOTALL)
            if camera:
                camera_text = camera.group(1)
                if not re.search(
                    r"极远景|大全景|中远景|中全景|全景|中景|近景|极特写|特写|胸像|半身|腰部|膝上|全身|过肩",
                    camera_text,
                ):
                    errors.append(f"镜头{match.group(1)}的【机位与构图】未明确景别")
                if "景别为" in camera_text:
                    errors.append(
                        f"镜头{match.group(1)}请直接写景别名称，不要使用‘景别为’"
                    )
                if not re.search(r"焦点|景深|清晰|虚焦", camera_text):
                    errors.append(
                        f"镜头{match.group(1)}的【机位与构图】未说明焦点与清晰/虚焦关系"
                    )
                if "过肩" in camera_text and not (
                    "前景" in camera_text
                    and "虚焦" in camera_text
                    and re.search(r"焦点|清晰", camera_text)
                ):
                    errors.append(
                        f"镜头{match.group(1)}为过肩构图，须说明前景肩膀/后脑、虚焦程度和对面焦点"
                    )

    if mode in {"new", "extend"}:
        timecodes = [
            (float(start), float(end))
            for start, end in re.findall(
                r"镜头\s*\d+\s*[（(][^\n）)]*?(\d+(?:\.\d+)?)\s*[—–\-~至到]+\s*(\d+(?:\.\d+)?)\s*秒",
                text,
            )
        ]
        if not timecodes and "【一镜到底执行声明】" not in text:
            warnings.append("未检测到镜头时间码")
        else:
            for index, (start, end) in enumerate(timecodes):
                if end <= start:
                    errors.append(f"第{index + 1}个时间码结束时间不大于开始时间")
                if index and abs(start - timecodes[index - 1][1]) > 0.11:
                    errors.append(
                        f"时间码不连续：{timecodes[index - 1][1]:g}秒 → {start:g}秒"
                    )

    duration_timecodes = [
        (float(start), float(end))
        for start, end in re.findall(
            r"镜头\s*\d+\s*[（(][^\n）)]*?(\d+(?:\.\d+)?)\s*[—–\-~至到]+\s*(\d+(?:\.\d+)?)\s*秒",
            text,
        )
    ]
    if "【一镜到底执行声明】" in text:
        duration_timecodes.extend(
            (float(start), float(end))
            for start, end in re.findall(
                r"(?m)^\s*(\d+(?:\.\d+)?)\s*[—–\-~至到]+\s*(\d+(?:\.\d+)?)\s*秒\s*$",
                text,
            )
        )
    if mode in {"new", "extend"} and duration_timecodes:
        max_end = max(end for _, end in duration_timecodes)
        max_duration = 15.0 if model_version == "2.0" else 30.0
        if max_end > max_duration + 0.05:
            errors.append(
                f"Seedance {model_version}单批时间码达到{max_end:g}秒，超过{max_duration:g}秒上限"
            )
    if model_version == "2.0" and mode == "extend":
        warnings.append("Seedance 2.0不建议把视频延长作为常规衔接；优先使用自然切点或抽帧接力")

    return errors, warnings


def self_test() -> int:
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
    jimeng_payload_length = len(extract_prompt_payload(jimeng, "new"))
    at_limit = jimeng + ("x" * (MAX_VIDEO_PROMPT_CHARS - jimeng_payload_length))
    over_limit = at_limit + "x"
    tests = [
        (jimeng, "jimeng", "new", "2.5", "mapped", "mapped_dry_voice", True),
        (libtv, "libtv", "new", "2.5", "mapped", "mapped_dry_voice", True),
        (bad, "jimeng", "new", "2.5", "mapped", "mapped_dry_voice", False),
        (over_15, "jimeng", "new", "2.0", "mapped", "mapped_dry_voice", False),
        (missing_voice, "jimeng", "new", "2.5", "mapped", "mapped_dry_voice", False),
        (text_model_voice, "jimeng", "new", "2.5", "text", "model_voice", True),
        (bad_text_image, "libtv", "new", "2.5", "text", "model_voice", False),
        (at_limit, "jimeng", "new", "2.5", "mapped", "mapped_dry_voice", True),
        (over_limit, "jimeng", "new", "2.5", "mapped", "mapped_dry_voice", False),
    ]
    for text, platform, mode, model_version, asset_mode, voice_mode, expected in tests:
        errors, _ = validate(
            text, platform, mode, model_version, asset_mode, voice_mode
        )
        if (not errors) != expected:
            print(f"Self-test failed: {platform}/{mode}: {errors}", file=sys.stderr)
            return 1

    _, limit_warnings = validate(at_limit, "jimeng", "new", "2.5")
    if not any("常规目标" in item for item in limit_warnings):
        print("Self-test failed: missing soft-limit warning", file=sys.stderr)
        return 1

    bloated = jimeng.replace(
        "无字幕。",
        "严禁换脸。严禁换装。严禁跳轴。严禁新增人物。"
        "严禁改变光线。严禁改变道具。严禁改变空间。",
    )
    _, bloat_warnings = validate(bloated, "jimeng", "new", "2.5")
    if not any("禁止表达" in item for item in bloat_warnings):
        print("Self-test failed: missing prohibition-bloat warning", file=sys.stderr)
        return 1
    print("Self-test passed")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("file", nargs="?", help="UTF-8 prompt file; omit to read stdin")
    parser.add_argument("--platform", choices=["jimeng", "libtv"], default="jimeng")
    parser.add_argument("--mode", choices=["new", "extend", "edit"], default="new")
    parser.add_argument("--model-version", choices=["2.0", "2.5"], default="2.5")
    parser.add_argument("--asset-mode", choices=["mapped", "text", "hybrid"], default="mapped")
    parser.add_argument(
        "--voice-mode",
        choices=["mapped_dry_voice", "model_voice", "post_dub"],
        default="mapped_dry_voice",
    )
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    text = Path(args.file).read_text(encoding="utf-8") if args.file else sys.stdin.read()
    errors, warnings = validate(
        text,
        args.platform,
        args.mode,
        args.model_version,
        args.asset_mode,
        args.voice_mode,
    )
    result = {"ok": not errors, "errors": errors, "warnings": warnings}

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print("PASS" if result["ok"] else "FAIL")
        for item in errors:
            print(f"ERROR: {item}")
        for item in warnings:
            print(f"WARN: {item}")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
