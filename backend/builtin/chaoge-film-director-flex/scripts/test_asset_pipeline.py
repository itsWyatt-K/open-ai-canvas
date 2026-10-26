#!/usr/bin/env python3
"""Executable state and starter regressions, not image generation tests."""
import copy
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from init_previs import initialize, default_previs_archive
from style_state import _asset
from workflow_state import validate_execution, parse_execution

ROOT = Path(__file__).resolve().parents[1]

class AssetPipelineTests(unittest.TestCase):
    def setUp(self):
        self.data = parse_execution((_asset('project-ledger-template.md')).read_text(encoding='utf-8'))
        self.data['style_profile'].update(status='confirmed',medium='live_action',source_kind='legacy',
            confirmed_revision='R01',confirmation_source='测试夹具：已确认真人P1',
            features='真人自然侧光',performance_scale='克制自然')
        self.fields = {'current_stage': 'P2', 'production_route': 'A_full'}
        self.data['run_scope'] = 'assets_only'
        self.data['asset_review_policy'] = {'mode': 'delegated', 'authorization_source': '用户：由你验收'}
        self.review = {'id': 'R1', 'asset_id': 'CHR-01', 'source': 'upload:portrait.png',
            'reviewed_by': 'agent', 'authorization_source': '用户：由你验收',
            'evidence': 'image', 'visual_status': 'passed', 'spec_status': 'passed',
            'disposition': 'accepted', 'findings': '实际查看身份及布局，实际像素另检'}
        self.data['asset_reviews'] = [self.review]

    def test_authorized_acceptance_does_not_forge_identity(self):
        self.assertEqual(validate_execution(self.data, self.fields), [])
        self.assertFalse(self.data['snapshot']['confirmed'])

    def test_reject_unapproved_agent_and_missing_authorization(self):
        for policy in ({'mode': 'user'}, {'mode': 'delegated'}):
            with self.subTest(policy=policy):
                self.data['asset_review_policy'] = policy
                self.assertTrue(validate_execution(self.data, self.fields))

    def test_prompt_cannot_stand_for_generated_image(self):
        self.review.update(evidence='prompt', visual_status='unverified')
        self.assertTrue(validate_execution(self.data, self.fields))
        self.fields['production_route'] = 'B_prompt_only'
        self.assertEqual(validate_execution(self.data, self.fields), [])
        self.review['visual_status'] = 'passed'
        self.assertTrue(validate_execution(self.data, self.fields))

    def test_failed_spec_needs_explicit_waiver(self):
        self.review['spec_status'] = 'failed'
        self.assertTrue(validate_execution(self.data, self.fields))
        self.review['spec_exception'] = {'user_confirmed': True, 'source': '用户：允许本次小尺寸试用'}
        self.assertEqual(validate_execution(self.data, self.fields), [])

    def test_cannot_adopt_unseen_or_missing_file(self):
        self.review['visual_status'] = 'unverified'
        self.assertTrue(validate_execution(self.data, self.fields))
        self.review.update(visual_status='passed', source='')
        self.assertTrue(validate_execution(self.data, self.fields))

    def test_scope_stops_video_even_when_user_says_continue(self):
        for stage in ('P2V', 'P3A', 'P4', 'P5', 'COMPLETE'):
            with self.subTest(stage=stage):
                self.fields['current_stage'] = stage
                self.assertTrue(any('assets_only' in e for e in validate_execution(self.data, self.fields)))

    def test_optional_fields_keep_legacy_state_compatible(self):
        for key in ('run_scope', 'asset_run_status', 'asset_review_policy', 'asset_reviews'):
            self.data.pop(key, None)
        self.assertEqual(validate_execution(self.data, self.fields), [])

    def test_bad_containers_return_errors(self):
        for key in ('asset_reviews', 'asset_review_policy'):
            data = copy.deepcopy(self.data)
            data[key] = 42
            self.assertTrue(validate_execution(data, self.fields))

    def test_complete_needs_reviews_without_pending_items(self):
        self.data['asset_run_status'] = 'complete'
        self.assertEqual(validate_execution(self.data, self.fields), [])
        self.review['disposition'] = 'pending'
        self.assertTrue(validate_execution(self.data, self.fields))

    def test_initialize_and_preserve_existing_project(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest=Path(tmp)/'studio'
            count=initialize(dest, 'test-studio')
            self.assertGreater(count, 50)
            text=(dest/'app/page.tsx').read_text(encoding='utf-8')
            self.assertIn('test-studio-cameras-v1', text)
            self.assertNotIn('chaoge-avatar', text)
            self.assertFalse((dest/'.openai').exists())
            self.assertFalse((dest/'node_modules').exists())
            for model in ('male', 'female', 'child', 'infant'):
                mesh = dest/'public/models/actors/approved-rig-v6'/f'{model}.glb'
                self.assertEqual(mesh.read_bytes()[:4], b'glTF')
            self.assertIn('approved-rig-v6', (dest/'lib/actor-rig.ts').read_text(encoding='utf-8'))
            self.assertFalse((dest/'public/models/actors/reference-v4').exists())
            self.assertFalse((dest/'public/models/actors/reference-v5').exists())
            self.assertIn('test-studio-camera/7', (dest/'scripts/shared-project-store.mjs').read_text(encoding='utf-8'))
            with self.assertRaises(ValueError): initialize(dest, 'another-studio')
            self.assertEqual(text, (dest/'app/page.tsx').read_text(encoding='utf-8'))

    def test_invalid_keys_and_zip_traversal_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for key in ('../bad', 'AB', 'aa', 'a/x'):
                with self.assertRaises(ValueError): initialize(root/'out', key)
            archive=root/'bad.zip'
            with zipfile.ZipFile(archive,'w') as z: z.writestr('../escape.txt','bad')
            with self.assertRaises(ValueError): initialize(root/'out', 'test-studio', archive)
            self.assertFalse((root/'escape.txt').exists())

    def test_scene_type_defaults_and_explicit_override(self):
        for scene_type, explicit, expected in [('indoor', None, '16:9'),
                ('outdoor', None, '21:9'), ('outdoor', '16:9', '16:9'),
                ('indoor', '2.39:1', '2.39:1')]:
            with self.subTest(scene_type=scene_type, explicit=explicit), tempfile.TemporaryDirectory() as tmp:
                dest=Path(tmp)/'studio'
                initialize(dest, 'aspect-test', scene_type=scene_type, aspect=explicit)
                contract=json.loads((dest/'scene-project.json').read_text(encoding='utf-8'))
                self.assertEqual(contract['sceneType'], scene_type)
                self.assertEqual(contract['defaultAspect'], expected)
                self.assertIn(f"= '{expected}';", (dest/'lib/scene-defaults.ts').read_text(encoding='utf-8'))
                for name in ('app/page.tsx', 'lib/studio.ts'):
                    self.assertIn('DEFAULT_SCENE_ASPECT', (dest/name).read_text(encoding='utf-8'))

    def test_invalid_scene_settings_leave_no_project(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest=Path(tmp)/'studio'
            for kwargs in ({'scene_type': 'unknown'}, {'aspect': '1:1'}):
                with self.assertRaises(ValueError): initialize(dest, 'aspect-test', **kwargs)
                self.assertFalse(dest.exists())

    def test_libtv_requires_adopted_character_sheet(self):
        from test_regressions import state, record
        from validate_ledger import validate as validate_record
        data=state()
        char=data['snapshot']['assets'][0]
        char.update(category='人物', name='程越_未受伤', file_role='character_sheet',
            adoption_status='adopted', confirmation_source='用户确认信息版R2')
        self.assertEqual(validate_record(record(data))[0], [])
        for changes in ({'file_role': 'character_portrait'}, {'adoption_status': 'superseded'},
                {'confirmation_source': ''}, {'user_confirmed': False}, {'category': None},
                {'source': 'C:/definitely-missing-character-sheet.png'}):
            with self.subTest(changes=changes):
                bad=copy.deepcopy(data)
                bad['snapshot']['assets'][0].update(changes)
                self.assertTrue(validate_record(record(bad))[0])

    def test_character_history_can_stay_without_being_uploaded(self):
        from test_regressions import state, record
        from validate_ledger import validate as validate_record
        data=state()
        data['snapshot']['assets'].append({'id': 'CHR-history', 'kind': 'image', 'name': '人物历史竖图',
            'category': '人物', 'file_role': 'character_portrait', 'source': 'upload:portrait.png',
            'revision': 'r1', 'user_confirmed': True})
        self.assertEqual(validate_record(record(data))[0], [])

if __name__ == '__main__':
    unittest.main()
