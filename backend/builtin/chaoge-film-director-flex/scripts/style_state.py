"""Validate recorded style decisions, not visual quality or authenticity of approval."""
from pathlib import Path
import json

MEDIA = {'live_action', 'stylized_3d', 'handdrawn_2d', 'custom'}
import os as _os
from pathlib import Path as _Path
# 资产解析：包内 assets/ 优先；重资产（风格预置/预演模板/字体）外置时回退外置目录。
# 外置目录可用环境变量 CHAOGE_ASSETS_DIR 覆盖，默认 D:/AlcheMvision/nxf/_engine/assets/chaoge-v324。
CHAOGE_ASSETS_DIR = _Path(_os.environ.get("CHAOGE_ASSETS_DIR", r"D://AlcheMvision//nxf//_engine//assets//chaoge-v324"))

def _asset(*parts):
    """包内 assets/<parts> 存在则用之，否则回退 CHAOGE_ASSETS_DIR/<parts>。"""
    local = _Path(__file__).resolve().parents[1] / "assets" / _Path(*parts)
    return local if local.exists() else CHAOGE_ASSETS_DIR / _Path(*parts)

PRESET_ROOT = _asset('style-presets')
PRESETS = {p['id']: p for p in json.loads((PRESET_ROOT / 'catalog.json').read_text(encoding='utf-8'))['presets']}
EARLY = {'P0', 'P0R', 'P0S'}
VIDEO = {'P3A', 'P3B', 'P4', 'P5', 'P6', 'P7', 'COMPLETE'}

def nonempty(value):
    return isinstance(value, str) and bool(value.strip())

def source_exists(value):
    return nonempty(value) and ((value.startswith('upload:') and bool(value[7:].strip()))
        or (Path(value).is_absolute() and Path(value).is_file()))

def validate_preset_prompt(text, preset_id, *, video_style=None):
    """Check explicit preset wording; not platform review or visual validation.

    text is only the submitted body, never reference paths or audit prose.
    video_style is the extracted style body for video, None for image prompts.
    """
    preset = PRESETS.get(preset_id) if isinstance(preset_id, str) else None
    if not preset:
        return []
    rules = preset.get('prompt_rules', {})
    errors = []
    prefix = rules.get('video_style_prefix')
    if video_style is not None and prefix and not video_style.lstrip().startswith(prefix):
        errors.append(preset['name'] + '的视频风格首句必须为：' + prefix)
    for term in rules.get('omitted_terms', []):
        if term in text:
            errors.append(preset['name'] + '生成正文仍含用户要求省略的词：' + term
                          + '；检查描述，不能自动改写原文对白')
    return errors

def validate_style(data, fields):
    required = data.get('workflow_revision') == 'route-style-first-v1'
    profile = data.get('style_profile')
    if profile is None:
        return ['新流程缺少style_profile'] if required else []
    if not isinstance(profile, dict):
        return ['style_profile必须为对象']
    errors = []
    ready = fields.get('current_stage') not in EARLY
    status = profile.get('status')
    if status not in {'pending', 'confirmed'}:
        errors.append('风格状态须为pending或confirmed')
    if ready and fields.get('production_route') not in {'A_full','B_prompt_only','C_direct_video'}:
        errors.append('正式分析前须明确A/B/C路线')
    if ready and status != 'confirmed':
        errors.append('十项分析前须先确认风格')
    if status != 'confirmed':
        return errors
    medium = profile.get('medium')
    kind = profile.get('source_kind')
    if medium not in MEDIA:
        errors.append('风格媒介无效')
    if kind not in {'preset','custom','existing_assets','legacy'}:
        errors.append('风格来源无效')
    for key in ('revision','confirmation_source','features','performance_scale'):
        if not nonempty(profile.get(key)):
            errors.append('风格缺少'+key)
    if profile.get('revision') != profile.get('confirmed_revision'):
        errors.append('当前风格版本尚未确认')
    refs = profile.get('references', [])
    if not isinstance(refs, list) or not all(isinstance(r,dict) for r in refs):
        return errors + ['风格参考必须为对象数组']
    for ref in refs:
        if ref.get('role') not in {'global_style','look_only','identity','spatial','motion'}:
            errors.append('风格参考职责无效')
        if not source_exists(ref.get('source')):
            errors.append('风格参考没有实际文件或上传来源')
    if kind == 'preset':
        preset_id = profile.get('preset_id')
        preset = PRESETS.get(preset_id) if isinstance(preset_id, str) else None
        if preset is None or preset['medium'] != medium:
            errors.append('内置风格ID或媒介与catalog不匹配；旧项目沿用需记legacy')
        if preset is None or profile.get('preset_revision') != preset['revision']:
            errors.append('内置风格资料版本未记录或无效')
        originals = {(PRESET_ROOT / r['image']).resolve() for r in preset['references']} if preset else set()
        if not any(r.get('role') == 'global_style' and r.get('media_kind') == 'image'
                   and r.get('visually_reviewed') is True
                   and source_exists(r.get('source'))
                   and Path(r['source']).resolve() in originals for r in refs):
            errors.append('所选内置风格须实际读取本预设的独立原图；其他风格原图、总览/视频不能代替')
        # A valid new reference must not silently leave an old preset's global
        # style reference active. Local look_only/identity references keep their
        # separate roles; they do not redefine the chosen global medium.
        for ref in refs:
            if ref.get('role') != 'global_style' or not source_exists(ref.get('source')):
                continue
            source = Path(ref['source']).resolve()
            if source.is_relative_to(PRESET_ROOT.resolve()) and source not in originals:
                errors.append('全局画风参考混入其他内置风格或非独立原图；须按当前预设清理参考职责')
                break
    if kind in {'custom','existing_assets'} and not any(
        r.get('role') == 'global_style' and r.get('media_kind') == 'image'
        and r.get('visually_reviewed') is True and source_exists(r.get('source')) for r in refs):
        errors.append('自定义/沿用资产风格须有实际查看的风格图片；视频可用已读取帧图')
    if fields.get('production_route') == 'C_direct_video' and kind != 'legacy':
        pre = data.get('asset_preflight', {})
        if not isinstance(pre,dict):
            errors.append('C路线asset_preflight必须为对象')
        elif pre.get('status') not in {'reviewed','text_authorized'} or not nonempty(pre.get('basis')):
            errors.append('C路线定风格前须完成素材预检或记录纯文字授权')
        elif pre.get('unresolved_conflicts') != []:
            errors.append('素材风格冲突尚未处理')
    if fields.get('current_stage') in VIDEO:
        unit = data.get('unit', {})
        if not isinstance(unit,dict) or unit.get('style_revision') != profile.get('revision'):
            errors.append('当前视频单元未同步最新风格版本')
    return errors
