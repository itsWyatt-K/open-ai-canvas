"""Exercise actual FFmpeg measurements and no-audio/multiple-track boundaries."""
from pathlib import Path
import json,hashlib,shutil,subprocess,tempfile,unittest
from audio_inspect import inspect

@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'),'FFmpeg unavailable')
class AudioInspectTests(unittest.TestCase):
    def test_actual_measurement_preserves_source(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'tone.wav'
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=frequency=440:duration=1.5','-ar','48000','-c:a','pcm_s24le',str(p)],check=True)
            old=hashlib.sha256(p.read_bytes()).hexdigest();r=inspect(p)
            self.assertEqual(r['status'],'measured');self.assertFalse(r['listened_to_audio'])
            self.assertLess(float(r['measurements']['input_tp']),0)
            self.assertEqual(old,hashlib.sha256(p.read_bytes()).hexdigest())
    def test_silent_video_is_not_an_audio_track(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'silent.mp4'
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=black:s=64x64:d=0.2','-an','-c:v','libx264',str(p)],check=True)
            r=inspect(p);self.assertEqual(r['status'],'no_audio');self.assertIsNone(r['measurements'])
    def test_multiple_tracks_require_explicit_selection(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'two.mka'
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=frequency=440:duration=1','-map','0:a','-map','0:a','-c:a','pcm_s16le',str(p)],check=True)
            with self.assertRaisesRegex(ValueError,'多个音轨'):inspect(p)
            self.assertEqual(inspect(p,1)['audio_stream'],1)
            with self.assertRaisesRegex(ValueError,'越界'):inspect(p,2)

if __name__=='__main__':unittest.main()
