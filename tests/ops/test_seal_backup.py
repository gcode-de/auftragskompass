"""Real OpenSSL contract with fictional data and disposable encrypted keys."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
SPEC=importlib.util.spec_from_file_location('seal_backup',ROOT/'scripts/seal_backup.py')
MODULE=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

class SealTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory=tempfile.TemporaryDirectory()
        cls.root=Path(cls.directory.name)
        cls.password=cls.root/'fictional-password';cls.password.write_bytes(b'Fictional key passphrase 12345\n');cls.password.chmod(0o600)
        for prefix in ['fictional','other']:
            key=cls.root/(prefix+'.key');cert=cls.root/(prefix+'.pem')
            with key.open('xb') as target:
                key.chmod(0o600)
                subprocess.run(['openssl','genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:3072','-aes-256-cbc','-pass','stdin'],input=cls.password.read_bytes(),stdout=target,stderr=subprocess.PIPE,check=True)
            subprocess.run(['openssl','req','-new','-x509','-key',str(key),'-passin','stdin','-subj','/CN=FictionalBackup','-days','1','-out',str(cert)],input=cls.password.read_bytes(),capture_output=True,check=True)
            cert.chmod(0o600)
    @classmethod
    def tearDownClass(cls): cls.directory.cleanup()
    def invoke(self,mode,source,output,*extra):
        out=io.StringIO()
        with patch('sys.argv',['seal_backup.py',mode,'--input',str(source),'--output',str(output),*map(str,extra)]),contextlib.redirect_stdout(out),contextlib.redirect_stderr(out):
            try:MODULE.main()
            except SystemExit as error:return error.code,out.getvalue()
        return 0,out.getvalue()
    def encrypt(self,source,output):return self.invoke('encrypt',source,output,'--certificate',self.root/'fictional.pem')
    def decrypt(self,source,output,key='fictional.key',password=None):return self.invoke('decrypt',source,output,'--private-key',self.root/key,'--key-password-file',password or self.password)
    def test_round_trip_is_binary_safe_owner_only_and_never_overwrites(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'fictional.dump';data=b'Fictional backup\x00\xff'*10000;source.write_bytes(data);source.chmod(0o600)
            sealed=root/'sealed.cms';opened=root/'opened.dump'
            code,out=self.encrypt(source,sealed);self.assertEqual(code,0,out);self.assertNotIn(b'Fictional backup',sealed.read_bytes());self.assertEqual(sealed.stat().st_mode&0o777,0o600)
            code,out=self.decrypt(sealed,opened);self.assertEqual(code,0,out);self.assertEqual(opened.read_bytes(),data);self.assertEqual(opened.stat().st_mode&0o777,0o600)
            for invalid in [b'x'*513,b'x'*512+b'\nignored',b'bad\0pass',b'first\nsecond',b'']:
                invalid_file=root/'invalid-passphrase';invalid_file.write_bytes(invalid);invalid_file.chmod(0o600)
                with patch.object(MODULE.subprocess,'run') as run:
                    self.assertNotEqual(self.decrypt(sealed,root/'invalid.dump',password=invalid_file)[0],0);run.assert_not_called()
                self.assertFalse((root/'invalid.dump').exists())
                invalid_file.unlink()
            self.assertNotEqual(self.encrypt(source,sealed)[0],0);self.assertNotEqual(self.decrypt(sealed,opened)[0],0)
            self.assertEqual(source.read_bytes(),data);self.assertEqual(opened.read_bytes(),data)
            before=sealed.read_bytes();sealed.write_bytes(before[:len(before)//2]+bytes([before[len(before)//2]^1])+before[len(before)//2+1:]);bad=root/'tampered.dump'
            self.assertNotEqual(self.decrypt(sealed,bad)[0],0);self.assertFalse(bad.exists());self.assertEqual(set(root.iterdir()),{source,sealed,opened})
            unauthenticated=root/'unauthenticated.cms'
            subprocess.run(['openssl','cms','-encrypt','-binary','-aes-256-cbc','-in',str(source),'-outform','DER','-out',str(unauthenticated),str(self.root/'fictional.pem')],capture_output=True,check=True)
            unauthenticated.chmod(0o600)
            self.assertNotEqual(self.decrypt(unauthenticated,bad)[0],0);self.assertFalse(bad.exists())
            sealed.write_bytes(before);wrong=root/'wrong.dump';self.assertNotEqual(self.decrypt(sealed,wrong,'other.key')[0],0);self.assertFalse(wrong.exists())
            wrong_password=root/'fictional-wrong-password';wrong_password.write_bytes(b'Fictional incorrect password');wrong_password.chmod(0o600)
            code,out=self.decrypt(sealed,wrong,password=wrong_password);self.assertNotEqual(code,0);self.assertNotIn('Fictional incorrect',out);self.assertNotIn('Fictional key passphrase',out);self.assertFalse(wrong.exists())
    def test_paths_rights_and_arguments_fail_before_openSSL(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'fictional.dump';source.write_bytes(b'Fictional source');source.chmod(0o644);target=root/'sealed.cms'
            with patch.object(MODULE.subprocess,'run') as run:
                self.assertNotEqual(self.encrypt(source,target)[0],0);run.assert_not_called()
            source.chmod(0o600);fifo=root/'fifo';os.mkfifo(fifo)
            with patch.object(MODULE.subprocess,'run') as run:
                for invalid in [fifo,root,root/'missing']:
                    self.assertNotEqual(self.encrypt(invalid,target)[0],0)
                code,out=self.invoke('encrypt',source,target,'--certificate',self.root/'fictional.pem','--password','Fictional inline secret');self.assertNotEqual(code,0);self.assertNotIn('Fictional inline secret',out)
                self.assertNotEqual(self.invoke('decrypt',source,target)[0],0)
                with patch.object(MODULE.os,'getuid',return_value=os.getuid()+1):self.assertNotEqual(self.encrypt(source,target)[0],0)
                run.assert_not_called()
            public=root/'public';public.mkdir(mode=0o755)
            with patch.object(MODULE.subprocess,'run') as run:
                self.assertNotEqual(self.encrypt(source,public/'sealed.cms')[0],0);run.assert_not_called()
            with tempfile.TemporaryDirectory(dir=ROOT) as git_directory:
                with patch.object(MODULE.subprocess,'run') as run:
                    self.assertNotEqual(self.encrypt(source,Path(git_directory)/'sealed.cms')[0],0)
                    tracked=Path(git_directory)/'fictional.dump';tracked.write_bytes(b'Fictional Git data');tracked.chmod(0o600)
                    self.assertNotEqual(self.encrypt(tracked,target)[0],0);run.assert_not_called()
            unsafe_cert=root/'unsafe-public.pem';unsafe_cert.write_bytes((self.root/'fictional.pem').read_bytes());unsafe_cert.chmod(0o666)
            with patch.object(MODULE.subprocess,'run') as run:
                self.assertNotEqual(self.invoke('encrypt',source,target,'--certificate',unsafe_cert)[0],0);run.assert_not_called()
            with patch.object(MODULE.subprocess,'run',side_effect=OSError('Fictional confidential diagnostic')):
                code,out=self.encrypt(source,target);self.assertNotEqual(code,0);self.assertNotIn('confidential',out);self.assertFalse(target.exists())

    def test_racing_output_and_process_timeout_publish_no_partial_result(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'fictional.dump';source.write_bytes(b'Fictional data');source.chmod(0o600);target=root/'sealed.cms'
            def race(_source,destination):
                Path(destination).write_bytes(b'Fictional competing result');Path(destination).chmod(0o600)
                raise FileExistsError()
            with patch.object(MODULE.os,'link',side_effect=race):self.assertNotEqual(self.encrypt(source,target)[0],0)
            self.assertEqual(target.read_bytes(),b'Fictional competing result');self.assertEqual(set(root.iterdir()),{source,target})
            target.unlink()
            with patch.object(MODULE.subprocess,'run',side_effect=subprocess.TimeoutExpired('openssl',300,stderr=b'Fictional confidential diagnostic')):
                code,out=self.encrypt(source,target);self.assertNotEqual(code,0);self.assertNotIn('confidential',out)
            self.assertFalse(target.exists());self.assertEqual(set(root.iterdir()),{source})


if __name__=='__main__':unittest.main()
