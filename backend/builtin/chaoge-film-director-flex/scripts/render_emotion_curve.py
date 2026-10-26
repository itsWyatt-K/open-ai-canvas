#!/usr/bin/env python3
"""Render variable story data with the fixed R06 emotion-chart style. No AI image call."""
from __future__ import annotations
import argparse
import hashlib
import io
import json
import math
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
import os as _os
from pathlib import Path as _Path
# 资产解析：包内 assets/ 优先；重资产（风格预置/预演模板/字体）外置时回退外置目录。
# 外置目录可用环境变量 CHAOGE_ASSETS_DIR 覆盖，默认 D:/AlcheMvision/nxf/_engine/assets/chaoge-v324。
CHAOGE_ASSETS_DIR = _Path(_os.environ.get("CHAOGE_ASSETS_DIR", r"D://AlcheMvision//nxf//_engine//assets//chaoge-v324"))

def _asset(*parts):
    """包内 assets/<parts> 存在则用之，否则回退 CHAOGE_ASSETS_DIR/<parts>。"""
    local = _Path(__file__).resolve().parents[1] / "assets" / _Path(*parts)
    return local if local.exists() else CHAOGE_ASSETS_DIR / _Path(*parts)

ASSETS = _asset('emotion-chart')

def _font(name):
    """字体：包内 emotion-chart/ 优先，外置字体在资产根（CHAOGE_ASSETS_DIR/<name>）。"""
    local = ASSETS / name
    return local if local.is_file() else CHAOGE_ASSETS_DIR / name


def validate(data):
    if not isinstance(data, dict):
        raise ValueError('输入须为JSON对象')
    def short(value, label, limit):
        if not isinstance(value, str) or not value.strip() or len(value) > limit or any(ord(c) < 32 for c in value):
            raise ValueError(f'{label}须为1—{limit}字的单行文字')
    short(data.get('project_title'), 'project_title', 22)
    short(data.get('director_principle'), 'director_principle', 100)
    nodes = data.get('nodes')
    if not isinstance(nodes, list) or not 2 <= len(nodes) <= 16:
        raise ValueError('nodes须有2—16个节点；按真实戏剧节拍组织')
    for number, node in enumerate(nodes, 1):
        if not isinstance(node, dict) or type(node.get('id')) is not int or node['id'] != number:
            raise ValueError('节点id必须按叙事顺序从1连续编号，不得缺失/重复')
        short(node.get('name'), '节点name', 8)
        v = node.get('value')
        if type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 10 or abs(v*10-round(v*10)) > 1e-8:
            raise ValueError('节点value须为0—10内至多一位小数的有限数值')
        if 'annotation' in node:
            short(node['annotation'], '节点annotation', 6)
    highest = max(n['value'] for n in nodes)
    if any(n.get('annotation') == '全片最高峰' and n['value'] != highest for n in nodes):
        raise ValueError('全片最高峰标注必须与最大分值一致')
    acts = data.get('acts')
    if not isinstance(acts, list) or not 1 <= len(acts) <= 5:
        raise ValueError('acts须有1—5个真实幕区段，不能强制虚构三幕')
    expected = 1
    for act in acts:
        if not isinstance(act, dict) or type(act.get('first')) is not int or type(act.get('last')) is not int:
            raise ValueError('幕区段first/last须为整数')
        if act['first'] != expected or not act['first'] <= act['last'] <= len(nodes):
            raise ValueError('幕区段须连续、无重叠地覆盖全部节点')
        short(act.get('label'), '幕label', 22)
        expected = act['last']+1
    if expected != len(nodes)+1:
        raise ValueError('幕区段未覆盖全部节点')
    for key in ('breathing_nodes', 'bgm_nodes'):
        ids = data.get(key)
        if not isinstance(ids, list) or any(type(n) is not int or not 1 <= n <= len(nodes) for n in ids):
            raise ValueError(f'{key}只能引用本图节点id，可为空列表')
        if len(set(ids)) != len(ids) or ids != sorted(ids):
            raise ValueError(f'{key}不得重复，须按叙事顺序')
    return data


def rgb(color):
    return tuple(int(color[i:i+2],16) for i in (1,3,5))


def intensity_color(value, theme):
    stops = theme['curve_stops']
    for (a, ca), (b, cb) in zip(stops, stops[1:]):
        if value <= b:
            t = max(0, min(1, (value-a)/(b-a)))
            return tuple(round(x+(y-x)*t) for x,y in zip(rgb(ca),rgb(cb)))
    return rgb(stops[-1][1])


def curve_samples(values, subdivisions=80):
    """Shape-preserving piecewise cubic Hermite; exact node values, no overshoot."""
    if len(values)==2:
        return [(j/subdivisions,values[0]+(values[1]-values[0])*j/subdivisions) for j in range(subdivisions+1)]
    delta = [b-a for a,b in zip(values, values[1:])]
    slopes = [0.0]*len(values)
    for j in range(1,len(values)-1):
        a,b=delta[j-1],delta[j]
        slopes[j] = 2*a*b/(a+b) if a*b>0 else 0.0
    for idx,first,second in ((0,delta[0],delta[1]),(-1,delta[-1],delta[-2])):
        slope=(3*first-second)/2
        if slope*first<=0:slope=0.0
        elif first*second<0 and abs(slope)>3*abs(first):slope=3*first
        slopes[idx]=slope
    out=[]
    for j,(a,b) in enumerate(zip(values,values[1:])):
        for k in range(subdivisions):
            t=k/subdivisions
            value=(2*t**3-3*t*t+1)*a+(t**3-2*t*t+t)*slopes[j]+(-2*t**3+3*t*t)*b+(t**3-t*t)*slopes[j+1]
            out.append((j+t,value))
    out.append((len(values)-1,values[-1]))
    return out


def render(data):
    validate(data)
    try:
        from PIL import Image,ImageDraw,ImageFont,__version__ as pillow_version
    except ImportError as exc:
        raise RuntimeError('缺少Pillow；请安装随包requirements.txt所列依赖。不能用随机生图静默替代。') from exc
    theme=json.loads((ASSETS/'theme.json').read_text(encoding='utf-8'))
    font_path=_font(theme['font'])
    provenance=json.loads((ASSETS/'font-source.json').read_text(encoding='utf-8'))
    if hashlib.sha256(font_path.read_bytes()).hexdigest()!=provenance['sha256']:
        raise ValueError('内置字体校验失败，请恢复完整Skill；不替换为本机字体')
    @lru_cache(maxsize=32)
    def font(size,weight=400):
        f=ImageFont.truetype(str(font_path),size,layout_engine=ImageFont.Layout.BASIC)
        f.set_variation_by_axes([weight])
        return f
    im=Image.new('RGB',tuple(theme['size']),theme['background'])
    draw=ImageDraw.Draw(im)
    WHITE=theme['text'];MUTED=theme['muted'];ACCENT=theme['accent']
    def width(text,size,weight=400):return draw.textlength(text,font=font(size,weight))
    def text(x,y,value,size=40,color=WHITE,weight=400,align='left'):
        if align=='center':x-=width(value,size,weight)/2
        if align=='right':x-=width(value,size,weight)
        draw.text((round(x),round(y)),value,font=font(size,weight),fill=color,anchor='lt')
    def wrap(value,maxwidth,size,weight=400):
        rows=['']
        for char in value:
            if rows[-1] and width(rows[-1]+char,size,weight)>maxwidth:rows.append('')
            rows[-1]+=char
        return rows
    nodes=data['nodes'];N=len(nodes);peak=max(n['value'] for n in nodes)
    peak_index=next(j for j,n in enumerate(nodes) if n['value']==peak)
    text(135,62,'导演情绪分析',38,ACCENT)
    heading='《'+data['project_title']+'》'
    text(130,138,heading,86,WHITE,600)
    subtitle_x=150+width(heading,86,600)
    if subtitle_x+width('全片情绪曲线',49)>2700:
        text(500,62,'全片情绪曲线',38,ACCENT)
    else:
        text(subtitle_x,161,'全片情绪曲线',49,ACCENT)
    for x,value,label in ((2790,str(N),'叙事节点'),(3280,f'{peak:.1f}','全片峰值')):
        draw.line((x,116,x,200),fill=ACCENT,width=3)
        text(x+38,110,value,98,WHITE,500)
        text(x+55+width(value,98,500),148,label,42,ACCENT)
    left,top,right,bottom=theme['plot'];inset=theme['point_inset']
    xs=[left+inset+j*(right-left-2*inset)/(N-1) for j in range(N)]
    y=lambda v:bottom-v*(bottom-top)/10
    text(86,350,'情绪强度',42,ACCENT)
    for value in range(11):
        gy=round(y(value));draw.line((left,gy,right,gy),fill=theme['grid'],width=2)
        if value in (0,5,10):
            text(left-42,gy-20,str(value),43,ACCENT,align='right')
    for j,x in enumerate(xs,1):
        draw.line((round(x),top,round(x),bottom),fill=theme['grid'],width=2)
        draw.line((round(x),bottom,round(x),bottom+24),fill=ACCENT,width=3)
        text(x,bottom+48,str(j),43,ACCENT,align='center')
    draw.line((left,top,left,bottom,right,bottom),fill=ACCENT,width=3)
    samples=curve_samples([n['value'] for n in nodes],160)
    step=xs[1]-xs[0]
    points=[(xs[0]+u*step,y(v),v) for u,v in samples]
    curve_layer=Image.new('RGBA',(im.width*2,im.height*2),(0,0,0,0))
    curve_draw=ImageDraw.Draw(curve_layer)
    for a,b in zip(points,points[1:]):
        curve_draw.line((round(a[0]*2),round(a[1]*2),round(b[0]*2),round(b[1]*2)),fill=(*intensity_color((a[2]+b[2])/2,theme),255),width=22)
        px,py=round(b[0]*2),round(b[1]*2)
        curve_draw.ellipse((px-11,py-11,px+11,py+11),fill=(*intensity_color(b[2],theme),255))
    curve_layer=curve_layer.resize(im.size,Image.Resampling.LANCZOS)
    im.paste(curve_layer,(0,0),curve_layer)
    for j,node in enumerate(nodes):
        x,cy=xs[j],y(node['value']);c=intensity_color(node['value'],theme)
        if j==peak_index:
            draw.ellipse((round(x-35),round(cy-35),round(x+35),round(cy+35)),outline=c,width=4)
        draw.ellipse((round(x-21),round(cy-21),round(x+21),round(cy+21)),fill=theme['background'],outline=c,width=7)
        draw.ellipse((round(x-10),round(cy-10),round(x+10),round(cy+10)),fill=WHITE)
    # Cell-constrained labels remain legible for variable node counts and close peaks.
    label_records=[];occupied=[]
    def overlaps(a,b):return a[0]<b[2]+8 and a[2]>b[0]-8 and a[1]<b[3]+8 and a[3]>b[1]-8
    for j,node in enumerate(nodes):
        x,cy=xs[j],y(node['value']);c=intensity_color(node['value'],theme)
        maxw=min(300,step-25)
        lines=wrap(node['name'],maxw,38)
        annotation=node.get('annotation','全片最高峰' if j==peak_index else '')
        h=31+len(lines)*47+59+(49 if annotation else 0)
        bw=max(width(f'{j+1:02d}',31),*(width(line,38) for line in lines),width(f"{node['value']:.1f}",51,600),width(annotation,33,500) if annotation else 0)
        bw=max(bw,70)
        candidates=[cy-h-36,cy+36,cy-h-105,cy+105,top-h-20]
        scored=[]
        for preference,lx in enumerate((x+20,x-bw-22,x-bw/2)):
            cell_left=left+14 if j==0 else x-step/2+14
            cell_right=right-14 if j==N-1 else x+step/2-14
            bx=max(cell_left,min(lx,cell_right-bw))
            for by in candidates:
                if by<220 or by+h>bottom-10:continue
                box=(bx-12,by-8,bx+bw+8,by+h+5)
                if any(overlaps(box,old) for old in occupied):continue
                crossings=sum(box[0]-8<px<box[2]+8 and box[1]-8<py<box[3]+8 for px,py,_ in points)
                distance=min(abs(by-(cy-h-36)),abs(by-(cy+36)))
                scored.append((crossings,distance,preference,abs(by-(cy-h-36)),by,bx,box))
        if not scored:raise ValueError(f'节点{j+1}标签过密，请缩短名称/注释后重试；不要改变样式')
        _,_,_,_,by,bx,box=min(scored)
        if min(scored)[0]>0:raise ValueError(f'节点{j+1}标签与曲线相交，请缩短名称/注释后重试')
        occupied.append(box)
        draw.line((bx-14,round(by),bx-14,round(by+h-4)),fill=c,width=2)
        endpoint=(bx-14,by+h if by<cy else by)
        draw.line((round(x),round(cy-25 if by<cy else cy+25),round(endpoint[0]),round(endpoint[1])),fill=theme['grid'],width=2)
        text(bx,by,f'{j+1:02d}',31,MUTED)
        py=by+35
        for line in lines:text(bx,py,line,38);py+=47
        text(bx,py,f"{node['value']:.1f}",51,c,600);py+=59
        if annotation:text(bx,py,annotation,33,c,500)
        label_records.append({'id':j+1,'box':[round(z,3) for z in box]})
    band_top,band_bottom=1480,1605
    for j,act in enumerate(data['acts']):
        a=left if act['first']==1 else (xs[act['first']-2]+xs[act['first']-1])/2
        b=right if act['last']==N else (xs[act['last']-1]+xs[act['last']])/2
        box=(round(a+3),band_top,round(b-4),band_bottom)
        draw.rounded_rectangle(box,radius=7,fill=theme['act_fills'][j],outline=theme['act_edges'][j],width=2)
        lines=wrap(act['label'],b-a-40,43,600)
        if len(lines)>2:raise ValueError('幕名过长或幕区段过窄，请简写幕名')
        yy=band_top+(125-len(lines)*50)/2
        for line in lines:text((a+b)/2,yy,line,43,WHITE,600,align='center');yy+=50
    def node_list(ids):return '　 '.join(f"{j}. {nodes[j-1]['name']}" for j in ids)
    rows=[('呼吸区：',node_list(data['breathing_nodes']) or '无明确呼吸区'),('BGM重点：',node_list(data['bgm_nodes']) or '暂不设重点'),('全片原则：',data['director_principle'])]
    yy=1690
    for label,content in rows:
        text(135,yy,label,48,WHITE,600)
        bx=135+width(label,48,600)+28
        lines=wrap(content,right-bx,43)
        if yy+len(lines)*60>2015:raise ValueError('底部内容过长，请精简节点短名称或导演判断；不删节点、不缩小字号')
        for k,line in enumerate(lines):text(bx,yy+k*60,line,43)
        yy+=max(92,len(lines)*60+14)
    text(125,2040,'导演主观评分 · 观众紧张度 / 情感冲击度 · 0—10',32,ACCENT)
    text(125,2090,'横轴为叙事顺序，非等时长',32,ACCENT)
    text(right,2090,'BGM仅供后期规划；视频生成无BGM。',32,ACCENT,align='right')
    buffer=io.BytesIO();im.save(buffer,format='PNG',compress_level=9)
    image_bytes=buffer.getvalue()
    report={'theme':theme['id'],'canvas':theme['size'],'background':theme['background'],
        'theme_sha256':hashlib.sha256((ASSETS/'theme.json').read_bytes()).hexdigest(),
        'font_sha256':provenance['sha256'],'pillow':pillow_version,
        'data_sha256':hashlib.sha256(json.dumps(data,ensure_ascii=False,sort_keys=True).encode()).hexdigest(),
        'png_sha256':hashlib.sha256(image_bytes).hexdigest(),
        'points':[{'id':n['id'],'value':n['value'],'x':round(x,4),'y':round(y(n['value']),4),'color':intensity_color(n['value'],theme)} for n,x in zip(nodes,xs)],
        'labels':label_records,'input_provenance':data.get('source','未提供，不推断'),
        'render_method':'fixed-template; no image model; no reference-image pixels composited'}
    return image_bytes,report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('data',type=Path)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    try:
        if args.output.suffix.lower()!='.png':raise ValueError('输出须为.png')
        report_path=args.output.with_suffix('.render.json')
        if args.output.exists() or report_path.exists():raise ValueError('输出已存在；请使用下一版本名，不覆盖历史图')
        result,report=render(json.loads(args.data.read_text(encoding='utf-8-sig')))
        args.output.parent.mkdir(parents=True,exist_ok=True)
        with args.output.open('xb') as f:f.write(result)
        with report_path.open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
        print(json.dumps({'image':str(args.output.resolve()),'report':str(report_path.resolve()),'theme':report['theme']},ensure_ascii=False))
    except (ValueError,RuntimeError,OSError) as exc:
        parser.exit(1,f'ERROR: {exc}\n')


if __name__=='__main__':main()
