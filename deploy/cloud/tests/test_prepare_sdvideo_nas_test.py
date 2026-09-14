"""使用合成配置验证 ECS 增量配置，不连接 ECS、NAS 或 Provider。"""
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / 'prepare-sdvideo-nas-test.py'
spec = importlib.util.spec_from_file_location('prepare_sdvideo', SCRIPT)
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)
IMAGE = 'sha256:' + 'a' * 64


class PrepareTests(unittest.TestCase):
    def setUp(self):
        self.cfg = tool.make_overlay(IMAGE)

    def test_entry_stays_closed(self):
        for name in ('api', 'sd-video-bridge'):
            env = self.cfg['services'][name]['environment']
            self.assertEqual(env['SD_VIDEO_MODE'], 'disabled')
            self.assertTrue(env['SD_VIDEO_BASE_URL'].startswith('https://'))
            self.assertTrue(env['SD_VIDEO_CA_FILE'])

    def test_bridge_reuses_current_image(self):
        self.assertEqual(self.cfg['services']['sd-video-bridge']['image'], IMAGE)
        with self.assertRaises(ValueError):
            tool.make_overlay('unverified:latest')

    def test_workers_share_image_and_keep_real_auth(self):
        images = set()
        for name in tool.SD_SERVICES:
            service = self.cfg['services'][name]
            images.add(service['image'])
            env = service['environment']
            self.assertEqual(env['SD_VIDEO_EXECUTION_MODE'], 'mock')
            self.assertEqual(env['APP_ENV'], 'development')
            self.assertEqual(env['LOCAL_DEMO_MODE'], 'false')
            self.assertEqual(env['ALLOW_CORS'], 'false')
            self.assertEqual(env['SERVICE_JWT_ALGORITHMS'], 'EdDSA')
        self.assertEqual(len(images), 1)

    def test_four_new_buckets_and_no_paid_keys(self):
        for name in tool.SD_SERVICES:
            env = self.cfg['services'][name]['environment']
            buckets = [v for k, v in env.items() if k.endswith('_BUCKET')]
            self.assertEqual(set(buckets), {'studio-sdvideo-test-' + s for s in
                                           ('inputs', 'results', 'thumbnails', 'volcano')})
            for key in ('ARK_API_KEY', 'SEEDANCE20_KEY', 'VIDU_API_KEY', 'YIKE_API_KEY', 'AMK_API_KEY'):
                self.assertEqual(env[key], '')
                self.assertEqual(env[key + '_FILE'], '')
            self.assertEqual(env['SDVIDEO_SUPABASE_PUBLIC_URL'], 'https://sd.ggwp.cn:18000')

    def test_rotating_token_directory_and_group_isolation(self):
        for name, role, group in [(n, 'sdvideo', '21002') for n in tool.SD_SERVICES] + [
                ('sd-video-bridge', 'studio', '21001')]:
            service = self.cfg['services'][name]
            mounts = [v for v in service['volumes'] if isinstance(v, dict)
                      and v['target'] == '/run/storage-credentials']
            self.assertEqual(len(mounts), 1)
            self.assertEqual(mounts[0]['source'], '/srv/studio-storage-tokens/' + role)
            self.assertTrue(mounts[0]['read_only'])
            self.assertFalse(mounts[0]['bind']['create_host_path'])
            self.assertEqual(service['group_add'], [group])

    def test_private_keys_are_not_shared(self):
        for name in tool.SD_SERVICES:
            mounts = self.cfg['services'][name]['volumes']
            self.assertFalse(any(isinstance(v, dict) and v['source'].endswith('/studio') for v in mounts))
            self.assertFalse(any(isinstance(v, dict) and v['source'].endswith('/ca') for v in mounts))
        for name in ('sd-video-worker', 'sd-video-asset-worker'):
            self.assertFalse(any(isinstance(v, dict) and v['target'] == '/run/sdvideo-tls'
                                 for v in self.cfg['services'][name]['volumes']))

    def test_private_database_and_new_volumes(self):
        tool.validate_config(self.cfg)
        for name in ('sd-video-postgres', 'sd-video-redis'):
            self.assertEqual(self.cfg['services'][name]['networks'], {'sdvideo_private': {}})
        self.assertTrue(self.cfg['networks']['sdvideo_private']['internal'])
        self.assertTrue(self.cfg['networks']['sdvideo_link']['internal'])
        self.assertEqual(set(self.cfg['volumes']), set(tool.PRIVATE_VOLUMES))

    def test_invalid_merged_configuration_is_rejected(self):
        self.cfg['services']['sd-video-api']['ports'] = [{'published': 8201}]
        with self.assertRaises(ValueError):
            tool.validate_config(self.cfg)

    def test_generated_keys_tls_and_database_password(self):
        openssl = shutil.which('openssl') or 'C:/Program Files/Git/mingw64/bin/openssl.exe'
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / 'new-test-vault'
            tool.generate_credentials(root, openssl)
            public = tool.run([openssl, 'pkey', '-in', str(root / 'studio/signing.pem'), '-pubout'])
            self.assertEqual(public, (root / 'sdvideo/verifier.pem').read_text().strip())
            self.assertIn('OK', tool.run([openssl, 'verify', '-CAfile', str(root / 'ca/ca.crt'),
                                          '-verify_hostname', 'sd-video-api', str(root / 'tls/server.crt')]))
            password = (root / 'database/password').read_text().strip()
            self.assertRegex(password, r'^[a-f0-9]{64}$')
            self.assertIn(':' + password + '@sd-video-postgres:5432/sdvideo_cloud',
                          (root / 'sdvideo/database-url').read_text())
            before = (root / 'studio/signing.pem').read_bytes()
            with self.assertRaises(FileExistsError):
                tool.generate_credentials(root, openssl)
            self.assertEqual(before, (root / 'studio/signing.pem').read_bytes())

    def test_exclusive_write_preserves_existing_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'output.json'
            tool.write_new(path, 'existing')
            with self.assertRaises(FileExistsError):
                tool.write_new(path, 'replacement')
            self.assertEqual(path.read_text(), 'existing')

    def test_actual_compose_merge_without_daemon_or_real_env(self):
        project = SCRIPT.parents[2]
        base = project / 'docker-compose.yml'
        env = {k: v for k, v in os.environ.items() if k.upper() in {
            'PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'APPDATA',
            'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'USERPROFILE', 'HOME'}}
        env['COMPOSE_DISABLE_ENV_FILE'] = '1'
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            values = '\n'.join(k + '=isolated-test-only' for k in
                               set(re.findall(r'\$\{([A-Z0-9_]+):?\?', base.read_text(encoding='utf-8'))))
            (root / 'test.env').write_text(values, encoding='utf-8')
            (root / 'overlay.json').write_text(json.dumps(self.cfg), encoding='utf-8')
            p = subprocess.run(['docker', 'compose', '--env-file', str(root / 'test.env'),
                                '-f', str(base), '-f', str(root / 'overlay.json'),
                                '--profile', 'sd-video', 'config', '--format', 'json'],
                               capture_output=True, text=True, env=env, timeout=30)
            self.assertEqual(p.returncode, 0, p.stderr)
            merged = json.loads(p.stdout)
            tool.validate_config(merged)
            for name, target in (('sd-video-postgres', '/var/lib/postgresql/data'),
                                 ('sd-video-redis', '/data'), ('sd-video-api', '/app/data')):
                mounts = [m for m in merged['services'][name]['volumes'] if m['target'] == target]
                self.assertEqual(len(mounts), 1)
                self.assertTrue(mounts[0]['source'].startswith('sdvideo-nas-test-'))
            # 原 Studio 资产卷保持不变；不把新的 SD-video DB 挂进 Studio。
            self.assertTrue(any(m.get('source') == 'ai-manju-assets'
                                for m in merged['services']['api']['volumes']))
            self.assertNotIn('web', self.cfg['services'])


if __name__ == '__main__':
    unittest.main()
