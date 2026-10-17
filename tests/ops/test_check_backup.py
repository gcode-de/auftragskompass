"""Read-only monitoring uses fictional receipts and never needs a decryption key."""
import contextlib
from datetime import datetime, timedelta, timezone
import fcntl
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import check_backup as MODULE


class CheckBackupTests(unittest.TestCase):
    def fixture(self, root):
        name = 'backup-20261017T120000000000Z-abcdef12.cms'
        data = b'Fictional encrypted bytes'
        (root / name).write_bytes(data)
        receipt = {
            'version': 1, 'status': 'ok', 'finishedAt': datetime.now(timezone.utc).isoformat(),
            'project': 'fictional-test', 'file': name, 'bytes': len(data),
            'plaintextSha256': 'a' * 64, 'ciphertextSha256': hashlib.sha256(data).hexdigest(),
        }
        (root / '.backup.lock').write_bytes(b'')
        self.publish(root, receipt)
        for file in root.iterdir():
            file.chmod(0o600)
        return receipt

    def publish(self, root, receipt):
        for name in ['last-success.json', 'last-attempt.json', receipt['file'] + '.json']:
            path = root / name
            path.write_text(json.dumps(receipt))
            path.chmod(0o600)

    def invoke(self, root, extra=()):
        output = io.StringIO()
        with patch('sys.argv', ['check_backup.py', '--project', 'fictional-test', '--directory', str(root), *extra]), contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            try:
                MODULE.main()
            except SystemExit as error:
                return error.code, output.getvalue()
        return 0, output.getvalue()

    def test_fresh_checksum_matches_and_check_never_changes_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            before = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in root.iterdir()}
            code, output = self.invoke(root)
            self.assertEqual(code, 0, output)
            self.assertEqual(json.loads(output), {'status': 'ok'})
            self.assertEqual(before, {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in root.iterdir()})
            self.assertNotIn(directory, output)

    def test_age_failed_attempt_and_future_clock_do_not_claim_success(self):
        for change in ['stale', 'future', 'naive', 'failed', 'inconsistent', 'wrong-project']:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                receipt = self.fixture(root)
                if change == 'stale':
                    receipt['finishedAt'] = (datetime.now(timezone.utc) - timedelta(hours=27)).isoformat()
                elif change == 'future':
                    receipt['finishedAt'] = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
                elif change == 'naive':
                    receipt['finishedAt'] = datetime.now().isoformat()
                elif change == 'wrong-project':
                    receipt['project'] = 'other-fictional'
                self.publish(root, receipt)
                if change == 'failed':
                    (root / 'last-attempt.json').write_text(json.dumps({'version': 1, 'status': 'failed', 'phase': 'Fictional private diagnostic'}))
                if change == 'inconsistent':
                    (root / (receipt['file'] + '.json')).write_text('{}')
                code, output = self.invoke(root)
                self.assertNotEqual(code, 0)
                self.assertEqual(json.loads(output)['status'], 'failed')
                self.assertNotIn('private diagnostic', output)
                self.assertNotIn(directory, output)

    def test_missing_corrupt_files_permissions_and_paths_fail_closed(self):
        for change in ['missing-status', 'bad-json', 'large-json', 'bad-shape', 'wrong-version', 'bad-bytes', 'bad-hash', 'changed', 'missing-file', 'symlink', 'traversal', 'public-file', 'public-directory']:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                receipt = self.fixture(root)
                target = root / receipt['file']
                if change == 'missing-status':
                    (root / 'last-success.json').unlink()
                elif change == 'bad-json':
                    (root / 'last-success.json').write_text('{Fictional private diagnostic')
                elif change == 'large-json':
                    (root / 'last-success.json').write_bytes(b' ' * 20000)
                elif change == 'bad-shape':
                    (root / 'last-success.json').write_text('[]')
                elif change == 'wrong-version':
                    receipt['version'] = 2
                    self.publish(root, receipt)
                elif change == 'bad-bytes':
                    receipt['bytes'] = True
                    self.publish(root, receipt)
                elif change == 'bad-hash':
                    receipt['ciphertextSha256'] = 'not-a-hash'
                    self.publish(root, receipt)
                elif change == 'changed':
                    target.write_bytes(b'Fictional altered ciphertext')
                elif change == 'missing-file':
                    target.unlink()
                elif change == 'symlink':
                    replacement = root / 'other.cms'
                    target.rename(replacement)
                    target.symlink_to(replacement)
                elif change == 'traversal':
                    receipt['file'] = '../fictional-secret.cms'
                    (root / 'last-success.json').write_text(json.dumps(receipt))
                elif change == 'public-file':
                    target.chmod(0o644)
                elif change == 'public-directory':
                    root.chmod(0o755)
                code, output = self.invoke(root)
                self.assertNotEqual(code, 0)
                self.assertEqual(json.loads(output)['status'], 'failed')
                self.assertNotIn('private diagnostic', output)
                self.assertNotIn('fictional-secret', output)
                root.chmod(0o700)

    def test_configured_age_and_small_clock_tolerance_are_respected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            receipt = self.fixture(root)
            receipt['finishedAt'] = (datetime.now(timezone.utc) - timedelta(hours=27)).isoformat()
            self.publish(root, receipt)
            self.assertEqual(self.invoke(root, ['--max-age-hours', '48'])[0], 0)
            receipt['finishedAt'] = (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat()
            self.publish(root, receipt)
            self.assertEqual(self.invoke(root)[0], 0)

    def test_running_backup_does_not_get_a_success_verdict(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            with (root / '.backup.lock').open('r') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                code, output = self.invoke(root)
                self.assertNotEqual(code, 0)
                self.assertEqual(json.loads(output), {'status': 'failed', 'reason': 'busy'})

    def test_invalid_age_and_git_directory_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            for value in ['0', '-1', 'nan']:
                self.assertNotEqual(self.invoke(root, ['--max-age-hours', value])[0], 0)
        with tempfile.TemporaryDirectory(dir=ROOT) as directory:
            root = Path(directory)
            self.fixture(root)
            self.assertNotEqual(self.invoke(root)[0], 0)


if __name__ == '__main__':
    unittest.main()
