"""Serialize a private Podman dump, authenticated encryption and backup receipts."""
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import shutil
import stat
import subprocess
import sys
import tempfile
from uuid import uuid4
from seal_backup import open_input, outside_git

SCRIPTS = Path(__file__).resolve().parent


def hash_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def publish_json(path, data):
    fd, name = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as temporary:
            json.dump(data, temporary, sort_keys=True)
            temporary.write('\n'); temporary.flush(); os.fsync(temporary.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--project', required=True)
    parser.add_argument('--directory', required=True)
    parser.add_argument('--certificate', required=True)
    args, unknown = parser.parse_known_args()
    if unknown or not re.fullmatch(r'[a-z0-9][a-z0-9_-]*', args.project):
        parser.error('Use a valid Podman project prefix and documented file arguments')
    try:
        directory = Path(args.directory).resolve(strict=True)
        metadata = directory.stat()
        if (not directory.is_dir() or not outside_git(directory)
                or metadata.st_uid != os.getuid() or metadata.st_mode & 0o077):
            raise ValueError('Unsafe backup directory')
        fd = os.open(directory / '.backup.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
        metadata = os.fstat(fd)
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid()
                or metadata.st_mode & 0o077):
            os.close(fd)
            raise ValueError('Unsafe lock file')
        lock = os.fdopen(fd, 'w')
    except (OSError, ValueError):
        parser.exit(1, 'Backup preflight failed; check the private external directory.\n')
    with lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            parser.exit(1, 'Backup already running; no status or backup changed.\n')
        except OSError:
            parser.exit(1, 'Backup lock unavailable; no child started.\n')
        phase = 'preflight'
        try:
            with open_input(args.certificate, private=False):
                pass
            reserve = 512 * 1024 * 1024
            available = shutil.disk_usage(directory).free
            if available <= reserve:
                raise ValueError('Insufficient reserve')
            maximum_file_bytes = (available - reserve) // 2
            hard_limit = resource.getrlimit(resource.RLIMIT_FSIZE)[1]
            if hard_limit != resource.RLIM_INFINITY:
                maximum_file_bytes = min(maximum_file_bytes, hard_limit)
            def file_limit():
                resource.setrlimit(resource.RLIMIT_FSIZE, (maximum_file_bytes, maximum_file_bytes))
            stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
            target = directory / ('backup-' + stamp + '-' + uuid4().hex[:8] + '.cms')
            with tempfile.TemporaryDirectory(dir=directory, prefix='.incomplete-') as temporary:
                raw = Path(temporary) / 'database.dump'
                phase = 'dump'
                subprocess.run([sys.executable, str(SCRIPTS / 'backup_restore.py'), 'backup', '--runtime', 'podman', '--project', args.project, '--file', str(raw)], check=True, capture_output=True, timeout=600, preexec_fn=file_limit)
                plaintext_hash = hash_file(raw)
                phase = 'encryption'
                subprocess.run([sys.executable, str(SCRIPTS / 'seal_backup.py'), 'encrypt', '--input', str(raw), '--output', str(target), '--certificate', str(Path(args.certificate).resolve())], check=True, capture_output=True, timeout=600, preexec_fn=file_limit)
            phase = 'receipt'
            receipt = {'version': 1, 'status': 'ok', 'finishedAt': datetime.now(timezone.utc).isoformat(),
                       'project': args.project, 'file': target.name, 'bytes': target.stat().st_size,
                       'plaintextSha256': plaintext_hash, 'ciphertextSha256': hash_file(target)}
            publish_json(directory / (target.name + '.json'), receipt)
            publish_json(directory / 'last-attempt.json', receipt)
            publish_json(directory / 'last-success.json', receipt)
            print('Encrypted backup and private receipt completed.')
        except (OSError, ValueError, subprocess.SubprocessError):
            try:
                publish_json(directory / 'last-attempt.json', {'version': 1, 'status': 'failed', 'phase': phase,
                             'finishedAt': datetime.now(timezone.utc).isoformat()})
            except OSError:
                pass
            parser.exit(1, 'Encrypted backup not completed; check the private status and services.\n')


if __name__ == '__main__':
    main()
