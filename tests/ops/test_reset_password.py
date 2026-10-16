"""Synthetic operator credential-file and command boundary tests."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('reset_password', ROOT / 'scripts/reset_password.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

class ResetTests(unittest.TestCase):
    def invoke(self, file, extra=None):
        argv=['reset_password.py','--project','fictional-test','--username','Fictional.Owner','--password-file',str(file)]+(extra or [])
        output=io.StringIO()
        with patch('sys.argv',argv), contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            try: MODULE.main()
            except SystemExit as error: return error.code,output.getvalue()
        return 0,output.getvalue()

    def test_secret_uses_stdin_and_only_fixed_status_is_printed(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'fictional-password';path.write_text('Fictional replacement password\n');path.chmod(0o600)
            with patch.object(MODULE.subprocess,'run',return_value=subprocess.CompletedProcess([],0,stdout='Fictional replacement password',stderr='')) as run:
                code,out=self.invoke(path)
                self.assertEqual(code,0)
                args,kwargs=run.call_args
                self.assertEqual(args[0][:7],['podman','exec','-i','--workdir','/app/apps/api','fictional-test-api','node'])
                self.assertEqual(json.loads(kwargs['input']),{'username':'fictional.owner','password':'Fictional replacement password'})
                self.assertNotIn('Fictional replacement password',str(args))
                self.assertNotIn('Fictional replacement password',out)
                self.assertTrue(kwargs['capture_output']);self.assertTrue(kwargs['check']);self.assertEqual(kwargs['timeout'],30)

    def test_unsafe_files_arguments_and_child_diagnostics_never_reveal_passwords(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'fictional-password';path.write_text('Fictional replacement password');path.chmod(0o644)
            with patch.object(MODULE.subprocess,'run') as run:
                self.assertNotEqual(self.invoke(path)[0],0);run.assert_not_called()
            path.chmod(0o600)
            fifo=Path(directory)/'fictional-fifo';os.mkfifo(fifo)
            with patch.object(MODULE.subprocess,'run') as run:
                self.assertNotEqual(self.invoke(fifo)[0],0)
                self.assertNotEqual(self.invoke(Path(directory))[0],0)
                self.assertNotEqual(self.invoke(Path(directory)/'missing')[0],0)
                with patch.object(MODULE.os,'getuid',return_value=os.getuid()+1):
                    self.assertNotEqual(self.invoke(path)[0],0)
                run.assert_not_called()
            with patch.object(MODULE.subprocess,'run') as run:
                for extra in [['--project','../unsafe'],['--username','bad@name.invalid'],['--password','Fictional secret argument']]:
                    code,out=self.invoke(path,extra)
                    self.assertNotEqual(code,0);self.assertNotIn('Fictional secret argument',out)
                run.assert_not_called()
            for error in [subprocess.CalledProcessError(1,['podman'],stderr='Fictional replacement password'),subprocess.TimeoutExpired(['podman'],30,stderr='Fictional replacement password'),OSError('Fictional replacement password')]:
                with patch.object(MODULE.subprocess,'run',side_effect=error):
                    code,out=self.invoke(path);self.assertNotEqual(code,0);self.assertNotIn('Fictional replacement password',out)
            for data in [b'x'*513,b'\xff']:
                path.write_bytes(data)
                with patch.object(MODULE.subprocess,'run') as run:
                    self.assertNotEqual(self.invoke(path)[0],0);run.assert_not_called()
        with tempfile.TemporaryDirectory(dir=ROOT) as directory:
            path=Path(directory)/'fictional-password';path.write_text('Fictional replacement password');path.chmod(0o600)
            with patch.object(MODULE.subprocess,'run') as run:
                self.assertNotEqual(self.invoke(path)[0],0);run.assert_not_called()

if __name__=='__main__': unittest.main()
