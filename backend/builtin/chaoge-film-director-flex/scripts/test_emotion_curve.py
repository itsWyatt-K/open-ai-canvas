#!/usr/bin/env python3
"""Exercise fixed chart output, data integrity, layout bounds and failure handling."""
import copy
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from PIL import Image
import render_emotion_curve as r


class ChartTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data=json.loads((r.ASSETS/'example.json').read_text(encoding='utf-8'))
        cls.png,cls.report=r.render(cls.data)

    def test_deterministic_output_and_flat_background(self):
        png,report=r.render(self.data)
        self.assertEqual(png,self.png)
        self.assertEqual(report,self.report)
        im=Image.open(io.BytesIO(png))
        self.assertEqual(im.size,(3840,2160))
        for box in [(0,0,100,100),(500,2000,3000,2020),(3760,300,3840,1800)]:
            self.assertEqual(im.crop(box).getcolors(),[(im.crop(box).width*im.crop(box).height,(32,32,32))])
        self.assertEqual(im.getpixel((600,455)),(52,52,52))

    def test_actual_positions_and_same_value_colors(self):
        points=self.report['points']
        self.assertEqual(points[10]['y'],500.25)
        self.assertEqual(points[2]['y'],1160.9)
        self.assertEqual(points[0]['color'],points[-1]['color'])
        self.assertEqual(points[0]['color'],(72,186,238))
        self.assertEqual(points[10]['color'],(239,101,86))
        for a in self.report['labels']:
            x,y,right,bottom=a['box']
            self.assertTrue(0<=x<right<=3840 and 0<=y<bottom<=2160)
            for b in self.report['labels']:
                if b['id']<=a['id']:continue
                bx,by,br,bb=b['box']
                self.assertFalse(x<br and right>bx and y<bb and bottom>by)

    def test_interpolation_never_invents_peak(self):
        for values in [[0,10],[10,0,10,0],[5]*16,[0,0,10,10],[1,1.1,9.8,10],[9,1,2,3]]:
            points=r.curve_samples(values)
            for x,v in points:
                i=min(int(x),len(values)-2)
                self.assertGreaterEqual(v,min(values[i:i+2])-1e-8)
                self.assertLessEqual(v,max(values[i:i+2])+1e-8)
            for i,v in enumerate(values):self.assertIn((i,v),points)

    def test_variable_counts_and_extreme_values(self):
        for values in [[0,10],[5]*8,[0,10]*8,[2,4.5,7,3,8.5,9.5,5.5,2.5]]:
            d=copy.deepcopy(self.data)
            d['project_title']='用于测试长标题排版时是否会碰到右上角指标'
            d['nodes']=[{'id':j,'name':'剧情节点','value':v} for j,v in enumerate(values,1)]
            d['acts']=[{'first':1,'last':len(values),'label':'叙事进程'}]
            d['breathing_nodes']=[];d['bgm_nodes']=[]
            png,report=r.render(d)
            self.assertEqual(report['background'],'#202020')
            self.assertEqual(len(report['points']),len(values))
            self.assertEqual(report['theme_sha256'],self.report['theme_sha256'])
            self.assertTrue(png.startswith(b'\x89PNG'))

    def test_bad_data_is_rejected(self):
        for bad in [float('nan'),float('inf'),-0.1,10.1,True,4.55,'5']:
            d=copy.deepcopy(self.data);d['nodes'][0]['value']=bad
            with self.assertRaises(ValueError):r.validate(d)
        for mutate in [lambda d:d['nodes'][1].update(id=1),lambda d:d['acts'][1].update(first=6),
                       lambda d:d.update(bgm_nodes=[99]),lambda d:d['nodes'][0].update(annotation='全片最高峰')]:
            d=copy.deepcopy(self.data);mutate(d)
            with self.assertRaises(ValueError):r.validate(d)

    def test_cli_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            target=Path(temp)/'chart.png';target.write_bytes(b'existing approved image')
            command=[sys.executable,'-B',str(r.ROOT/'scripts/render_emotion_curve.py'),str(r.ASSETS/'example.json'),'--output',str(target)]
            result=subprocess.run(command,capture_output=True)
            self.assertNotEqual(result.returncode,0)
            self.assertEqual(target.read_bytes(),b'existing approved image')


if __name__=='__main__':unittest.main()
