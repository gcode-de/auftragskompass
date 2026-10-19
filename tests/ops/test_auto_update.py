"""Automatic updates use fictional hosts/images and never touch real Podman."""
import importlib.util
import hashlib
import contextlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / 'scripts/auto_update.py'


class AutoUpdateTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('auto_update', SCRIPT)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.root.chmod(0o700)
        self.config = {'container': 999, 'image': 'docker.io/fictional/auftragskompass',
                       'state_dir': str(self.root)}
        self.old = 'a' * 40
        self.new = 'b' * 40
        self.events = []

    def api(self, path):
        if 'git/ref/' in path:
            return {'object': {'sha': self.new}}
        if 'compare/' in path:
            return {'status': 'ahead'}
        return {'workflow_runs': [{'head_sha': self.new, 'head_branch': 'codex/local-runtime-ci',
                'event': 'push', 'status': 'completed', 'conclusion': 'success',
                'path': '.github/workflows/quality.yml', 'id': 1}]}

    def test_public_github_uses_no_credentials_and_rejects_redirects_or_oversized_responses(self):
        with patch.object(self.module.urllib.request, 'build_opener') as build:
            build.return_value.open.return_value = contextlib.nullcontext(io.BytesIO(b'{"fictional":true}'))
            self.assertEqual(self.module.github('fictional'), {'fictional': True})
            request = build.return_value.open.call_args.args[0]
            self.assertIsNone(request.get_header('Authorization'))
            self.assertIsNone(build.call_args.args[0].redirect_request(None, None, 302, '', {}, 'https://evil.example.invalid'))
            build.return_value.open.return_value = contextlib.nullcontext(io.BytesIO(b' ' * (1024 * 1024 + 1)))
            with self.assertRaises(ValueError):
                self.module.github('fictional')

    def remote(self, config, args, **kwargs):
        self.events.append(args)
        if args[:2] == ['podman', 'inspect']:
            revision = self.new if ['systemctl', 'start', 'ak-test-admin.service'] in self.events else self.old
            return '\n'.join([revision + ' healthy'] * 3)
        if args[:3] == ['podman', 'image', 'inspect']:
            return 'sha256:' + 'c' * 64 + ' ' + self.new
        if args[0] == 'cat':
            return 'Image=docker.io/fictional/old\nEnvironment=AK_BUILD_REVISION=' + self.old + '\n'
        return ''

    def execute(self, **kwargs):
        with patch.object(self.module, 'github', side_effect=self.api), \
                patch.object(self.module, 'remote', side_effect=self.remote), \
                patch.object(self.module, 'copy_backup', side_effect=lambda *args: self.events.append(['verified-copy'])):
            return self.module.update(self.config, **kwargs)

    def test_update_backs_up_before_replacing_three_pinned_images(self):
        self.assertEqual(self.execute(), 'updated')
        copy = self.events.index(['verified-copy'])
        writes = [i for i, args in enumerate(self.events) if args[:2] == ['python3', '-c']]
        self.assertEqual(len(writes), 3)
        self.assertTrue(all(i > copy for i in writes))
        self.assertTrue(any('update_checkpoint.py' in ' '.join(args) for args in self.events[:copy]))
        self.assertFalse((self.root / 'needs-attention').exists())
        self.assertEqual(json.loads((self.root / 'last-success.json').read_text())['revision'], self.new)

    def test_current_pending_failed_foreign_or_incomplete_run_never_pulls(self):
        for changes in [{'status': 'in_progress'}, {'conclusion': 'failure'},
                        {'head_sha': self.old}, {'event': 'pull_request'},
                        {'head_branch': 'main'}, {'path': '.github/workflows/other.yml'}]:
            original = self.api
            def api(path):
                result = original(path)
                if 'workflow_runs' in result:
                    result['workflow_runs'][0].update(changes)
                return result
            with self.subTest(changes=changes), patch.object(self.module, 'github', side_effect=api), \
                    patch.object(self.module, 'remote', side_effect=self.remote):
                self.events.clear()
                self.assertEqual(self.module.update(self.config), 'waiting-for-green-head')
                self.assertFalse(self.events)

    def test_same_revision_is_noop_and_non_forward_revision_is_rejected(self):
        self.new = self.old
        self.assertEqual(self.execute(), 'current')
        self.assertFalse((self.root / 'needs-attention').exists())
        self.new = 'b' * 40
        original = self.api
        with patch.object(self.module, 'github', side_effect=lambda path: {'status': 'diverged'} if 'compare/' in path else original(path)), \
                patch.object(self.module, 'remote', side_effect=self.remote):
            with self.assertRaises(RuntimeError):
                self.module.update(self.config)

    def test_image_revision_mismatch_cannot_stop_services(self):
        original = self.remote
        def remote(config, args, **kwargs):
            return 'sha256:' + 'c' * 64 + ' ' + self.old if args[:3] == ['podman', 'image', 'inspect'] else original(config, args, **kwargs)
        with patch.object(self.module, 'github', side_effect=self.api), patch.object(self.module, 'remote', side_effect=remote):
            with self.assertRaises(RuntimeError):
                self.module.update(self.config)
        self.assertFalse((self.root / 'needs-attention').exists())

    def test_checkpoint_copy_write_and_start_failures_block_future_updates_without_rollback(self):
        for phase in ['checkpoint', 'copy', 'write', 'start']:
            original = self.remote
            def remote(config, args, **kwargs):
                if ((phase == 'checkpoint' and 'update_checkpoint.py' in ' '.join(args))
                    or (phase == 'write' and args[:2] == ['python3', '-c'])
                    or (phase == 'start' and args[:2] == ['systemctl', 'start'])):
                    raise subprocess.CalledProcessError(1, args)
                return original(config, args, **kwargs)
            marker = self.root / 'needs-attention'
            marker.unlink(missing_ok=True)
            self.events.clear()
            with self.subTest(phase=phase), patch.object(self.module, 'github', side_effect=self.api), \
                    patch.object(self.module, 'remote', side_effect=remote), \
                    patch.object(self.module, 'copy_backup', side_effect=OSError('private detail') if phase == 'copy' else None):
                with self.assertRaises((OSError, subprocess.CalledProcessError)):
                    self.module.update(self.config)
                self.assertTrue(marker.exists())
                self.events.clear()
                with self.assertRaises(RuntimeError):
                    self.module.update(self.config)
                self.assertEqual(self.events, [])

    def test_backup_copy_requires_matching_size_and_hash_and_private_output(self):
        payload = b'fictional backup contents'
        for corrupt in [False, True]:
            destination = self.root / ('copy-' + str(corrupt))
            def remote(config, args, **kwargs):
                return str(len(payload)) if args[0] == 'stat' else hashlib.sha256(payload).hexdigest() + ' fictional.dump'
            def copy(*args, **kwargs):
                kwargs['stdout'].write(b'fictional damaged contents' if corrupt else payload)
            with self.subTest(corrupt=corrupt), patch.object(self.module, 'remote', side_effect=remote), \
                    patch.object(self.module.subprocess, 'run', side_effect=copy):
                if corrupt:
                    with self.assertRaises(RuntimeError):
                        self.module.copy_backup(self.config, '/fictional.dump', destination)
                else:
                    self.module.copy_backup(self.config, '/fictional.dump', destination)
                    self.assertEqual(destination.read_bytes(), payload)
                    self.assertEqual(destination.stat().st_mode & 0o777, 0o600)

    def test_check_only_has_no_update_side_effect_and_unhealthy_start_is_blocked(self):
        self.assertEqual(self.execute(check_only=True), 'update-available')
        self.assertFalse((self.root / 'needs-attention').exists())
        original = self.remote
        def remote(config, args, **kwargs):
            if args[:2] == ['podman', 'inspect'] and ['systemctl', 'start', 'ak-test-admin.service'] in self.events:
                return '\n'.join([self.new + ' unhealthy'] * 3)
            return original(config, args, **kwargs)
        with patch.object(self.module, 'github', side_effect=self.api), \
                patch.object(self.module, 'remote', side_effect=remote), patch.object(self.module, 'copy_backup'):
            with self.assertRaises(RuntimeError):
                self.module.update(self.config)
            self.assertTrue((self.root / 'needs-attention').exists())


if __name__ == '__main__':
    unittest.main()
