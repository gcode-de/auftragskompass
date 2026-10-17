"""Update checkpoints pause fictional writers before taking a recoverable dump."""
import contextlib
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import update_checkpoint as MODULE


class UpdateCheckpointTests(unittest.TestCase):
    def test_order_and_failed_preparation(self):
        for failure in [None, 'is-active', 'stop', 'backup', 'restart']:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / 'fictional.dump'
                calls = []
                def run(args, **kwargs):
                    calls.append(args)
                    self.assertTrue(kwargs['check'])
                    self.assertTrue(kwargs['capture_output'])
                    kind = 'backup' if args[0] == sys.executable else args[1]
                    if kind == failure or (failure == 'restart' and kind in ['backup', 'start']):
                        raise subprocess.CalledProcessError(1, args, stderr='fictional private diagnostic')
                    return subprocess.CompletedProcess(args, 0, stdout='active\n')
                with patch.object(MODULE.subprocess, 'run', side_effect=run):
                    if failure:
                        with self.assertRaises(RuntimeError) as error:
                            MODULE.checkpoint('fictional-test', output)
                        self.assertNotIn('private diagnostic', str(error.exception))
                    else:
                        MODULE.checkpoint('fictional-test', output)
                actions = ['backup' if c[0] == sys.executable else c[1] for c in calls]
                if failure == 'is-active':
                    self.assertEqual(actions, ['is-active'])
                else:
                    self.assertEqual(actions[:4], ['is-active'] * 3 + ['stop'])
                    self.assertNotIn('fictional-test-database.service', calls[3])
                    if failure == 'stop':
                        self.assertEqual(actions[4:], ['start'])
                    elif failure:
                        self.assertEqual(actions[4:], ['backup', 'start'])
                    else:
                        self.assertEqual(actions[4:], ['backup'])
                    self.assertEqual(calls[3][2:], ['fictional-test-admin.service', 'fictional-test-api.service', 'fictional-test-worker.service'])

    def test_rejects_unsafe_destination_before_any_service_action(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for case in ['project', 'existing', 'symlink', 'permissions', 'git']:
                output = root / 'fictional.dump'
                output.unlink(missing_ok=True)
                root.chmod(0o700)
                project = 'fictional-test'
                if case == 'project': project = '../other'
                if case == 'existing': output.write_bytes(b'fictional')
                if case == 'symlink': output.symlink_to(root / 'missing')
                if case == 'permissions': root.chmod(0o755)
                if case == 'git': output = ROOT / 'forbidden-fictional.dump'
                with self.subTest(case=case), patch.object(MODULE.subprocess, 'run') as run:
                    with self.assertRaises(ValueError): MODULE.checkpoint(project, output)
                    run.assert_not_called()

    def test_cli_outputs_only_fixed_messages(self):
        for failure in [False, True]:
            with self.subTest(failure=failure), patch.object(sys, 'argv', ['checkpoint', '--project', 'fictional-test', '--file', '/fictional/backup.dump']):
                output = io.StringIO()
                with patch.object(MODULE, 'checkpoint', side_effect=OSError('fictional private path') if failure else None), contextlib.redirect_stdout(output):
                    if failure:
                        with self.assertRaises(SystemExit) as error: MODULE.main()
                        self.assertEqual(str(error.exception), 'Checkpoint failed; inspect local service state')
                    else:
                        MODULE.main()
                        self.assertEqual(output.getvalue(), 'Checkpoint completed; app services remain stopped\n')

    def test_inactive_service_never_changes_services(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(MODULE.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, stdout='inactive\n')) as run:
                with self.assertRaisesRegex(RuntimeError, 'active app services'):
                    MODULE.checkpoint('fictional-test', Path(directory) / 'backup.dump')
                self.assertEqual(run.call_count, 1)
