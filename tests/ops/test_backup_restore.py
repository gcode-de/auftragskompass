"""Synthetic command-adapter and backup safety tests; no external database."""
import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('backup_restore', ROOT / 'scripts/backup_restore.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class BackupTests(unittest.TestCase):
    def invoke(self, mode, runtime, file, project='synthetic', env_file=None):
        argv = ['backup_restore.py', mode, '--runtime', runtime,
                '--project', project, '--file', str(file)]
        if env_file:
            argv += ['--env-file', str(env_file)]
        with patch('sys.argv', argv), contextlib.redirect_stdout(io.StringIO()), \
                contextlib.redirect_stderr(io.StringIO()):
            MODULE.main()

    def test_backup_adapters_publish_owner_only_file_and_never_overwrite(self):
        for runtime in ['compose', 'podman']:
            with self.subTest(runtime=runtime), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'synthetic.dump'
                env = Path(directory) / 'synthetic.env' if runtime == 'compose' else None
                def dump(command, **kwargs):
                    self.assertIn('pg_dump', command)
                    self.assertIn('-Fc', command)
                    self.assertTrue(kwargs['check'])
                    self.assertEqual(kwargs['stderr'], subprocess.PIPE)
                    if runtime == 'podman':
                        self.assertEqual(command[:4], ['podman', 'exec', '-i', 'synthetic-database'])
                    else:
                        self.assertEqual(command[:2], ['docker', 'compose'])
                        self.assertIn(str(env.resolve()), command)
                    kwargs['stdout'].write(b'PGDMP synthetic backup')
                with patch.object(MODULE.subprocess, 'run', side_effect=dump) as run:
                    self.invoke('backup', runtime, path, env_file=env)
                    self.assertEqual(path.read_bytes(), b'PGDMP synthetic backup')
                    self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                    with self.assertRaises(SystemExit):
                        self.invoke('backup', runtime, path, env_file=env)
                    self.assertEqual(run.call_count, 1)

    def test_failed_dump_publishes_nothing_and_cleans_partial_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'synthetic.dump'
            def fail(command, **kwargs):
                kwargs['stdout'].write(b'partial synthetic data')
                raise subprocess.CalledProcessError(1, command)
            with patch.object(MODULE.subprocess, 'run', side_effect=fail):
                with self.assertRaises(subprocess.CalledProcessError):
                    self.invoke('backup', 'podman', path)
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_destination_created_during_backup_is_never_replaced(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'synthetic.dump'
            def concurrent_backup(_command, **kwargs):
                kwargs['stdout'].write(b'new synthetic backup')
                path.write_bytes(b'previous synthetic backup')
            with patch.object(MODULE.subprocess, 'run', side_effect=concurrent_backup):
                with self.assertRaises(FileExistsError):
                    self.invoke('backup', 'podman', path)
            self.assertEqual(path.read_bytes(), b'previous synthetic backup')
            self.assertEqual(list(Path(directory).iterdir()), [path])

    def test_restore_adapters_require_empty_database_and_stopped_writers(self):
        for runtime in ['compose', 'podman']:
            with self.subTest(runtime=runtime), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'synthetic.dump'
                path.write_bytes(b'PGDMP synthetic backup')
                env = Path(directory) / 'synthetic.env' if runtime == 'compose' else None
                unrelated = 'synthetic-api-copy\nother-worker\n'
                with patch.object(MODULE.subprocess, 'check_output', side_effect=[unrelated, '0\n']) as query, \
                        patch.object(MODULE.subprocess, 'run') as run:
                    self.invoke('restore', runtime, path, env_file=env)
                    command = run.call_args.args[0]
                    for argument in ['pg_restore', '--single-transaction', '--exit-on-error', '--no-owner']:
                        self.assertIn(argument, command)
                    self.assertEqual(run.call_args.kwargs['stdin'].name, str(path.resolve()))
                    if runtime == 'podman':
                        self.assertEqual(query.call_args_list[0].args[0], ['podman', 'ps', '--format', '{{.Names}}'])
                        self.assertEqual(command[:4], ['podman', 'exec', '-i', 'synthetic-database'])

                for writer in ['api', 'worker']:
                    running = writer if runtime == 'compose' else 'synthetic-' + writer
                    with patch.object(MODULE.subprocess, 'check_output', return_value=running), \
                            patch.object(MODULE.subprocess, 'run') as run:
                        with self.assertRaises(SystemExit):
                            self.invoke('restore', runtime, path, env_file=env)
                        run.assert_not_called()

                with patch.object(MODULE.subprocess, 'check_output', side_effect=['', '1\n']), \
                        patch.object(MODULE.subprocess, 'run') as run:
                    with self.assertRaises(SystemExit):
                        self.invoke('restore', runtime, path, env_file=env)
                    run.assert_not_called()

    def test_invalid_target_and_runtime_configuration_never_call_container_tools(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(MODULE.subprocess, 'run') as run, \
                patch.object(MODULE.subprocess, 'check_output') as query:
            for runtime, path, project, env in [
                ('podman', ROOT / 'tests/synthetic.dump', 'synthetic', None),
                ('podman', Path(directory) / 'dump', '../other', None),
                ('podman', Path(directory) / 'dump', '-option', None),
                ('podman', Path(directory) / 'dump', 'synthetic', 'unused.env'),
                ('compose', Path(directory) / 'dump', 'synthetic', None),
            ]:
                with self.subTest(runtime=runtime, project=project), self.assertRaises(SystemExit):
                    self.invoke('backup', runtime, path, project=project, env_file=env)
            run.assert_not_called()
            query.assert_not_called()


if __name__ == '__main__':
    unittest.main()
