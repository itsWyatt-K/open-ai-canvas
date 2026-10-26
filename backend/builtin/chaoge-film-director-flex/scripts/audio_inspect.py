#!/usr/bin/env python3
"""Read-only audio measurements. This does not listen, separate or master audio."""
from pathlib import Path
import argparse, json, re, shutil, subprocess, sys

def run(command):
    p=subprocess.run(command,capture_output=True,text=True,encoding='utf-8',errors='replace')
    if p.returncode: raise ValueError(p.stderr[-5000:])
    return p

def inspect(source, audio_stream=None):
    source=Path(source).resolve()
    if not source.is_file(): raise ValueError('输入媒体不存在')
    for tool in ('ffmpeg','ffprobe'):
        if not shutil.which(tool): raise ValueError('缺少实际检测工具：'+tool)
    probe=json.loads(run(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(source)]).stdout)
    tracks=[s for s in probe.get('streams',[]) if s.get('codec_type')=='audio']
    result={'source':str(source),'probe':probe,'read_only':True,'listened_to_audio':False,
            'content_classification':'未听辨；不判断对白、音乐存在或感知遮蔽',
            'measurement_only':'loudnorm仅用于提取输入测量；输出送null，不生成标准化音轨'}
    if not tracks:
        result.update(status='no_audio',measurements=None);return result
    if audio_stream is None:
        if len(tracks)>1: raise ValueError('存在多个音轨，请按实际目标指定--audio-stream（从0计数）')
        audio_stream=0
    if audio_stream<0 or audio_stream>=len(tracks): raise ValueError('音轨序号越界')
    selected=tracks[audio_stream]
    base=['ffmpeg','-hide_banner','-nostats','-nostdin','-i',str(source),'-map',f'0:a:{audio_stream}','-vn']
    r=run(base+['-af','loudnorm=I=-23:TP=-2:LRA=11:print_format=json','-f','null','-'])
    blocks=re.findall(r'\{\s*"input_i"[\s\S]*?\}',r.stderr)
    if not blocks: raise ValueError('未取得响度测量，不推断为零')
    values=json.loads(blocks[-1])
    measurements={k:values[k] for k in ('input_i','input_tp','input_lra','input_thresh')}
    a=run(base+['-af','astats=metadata=0:reset=0','-f','null','-']).stderr
    overall=a.rsplit('Overall',1)[-1] if 'Overall' in a else ''
    stats={}
    for key,value in re.findall(r'\]\s+([^:\r\n]+):\s*([^\r\n]+)',overall):
        stats[key.strip()]=value.strip()
    result.update(status='measured',audio_stream=audio_stream,selected_track=selected,
                  measurements=measurements,overall_stats=stats,
                  limits=['统计不等于主观试听或修复验收','Peak count不是削波样本数','短片LRA仅作辅助','此脚本不测定剧情声画同步'])
    return result

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('media',type=Path);p.add_argument('--audio-stream',type=int)
    p.add_argument('--output',type=Path)
    args=p.parse_args()
    try:
        if args.output and args.output.resolve()==args.media.resolve(): raise ValueError('输出不能覆盖输入媒体')
        if args.output and args.output.exists(): raise ValueError('检测记录已存在，请选择新文件名')
        result=inspect(args.media,args.audio_stream)
        text=json.dumps(result,ensure_ascii=False,indent=2)
        if args.output:
            args.output.parent.mkdir(parents=True,exist_ok=True)
            with args.output.open('x',encoding='utf-8') as f:f.write(text+'\n')
        else:print(text)
        return 0
    except (OSError,ValueError,KeyError,json.JSONDecodeError) as exc:
        print('检测未完成：'+str(exc),file=sys.stderr);return 1

if __name__=='__main__':raise SystemExit(main())
