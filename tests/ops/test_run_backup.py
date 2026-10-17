"""Scheduled orchestration safety; crypto runs for real, database adapter is synthetic."""
import contextlib
import fcntl
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts'))
import run_backup as MODULE
import check_backup

class RunBackupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory=tempfile.TemporaryDirectory();cls.root=Path(cls.directory.name)
        cls.key=cls.root/'fictional.key';cls.cert=cls.root/'fictional.pem'
        subprocess.run(['openssl','req','-newkey','rsa:3072','-nodes','-x509','-days','1','-subj','/CN=FictionalBackup','-keyout',str(cls.key),'-out',str(cls.cert)],capture_output=True,check=True)
        cls.key.chmod(0o600);cls.cert.chmod(0o600);cls.real_run=staticmethod(subprocess.run)
    @classmethod
    def tearDownClass(cls):cls.directory.cleanup()
    def invoke(self,directory,project='fictional-job'):
        output=io.StringIO()
        with patch('sys.argv',['run_backup.py','--project',project,'--directory',str(directory),'--certificate',str(self.cert)]),contextlib.redirect_stdout(output),contextlib.redirect_stderr(output):
            try:MODULE.main()
            except SystemExit as e:return e.code,output.getvalue()
        return 0,output.getvalue()
    def child(self,command,**options):
        if Path(command[1]).name=='backup_restore.py':
            self.assertEqual(command[2:7],['backup','--runtime','podman','--project','fictional-job'])
            path=Path(command[command.index('--file')+1]);path.write_bytes(b'PGDMP Fictional scheduled data');path.chmod(0o600)
            return subprocess.CompletedProcess(command,0,stdout=b'Backup completed',stderr=b'')
        return self.real_run(command,**options)
    def test_success_records_private_hashes_and_never_retains_plaintext(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            with patch.object(MODULE.subprocess,'run',side_effect=self.child):code,out=self.invoke(root)
            self.assertEqual(code,0,out);manifest=json.loads((root/'last-success.json').read_text());self.assertEqual(manifest['status'],'ok')
            sealed=root/manifest['file'];self.assertEqual(hashlib.sha256(sealed.read_bytes()).hexdigest(),manifest['ciphertextSha256']);self.assertEqual(manifest['plaintextSha256'],hashlib.sha256(b'PGDMP Fictional scheduled data').hexdigest())
            opened=self.real_run(['openssl','cms','-decrypt','-binary','-inform','DER','-in',str(sealed),'-inkey',str(self.key)],capture_output=True,check=True).stdout
            self.assertEqual(opened,b'PGDMP Fictional scheduled data');self.assertTrue((root/(manifest['file']+'.json')).exists())
            self.assertEqual(json.loads((root/'last-attempt.json').read_text()),manifest)
            for file in root.iterdir():self.assertEqual(file.stat().st_mode&0o777,0o600)
            self.assertFalse(any(path.is_dir() for path in root.iterdir()));self.assertNotIn('PGDMP',out)
            self.assertIsNone(check_backup.check(root, 'fictional-job', 26))
    def test_dump_and_encryption_failures_preserve_success_and_remove_workfiles(self):
        for phase in ['dump','encryption']:
            with self.subTest(phase=phase),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);previous=b'{"fictional":"previous success"}';(root/'last-success.json').write_bytes(previous)
                def fail(command,**options):
                    if (phase=='dump' and Path(command[1]).name=='backup_restore.py') or (phase=='encryption' and Path(command[1]).name=='seal_backup.py'):
                        raise subprocess.CalledProcessError(1,command,stderr=b'Fictional private diagnostic')
                    return self.child(command,**options)
                with patch.object(MODULE.subprocess,'run',side_effect=fail):code,out=self.invoke(root)
                self.assertNotEqual(code,0);self.assertNotIn('private diagnostic',out);self.assertEqual((root/'last-success.json').read_bytes(),previous)
                self.assertEqual(json.loads((root/'last-attempt.json').read_text())['status'],'failed');self.assertEqual(list(root.glob('*.cms')),[]);self.assertFalse(any(path.is_dir() for path in root.iterdir()))
    def test_lock_low_space_and_unsafe_paths_do_not_start_children(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);lock=root/'.backup.lock'
            with lock.open('w') as stream:
                lock.chmod(0o600);fcntl.flock(stream,fcntl.LOCK_EX|fcntl.LOCK_NB)
                with patch.object(MODULE.subprocess,'run') as run:
                    self.assertNotEqual(self.invoke(root)[0],0);run.assert_not_called()
            with patch.object(MODULE.shutil,'disk_usage',return_value=type('Usage',(),{'free':0})()),patch.object(MODULE.subprocess,'run') as run:
                self.assertNotEqual(self.invoke(root)[0],0);run.assert_not_called()
            root.chmod(0o755)
            with patch.object(MODULE.subprocess,'run') as run:self.assertNotEqual(self.invoke(root)[0],0);run.assert_not_called()
            root.chmod(0o700)
            with patch.object(MODULE.subprocess,'run') as run:self.assertNotEqual(self.invoke(root,'../unsafe')[0],0);run.assert_not_called()
        with tempfile.TemporaryDirectory(dir=ROOT) as directory,patch.object(MODULE.subprocess,'run') as run:
            self.assertNotEqual(self.invoke(directory)[0],0);run.assert_not_called()
    def test_failed_receipt_never_claims_success(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);previous=b'{"fictional":"keep"}';(root/'last-success.json').write_bytes(previous)
            with patch.object(MODULE.subprocess,'run',side_effect=self.child),patch.object(MODULE,'publish_json',side_effect=OSError('Fictional confidential receipt failure')):
                code,out=self.invoke(root)
            self.assertNotEqual(code,0);self.assertNotIn('confidential',out);self.assertEqual((root/'last-success.json').read_bytes(),previous)
            self.assertFalse(any(path.is_dir() for path in root.iterdir()));self.assertEqual(len(list(root.glob('*.cms'))),1)

    def test_child_file_limit_preserves_the_disk_reserve(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            def large_dump(command,**options):
                path=Path(command[command.index('--file')+1])
                with path.open('wb') as target:
                    return self.real_run([sys.executable,'-c',"import sys; sys.stdout.buffer.write(b'x'*16384); sys.stdout.buffer.flush()"],stdout=target,stderr=subprocess.PIPE,check=True,preexec_fn=options['preexec_fn'])
            free=512*1024*1024+2048
            with patch.object(MODULE.shutil,'disk_usage',return_value=type('Usage',(),{'free':free})()),patch.object(MODULE.subprocess,'run',side_effect=large_dump):
                self.assertNotEqual(self.invoke(root)[0],0)
            self.assertFalse((root/'last-success.json').exists());self.assertFalse(any(path.is_dir() for path in root.iterdir()))
            self.assertEqual(json.loads((root/'last-attempt.json').read_text())['phase'],'dump')


if __name__=='__main__':unittest.main()
