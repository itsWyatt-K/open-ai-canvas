#!/usr/bin/env python3
"""Initialize an isolated, editable previs starter; does not recognize a floorplan."""
from __future__ import annotations
import os
import argparse
import json
import re
import zipfile
from pathlib import Path, PurePosixPath

ADAPTATION = """# 新场景适配

当前是有基础材质与灯光、无家具的示例木屋，尚未按新项目平面图适配，不能直接当新场景交付。

1. A/B常规场景制作先按scene_model_scope.md选建模范围；A/B/C任意阶段主动要求预演台则按previs_entry.md回读剧本、列全部场景供单选/多选。仅在本批所选实际平面图已展示且明确确认后初始化；提示词确认不等于图纸确认。先核对现有项目记录，未通过不得进入此步骤；本脚本不自动判定用户确认。室外复杂地形/多楼层须实际扩展验收。对本场景从确认户型提取尺寸、邻接、墙段和开口；缺失值标暂定。B未回传图时可按文字设计制作本地图纸并确认，不声称已读取外部图。C不必重新生成人物/场景资产，已有彩图可辅助规划。
2. 替换public/floorplan.png，适配lib/wall-plan.ts、lib/cabin.ts与app/page.tsx定位图；正交直墙单层以外结构另实现，不扭曲图纸。
3. lib/scene-phase.ts的SHELL_ONLY保持true、BACKFILL_COMPLETE保持false，陈设切换按钮置灰。初期不放家具、软装、厨卫陈设、装饰灯具或关键道具低模；保留独立柔和基础顶光与中性环境补光；安装位置/通道需求用文字或可隐藏二维标记。保留家具编辑代码，先适配结构尺寸与迁移，避免旧布局注入。
4. 默认关闭穿窗直射查看光，避免硬窗格投影；墙浅、地稍深略偏冷、框体再深一档，具体材质服从剧情，不能全屋同一棕黄。保留basic-materials.ts和PBR受光材质，墙、地、顶有基础纹理/粗糙度差异；保留真实阴影、独立空间顶光、亮度/色温/单灯调节。禁止均匀平涂、无光材质或过强环境光抹平墙角；预演展示不代替最终影调。各房间彩图确认并且用户选择回填后，才按实际母板适配lib/furniture.ts、lib/cabin.ts及lib/lighting.ts的对象/灯位，再关闭SHELL_ONLY；单独关开关会恢复示例家具，不算实际回填。当前模型内全部选定场景图确认且实际回填完成后，再将BACKFILL_COMPLETE设为true，按钮才可在空建筑/完整陈设间切换；保留基础材质、建筑灯光与完整家具数据，保存重开和机位导出均遵循当前查看状态。
5. 更换BrandHeader的subtitle场景副标题与示例房间名称；保留“超级AI客 · 超哥 · AI导演 3D预演台”标题、随包头像与二维码入口；顶部不恢复打开项目/保存项目按钮，保留自动保存与恢复，保留编辑/撤销/镜像/门窗开口/机位/标记/灯光控件。预设代表母板、房间及补充机位。室内默认16:9、室外默认21:9，已有指定画幅优先；缓存已隔离，导入旧项目仍须检查户型身份。
6. 透视实看墙角、地面、顶面的明暗及材质可辨，切灯有效，再验证无陈设、俯视图匹配、跨开口与反向视角、门窗随墙移动、尺寸编辑、撤销、项目保存恢复、室内16:9/室外21:9机位与PNG导出；导出后检查真实像素、比例、遮挡与无UI。

运行：Node >=22.13，npm ci，npm run dev。使用锁文件，不为普通换户型升级依赖。发布使用新项目的托管配置，不继承旧站点ID或权限。

本机跨浏览器自动同步已内置。点击带跳转图标的“在浏览器打开”，保存当前修改后自动用系统默认外部浏览器打开同步链接并接入；详情内保留“复制链接”备用；保持同一工程本地服务运行。Windows自动启动能力按references/previs_service.md登记；本初始化器不自行登记Windows计划任务，已获授权后由previs_service.py register接入。家具、灯光、人物和保存机位自动同步，自由观察视角独立。仅真实并发修改冲突时选择保留版本，旧缓存/替换前进度保留备份。静态托管无本地接口时用项目JSON导入/导出。按actor_blocking.md验证，不能只复制旧版手动同步说明。

独立预演模型确认后完成该任务或返回原路线/阶段，不自动生成彩图。仅A/B常规场景首图任务：模型确认后先按scene_assets.md 2.2节询问是否有色调/调性/影调参考（不继承图中家具、装修、建筑或室外环境内容；这些按剧本背景与已确认设计确定）；只有用户明确选定参考或无参考按P1设计后，才直接生成代表房间彩色母板，再逐个直接生成其他房间首张彩图。已有模型截图或P1确认不代替参考选择；同一美术组的明确选择沿用，不逐图重复问。已定房间的正反打/细节/特写才先在Codex画详细线稿，确认后生成彩图。B回传自愿。

角色模型库保留四个不可删除的内置模型；用户导入GLB或资源内嵌glTF后自动生成真实缩略图，本机跨项目复用，仅用户导入模型可导出原文件或删除库条目。删除不破坏已有场景引用；导入模型使用原始形态与自带动画，不套用内置骨骼动作。界面不提供角色库JSON操作。

人物排演已提供低模增删、姿势、持物、状态与多个机位，视频阶段按actor_blocking.md使用；默认空建筑不自动插人。路径、时间轴、自动跟随与运镜视频输出尚未实现；真实适配与浏览器检查完成后才能记模型验收通过。
"""

def default_previs_archive():
    """预演模板 zip：包内 assets/ 优先，外置回退 CHAOGE_ASSETS_DIR。"""
    local = Path(__file__).resolve().parents[1] / "assets" / "previs-starter.zip"
    if local.is_file():
        return local
    return Path(os.environ.get("CHAOGE_ASSETS_DIR", r"D://AlcheMvision//nxf//_engine//assets//chaoge-v324")) / "previs-starter.zip"


def initialize(destination: Path, project_key: str, archive: Path | None = None, *, scene_type: str = "indoor", aspect: str | None = None) -> int:
    if not re.fullmatch(r"[a-z][a-z0-9-]{2,63}", project_key):
        raise ValueError("project-key须为3至64位小写英文/数字/连字符，以字母开头")
    if scene_type not in {"indoor", "outdoor"}:
        raise ValueError("scene-type须为indoor或outdoor")
    aspect = aspect or ("16:9" if scene_type == "indoor" else "21:9")
    if aspect not in {"16:9", "21:9", "9:16", "2.39:1"}:
        raise ValueError("模板不支持该画幅")
    destination = destination.resolve()
    if destination.exists() and (not destination.is_dir() or any(destination.iterdir())):
        raise ValueError("目标必须不存在或为空目录；不会覆盖既有项目")
    # 本地合流版：已剥离分发身份核验（DRM），archive 缺省直接用包内/外置模板
    archive = archive or default_previs_archive()
    with zipfile.ZipFile(archive) as package:
        items = package.infolist()
        # Four approved, skinned actor meshes are bundled with the scene starter.
        if len(items) > 500 or sum(x.file_size for x in items) > 64_000_000:
            raise ValueError("模板大小超出预期")
        seen = set()
        for item in items:
            path = PurePosixPath(item.filename)
            if (path.is_absolute() or ".." in path.parts or "\\" in item.filename
                    or ":" in item.filename or item.filename in seen
                    or (item.external_attr >> 16) & 0o170000 == 0o120000):
                raise ValueError("模板含非法或重复路径")
            seen.add(item.filename)
        destination.mkdir(parents=True, exist_ok=True)
        count = 0
        for item in items:
            target = destination.joinpath(*PurePosixPath(item.filename).parts)
            if item.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            content = package.read(item)
            if target.suffix in {".ts", ".tsx", ".mjs", ".cjs"}:
                content = content.decode("utf-8").replace("cabin-", project_key + "-").encode("utf-8")
            if item.filename == "lib/scene-defaults.ts":
                content = content.decode("utf-8").replace("= '16:9';", f"= '{aspect}';").encode("utf-8")
            target.write_bytes(content)
            count += 1
    (destination / "SCENE_ADAPTATION.md").write_text(ADAPTATION, encoding="utf-8")
    (destination / "scene-project.json").write_text(json.dumps({
        "projectKey": project_key, "template": "orthogonal-cabin-example",
        "adaptationStatus": "pending", "floorplanConfirmed": False,
        "scenePhase": "shell", "shellAppearance": "soft_neutral_basic_materials", "sceneType": scene_type, "defaultAspect": aspect, "furnitureBackfill": "not_requested",
        "note": "仅初始化示例；需按剧本与确认户型适配后验收"
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    # 本地合流版：不再向工程注入分发身份（DRM 已剥离）
    return count + 2

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--project-key", required=True)
    parser.add_argument("--scene-type", choices=["indoor", "outdoor"], default="indoor")
    parser.add_argument("--aspect", choices=["16:9", "21:9", "9:16", "2.39:1"])
    args = parser.parse_args()
    try:
        count = initialize(args.destination, args.project_key, scene_type=args.scene_type, aspect=args.aspect)
    except (OSError, ValueError, zipfile.BadZipFile) as exc:
        parser.exit(1, f"ERROR: {exc}\n")
    print(f"Initialized {count} files: {args.destination.resolve()}; example adaptation pending")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
