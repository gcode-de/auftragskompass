"""Seal external backup files with OpenSSL CMS; publish only complete verified results."""
import argparse
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from contextlib import ExitStack
import os
from pathlib import Path
import stat
import subprocess
import tempfile


def outside_git(path):
    return not any((directory / '.git').exists() for directory in [path, *path.parents])


def open_input(path, private=True):
    path = Path(path).resolve(strict=True)
    if not outside_git(path):
        raise ValueError('Git input')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    metadata = os.fstat(fd)
    if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid()
            or (metadata.st_mode & (0o077 if private else 0o022))):
        os.close(fd)
        raise ValueError('Unsafe input')
    return os.fdopen(fd, 'rb')


def require_authenticated_cms(source):
    # Inspect OpenSSL's parsed type, not attacker-controlled bytes or a custom ASN.1 parser.
    with subprocess.Popen(['openssl', 'cms', '-cmsout', '-inform', 'DER', '-in',
                           '/dev/fd/' + str(source.fileno()), '-print', '-noout'],
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                          pass_fds=(source.fileno(),)) as process:
        with ThreadPoolExecutor(max_workers=1) as executor:
            header = executor.submit(lambda: process.stdout.readline(512) + process.stdout.readline(512))
            try:
                prefix = header.result(timeout=30)
            finally:
                if process.poll() is None:
                    process.kill()
                process.wait(timeout=5)
        if b'contentType: id-smime-ct-authEnvelopedData (1.2.840.113549.1.9.16.1.23)' not in prefix:
            raise ValueError('Unauthenticated CMS type')
    source.seek(0)


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('mode', choices=['encrypt', 'decrypt'])
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--certificate')
    parser.add_argument('--private-key')
    parser.add_argument('--key-password-file')
    args, unknown = parser.parse_known_args()
    if unknown:
        parser.error('Unknown arguments; use private files, never inline passwords')
    if args.mode == 'encrypt':
        if not args.certificate or args.private_key or args.key_password_file:
            parser.error('Encryption requires only --certificate')
    elif not args.private_key or not args.key_password_file or args.certificate:
        parser.error('Decryption requires --private-key and --key-password-file')
    try:
        requested = Path(args.output).absolute()
        parent = requested.parent.resolve(strict=True)
        metadata = parent.stat()
        if (not outside_git(parent) or metadata.st_uid != os.getuid()
                or metadata.st_mode & 0o077):
            raise ValueError('Unsafe output directory')
        target = parent / requested.name
        if target.exists() or target.is_symlink():
            raise ValueError('Existing target')
        with ExitStack() as stack:
            source = stack.enter_context(open_input(args.input))
            key = stack.enter_context(open_input(args.certificate if args.mode == 'encrypt' else args.private_key,
                                                  private=args.mode != 'encrypt'))
            command = ['openssl', 'cms', '-' + args.mode, '-binary', '-in', '/dev/fd/' + str(source.fileno())]
            secret = b''
            if args.mode == 'encrypt':
                command += ['-aes-256-gcm', '-stream', '-outform', 'DER', '-recip', '/dev/fd/' + str(key.fileno()),
                            '-keyopt', 'rsa_padding_mode:oaep', '-keyopt', 'rsa_oaep_md:sha256']
            else:
                require_authenticated_cms(source)
                password = stack.enter_context(open_input(args.key_password_file))
                secret = password.read(513)
                if len(secret) > 512:
                    raise ValueError('Oversized password file')
                if secret.endswith(b'\r\n'):
                    secret = secret[:-2]
                elif secret.endswith(b'\n'):
                    secret = secret[:-1]
                if not secret or len(secret) > 512 or any(char in secret for char in [b'\0', b'\n', b'\r']):
                    raise ValueError('Invalid password file')
                command += ['-inform', 'DER', '-inkey', '/dev/fd/' + str(key.fileno()), '-passin', 'stdin']
            # Decryption can write before checking GCM; never expose that partial output.
            with tempfile.NamedTemporaryFile(dir=parent) as temporary:
                subprocess.run(command, input=secret + b'\n', stdout=temporary, stderr=subprocess.PIPE,
                               pass_fds=(source.fileno(), key.fileno()), check=True, timeout=300)
                temporary.flush()
                os.fsync(temporary.fileno())
                os.link(temporary.name, target)
        print('Encrypted backup completed.' if args.mode == 'encrypt' else 'Verified decryption completed.')
    except (OSError, ValueError, subprocess.CalledProcessError, subprocess.TimeoutExpired, FutureTimeout):
        parser.exit(1, 'Backup cryptography failed; check private external paths, rights and keys. No completed output published.\n')


if __name__ == '__main__':
    main()
