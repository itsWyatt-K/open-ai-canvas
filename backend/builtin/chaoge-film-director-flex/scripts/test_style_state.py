"""Real record transitions and preset-file checks; no claim of model video testing."""
import copy,json,hashlib,unittest,re,itertools,subprocess,shutil
import struct
from pathlib import Path
from style_state import validate_style, validate_preset_prompt, MEDIA, PRESETS, _asset
from workflow_state import parse_execution
from validate_ledger import validate as validate_record
from validate_prompt import validate as validate_video_prompt
from test_regressions import state as video_state, record as video_record, prompt as video_prompt
ROOT=Path(__file__).resolve().parents[1]

class StyleStateTests(unittest.TestCase):
    def setUp(self):
        self.d=parse_execution((ROOT/'assets/project-state-template.md').read_text(encoding='utf-8'))
        self.f={'current_stage':'P0S','production_route':'B_prompt_only'}
    def choose(self,medium=None,kind='preset',preset_id='linglong_3d'):
        preset=PRESETS[preset_id]
        self.d['style_profile'].update(status='confirmed',medium=medium or preset['medium'],
            preset_id=preset_id,preset_revision=preset['revision'],
            source_kind=kind,confirmed_revision='R01',confirmation_source='用户：选择'+preset['name'],
            features=preset['features'],performance_scale='克制自然')
        if kind=='preset': self.d['style_profile']['references']=[self.reference(preset_id)]
    def reference(self,preset_id='linglong_3d'):
        return dict(source=str(_asset('style-presets')/PRESETS[preset_id]['references'][0]['image']),
            role='global_style',media_kind='image',visually_reviewed=True)
    def test_pending_can_wait_but_not_enter_analysis(self):
        self.assertEqual(validate_style(self.d,self.f),[])
        self.f['current_stage']='P0A'
        self.assertTrue(validate_style(self.d,self.f))
        self.choose();self.assertEqual(validate_style(self.d,self.f),[])
    def test_route_required_before_analysis(self):
        self.choose();self.f.update(current_stage='P0A',production_route='待确认')
        self.assertTrue(validate_style(self.d,self.f))
    def test_custom_requires_seen_image_not_audio_filename_or_claim(self):
        self.choose(kind='custom')
        self.assertTrue(validate_style(self.d,self.f))
        self.d['style_profile']['references']=[self.reference()]
        self.assertEqual(validate_style(self.d,self.f),[])
        for change in ({'visually_reviewed':False},{'media_kind':'audio'},{'role':'spatial'},{'source':'missing.png'}):
            d=copy.deepcopy(self.d);d['style_profile']['references'][0].update(change)
            self.assertTrue(validate_style(d,self.f),change)
    def test_c_conflicts_and_text_escape_are_explicit(self):
        self.choose();self.f['production_route']='C_direct_video'
        self.assertTrue(validate_style(self.d,self.f))
        self.d['asset_preflight'].update(status='text_authorized',basis='用户：纯文字视频',unresolved_conflicts=[])
        self.assertEqual(validate_style(self.d,self.f),[])
        self.d['asset_preflight']['unresolved_conflicts']=['真人人物与二维主体尚未决定']
        self.assertTrue(validate_style(self.d,self.f))
    def test_preset_matches_medium(self):
        for preset_id,preset in PRESETS.items():
            self.choose(preset_id=preset_id)
            self.assertEqual(validate_style(self.d,self.f),[])
            for other_medium in MEDIA-{preset['medium']}:
                self.d['style_profile']['medium']=other_medium
                self.assertTrue(validate_style(self.d,self.f),(preset_id,other_medium))
    def test_missing_or_unknown_preset_does_not_fall_back_to_first(self):
        self.choose()
        for preset_id in ('','not_installed',None):
            self.d['style_profile']['preset_id']=preset_id
            self.assertTrue(validate_style(self.d,self.f),preset_id)
    def test_video_needs_current_style_revision(self):
        self.choose();self.f['current_stage']='P4'
        self.assertTrue(validate_style(self.d,self.f))
        self.d['unit']['style_revision']='R01'
        self.assertEqual(validate_style(self.d,self.f),[])
        self.d['style_profile'].update(revision='R02',confirmed_revision='R02')
        self.assertTrue(validate_style(self.d,self.f))
    def test_legacy_not_forced_back_to_entry(self):
        self.d.pop('workflow_revision');self.d.pop('style_profile')
        self.f.update(current_stage='P4',production_route='C_direct_video')
        self.assertEqual(validate_style(self.d,self.f),[])
    def test_new_marker_cannot_omit_profile(self):
        self.d.pop('style_profile')
        self.assertTrue(validate_style(self.d,self.f))
    def test_malformed_fields_report_errors(self):
        self.choose(kind='custom')
        for refs in (42,['not a reference']):
            self.d['style_profile']['references']=refs
            self.assertTrue(validate_style(self.d,self.f))
    def test_all_new_template_entry_stages_validate(self):
        for name in ('project-ledger-template.md','project-state-template.md'):
            text=(ROOT/'assets'/name).read_text(encoding='utf-8')
            for stage in ('P0','P0R','P0S'):
                self.assertEqual(validate_record(text.replace('current_stage: "P0"',f'current_stage: "{stage}"'))[0],[])
    def test_preset_images_match_provenance(self):
        folder=_asset('style-presets')
        presets=json.loads((folder/'catalog.json').read_text(encoding='utf-8'))['presets']
        ids=[p['id'] for p in presets]
        self.assertEqual(len(ids),len(set(ids)))
        for preset_id,medium in {'linglong_3d':'stylized_3d','painterly_3d2d':'stylized_3d',
                                 'inkwash_2d':'handdrawn_2d','pixar_3d':'stylized_3d',
                                 'live_action_drama':'live_action'}.items():
            self.assertEqual(PRESETS[preset_id]['medium'],medium)
        self.assertEqual(PRESETS['inkwash_2d']['revision'],'R01')
        for p in presets:
            self.assertIn(p['medium'],MEDIA)
            self.assertTrue(p['name'].strip())
            self.assertTrue(p['selection_description'].strip())
            self.assertTrue((ROOT/p['guide']).is_file())
            self.assertEqual(len(p['references']),8)
            self.assertEqual(len({r['image'] for r in p['references']}),8)
            self.assertEqual(len({r['sha256'] for r in p['references']}),8)
            for r in p['references']:
                path=(folder/r['image']).resolve()
                self.assertTrue(path.is_relative_to((folder/p['id']/'references').resolve()))
                content=path.read_bytes()
                self.assertTrue(content.startswith(b'\x89PNG\r\n\x1a\n'))
                self.assertEqual(hashlib.sha256(content).hexdigest(),r['sha256'])
                self.assertEqual(r['dimensions'],list(struct.unpack('>II',content[16:24])))
            for key,pathfield in [('preview_video','file'),('overview','image')]:
                if key not in p: continue
                item=p[key];path=(folder/item[pathfield]).resolve()
                self.assertTrue(path.is_relative_to((folder/p['id']).resolve()))
                self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),item['sha256'])
            preview=p['preview_video']
            self.assertEqual(preview['role'],'selection_preview_only')
            if preview['contains_bgm'] is None:
                self.assertFalse(preview['bgm_presence_verified'])
                self.assertFalse(preview['audio_auditioned'])
            else:
                self.assertIsInstance(preview['contains_bgm'],bool)
            self.assertIsInstance(preview['audio_auditioned'],bool)
        for old in ('live_action.png','stylized_3d.png','handdrawn_2d.png'):
            self.assertFalse((folder/old).exists())
    @unittest.skipUnless(shutil.which('ffprobe'),'ffprobe unavailable; media metadata not verified')
    def test_preview_metadata_matches_decoded_video(self):
        for preset in PRESETS.values():
            item=preset['preview_video']
            path=_asset('style-presets')/item['file']
            result=subprocess.run(['ffprobe','-v','error','-count_frames',
                '-show_entries','stream=codec_type,width,height,nb_read_frames',
                '-of','json',str(path)],capture_output=True,text=True,encoding='utf-8')
            self.assertEqual(result.returncode,0,(preset['id'],result.stderr))
            streams=json.loads(result.stdout)['streams']
            videos=[s for s in streams if s['codec_type']=='video']
            self.assertEqual(len(videos),1,preset['id'])
            self.assertEqual([videos[0]['width'],videos[0]['height']],item['dimensions'])
            self.assertEqual(int(videos[0]['nb_read_frames']),item['frames'])
            self.assertTrue(any(s['codec_type']=='audio' for s in streams),preset['id'])
    def test_retired_presets_rejected_but_legacy_keeps_approved_medium(self):
        for old in ('live_action','stylized_3d','handdrawn_2d'):
            self.choose(medium=old);self.d['style_profile']['preset_id']=old
            self.assertTrue(validate_style(self.d,self.f))
            self.d['style_profile']['source_kind']='legacy'
            self.assertEqual(validate_style(self.d,self.f),[])
    def test_overview_or_video_cannot_replace_reading_original(self):
        self.choose();r=self.d['style_profile']['references'][0]
        for name in ('overview.jpg','preview.mp4'):
            r['source']=str(_asset('style-presets', 'linglong_3d')/name)
            self.assertTrue(validate_style(self.d,self.f))
    def test_all_catalog_presets_through_routes_and_video(self):
        for preset in PRESETS:
            for route in ('A_full','B_prompt_only','C_direct_video'):
                self.choose(preset_id=preset)
                self.d['asset_preflight'].update(status='reviewed',basis='已读取并确认项目素材',unresolved_conflicts=[])
                self.d['unit']['style_revision']='R01'
                for stage in ('P0A','P1','P2','P2S','P2V','P3A','P3B','P4','P5','P6','P7','COMPLETE'):
                    self.f.update(current_stage=stage,production_route=route)
                    self.assertEqual(validate_style(self.d,self.f),[],(preset,route,stage))
    def test_switch_cannot_reuse_previous_preset_reference(self):
        for old,new in itertools.permutations(PRESETS,2):
            self.choose(preset_id=new)
            self.d['style_profile']['references']=[self.reference(old)]
            self.assertTrue(validate_style(self.d,self.f))
            self.d['style_profile']['references'].append(self.reference(new))
            self.assertTrue(validate_style(self.d,self.f),'old global reference remained active')
            self.d['style_profile']['references'][0]['role']='look_only'
            self.assertEqual(validate_style(self.d,self.f),[],'local color reference is a separate role')
    def test_all_presets_reject_preview_unseen_image_and_wrong_revision(self):
        for preset_id,preset in PRESETS.items():
            self.choose(preset_id=preset_id);p=self.d['style_profile'];r=p['references'][0]
            self.assertEqual(validate_style(self.d,self.f),[])
            r['visually_reviewed']=False
            self.assertTrue(validate_style(self.d,self.f))
            r['visually_reviewed']=True;p['preset_revision']='R00'
            self.assertTrue(validate_style(self.d,self.f))
            p['preset_revision']=preset['revision']
            r['source']=str(_asset('style-presets')/preset['preview_video']['file'])
            self.assertTrue(validate_style(self.d,self.f))
    def test_selection_gallery_has_six_styles_in_fixed_order_and_real_media(self):
        from render_style_gallery import render
        expected=['live_action_film','live_action_drama','linglong_3d','pixar_3d','painterly_3d2d','inkwash_2d']
        self.assertEqual(list(PRESETS),expected)
        text=render();rows=[line for line in text.splitlines() if line.startswith('| **')]
        self.assertEqual(len(rows),3)
        self.assertEqual(text.count('<br><br>'),6)
        self.assertEqual(text.count('!['),6)
        self.assertNotIn('自定义',text)
        for i,p in enumerate(PRESETS.values(),1):
            self.assertIn(f"**{i}｜{p['name']}**",text)
            selected=p.get('selection_preview',p['preview_video'])
            path=_asset('style-presets')/selected['file']
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),selected['sha256'])
            self.assertIn(path.resolve().as_posix(),text)

    def test_catalog_styles_compile_as_two_paragraph_video_style(self):
        for preset_id,preset in PRESETS.items():
            self.choose(preset_id=preset_id)
            data=video_state();data['style_profile']=copy.deepcopy(self.d['style_profile'])
            data['asset_preflight'].update(status='reviewed',basis='已确认现有风格资产',unresolved_conflicts=[])
            prefix=preset.get('prompt_rules',{}).get('video_style_prefix',preset['name']+'。')
            style=(prefix+preset['features']+'\n\n'
                   '当前片段为上午09:00。继承已确认资产的明暗与绘制表现，窗外日光照亮人物与桌面，'
                   '暗部保留层次，局部暖光有明确范围。禁止写实毛孔、摄影颗粒和过曝光晕。')
            text=re.sub(r'(?<=【风格锁定】)\n.*?(?=\n【素材映射】)','\n'+style+'\n\n',
                        video_prompt(),flags=re.S)
            for route in ('A_full','B_prompt_only','C_direct_video'):
                errors,_=validate_video_prompt(text,'libtv',handoff_mode='off',
                                               state_text=video_record(data,route=route))
                self.assertEqual(errors,[],(preset_id,route,errors))
            one_paragraph=text.replace(style,style.replace('\n\n','\n'))
            self.assertTrue(validate_video_prompt(one_paragraph,'libtv',handoff_mode='off',
                                                  state_text=video_record(data))[0])
            data['style_profile'].update(revision='R02',confirmed_revision='R02')
            errors,_=validate_video_prompt(text,'libtv',handoff_mode='off',state_text=video_record(data))
            self.assertTrue(any('风格版本' in e for e in errors))
            data['unit']['style_revision']='R02'
            self.assertEqual(validate_video_prompt(text,'libtv',handoff_mode='off',
                                                   state_text=video_record(data))[0],[])
    def test_general_audio_has_no_visual_preset_gate(self):
        text=(ROOT/'references/audio_finishing.md').read_text(encoding='utf-8')
        for token in ('母带级处理','二维','3D','口播','没有实际执行的项目标为未检'):
            self.assertIn(token,text)
        self.assertNotIn('原声测量：约-30.10',text)

    def test_pixar_prompt_rules_are_scoped_and_do_not_rewrite_text(self):
        self.choose(preset_id='pixar_3d')
        data=video_state();data['style_profile']=copy.deepcopy(self.d['style_profile'])
        data['asset_preflight'].update(status='reviewed',basis='已确认项目素材',unresolved_conflicts=[])
        style=('3D皮克斯动画质感。圆润轮廓与柔和材质，成年人比例清楚，表演克制。\n\n'
               '当前为冬季晚上20:00，局部暖光与冷暗部有层次，曝光沿用本片色卡。')
        good=re.sub(r'(?<=【风格锁定】)\n.*?(?=\n【素材映射】)','\n'+style+'\n\n',
                    video_prompt(),flags=re.S)
        record=video_record(data)
        self.assertEqual(validate_video_prompt(good,'libtv',handoff_mode='off',state_text=record)[0],[])
        for alternative in ('3D动画质感。','3D皮克斯画风。'):
            bad=good.replace('3D皮克斯动画质感。',alternative,1)
            self.assertTrue(any('首句' in e for e in validate_video_prompt(
                bad,'libtv',handoff_mode='off',state_text=record)[0]))
        for location in ('风格锁定','素材映射','场景与空间锚点','镜头序列','声音设计','全局补充'):
            bad=good.replace('【'+location+'】','【'+location+'】\n黄色出租车。',1)
            self.assertTrue(any('要求省略' in e for e in validate_video_prompt(
                bad,'libtv',handoff_mode='off',state_text=record)[0]),location)
        # Real upload filenames outside the submitted code block remain intact.
        with_path=good.replace('【本批上传ID映射】','【本批上传ID映射】\n素材文件：黄色出租车.png',1)
        self.assertEqual(validate_video_prompt(with_path,'libtv',handoff_mode='off',state_text=record)[0],[])
        original='成年人穿黄色外套。'
        self.assertTrue(validate_preset_prompt(original,'pixar_3d'))
        self.assertEqual(original,'成年人穿黄色外套。')
        self.assertEqual(validate_preset_prompt(original,'painterly_3d2d'),[])
        self.assertEqual(validate_preset_prompt('成年人外观依采用图，表演克制。','pixar_3d'),[])
        # No age or traffic-light prohibition was inferred from this case.
        self.assertEqual(validate_preset_prompt('儿童在路边等车。信号灯变为黄灯。','pixar_3d'),[])
        generic=good.replace(style,style.replace('3D皮克斯动画质感。','3渲2厚涂风。')+'黄色道具。')
        self.choose(preset_id='painterly_3d2d');data['style_profile']=copy.deepcopy(self.d['style_profile'])
        self.assertFalse(any('要求省略' in e or '首句' in e for e in validate_video_prompt(
            generic,'libtv',handoff_mode='off',state_text=video_record(data))[0]))

if __name__=='__main__':unittest.main()
