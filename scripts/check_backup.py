"""Check existing encrypted backup receipts without writing or decrypting data."""
import argparse
from datetime import datetime, timedelta, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
from seal_backup import open_input, outside_git


def private_input(path):
    if path.is_symlink():
        raise ValueError('Unsafe file')
    return open_input(path)


def read_receipt(path):
    with private_input(path) as source:
        raw = source.read(16385)
    if len(raw) > 16384:
        raise ValueError('Oversized receipt')
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError('Invalid receipt')
    return value


def check(directory, project, max_age_hours):
    metadata = directory.stat()
    if (not directory.is_dir() or not outside_git(directory)
            or metadata.st_uid != os.getuid() or metadata.st_mode & 0o077):
        raise ValueError('Unsafe directory')
    with private_input(directory / '.backup.lock') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
        except BlockingIOError:
            return 'busy'
        receipt = read_receipt(directory / 'last-success.json')
        attempt = read_receipt(directory / 'last-attempt.json')
        if attempt.get('status') == 'failed':
            return 'last_attempt_failed'
        if (type(receipt.get('version')) is not int or receipt['version'] != 1
                or receipt.get('status') != 'ok' or receipt.get('project') != project
                or attempt != receipt):
            raise ValueError('Inconsistent receipt')
        filename = receipt.get('file')
        if (not isinstance(filename, str)
                or not re.fullmatch(r'backup-[0-9]{8}T[0-9]{12}Z-[a-f0-9]{8}\.cms', filename)
                or type(receipt.get('bytes')) is not int or receipt['bytes'] <= 0
                or not isinstance(receipt.get('finishedAt'), str)):
            raise ValueError('Invalid receipt')
        for key in ['plaintextSha256', 'ciphertextSha256']:
            if not isinstance(receipt.get(key), str) or not re.fullmatch('[a-f0-9]{64}', receipt[key]):
                raise ValueError('Invalid checksum')
        finished = datetime.fromisoformat(receipt['finishedAt'].replace('Z', '+00:00'))
        if finished.tzinfo is None or finished.utcoffset() is None:
            raise ValueError('Missing timezone')
        age = datetime.now(timezone.utc) - finished
        if age < -timedelta(minutes=5):
            return 'future_timestamp'
        if age > timedelta(hours=max_age_hours):
            return 'stale'
        if read_receipt(directory / (filename + '.json')) != receipt:
            raise ValueError('Inconsistent per-file receipt')
        digest = hashlib.sha256()
        size = 0
        with private_input(directory / filename) as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(chunk)
                size += len(chunk)
        if size != receipt['bytes'] or digest.hexdigest() != receipt['ciphertextSha256']:
            return 'integrity_failed'
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--project', required=True)
    parser.add_argument('--directory', required=True)
    parser.add_argument('--max-age-hours', type=int, default=26)
    args = parser.parse_args()
    if args.max_age_hours <= 0 or not re.fullmatch('[a-z0-9][a-z0-9_-]*', args.project):
        parser.error('Use a valid project prefix and a positive maximum age')
    try:
        reason = check(Path(args.directory).resolve(strict=True), args.project, args.max_age_hours)
    except (OSError, ValueError, OverflowError):
        reason = 'missing_or_invalid'
    if reason:
        print(json.dumps({'status': 'failed', 'reason': reason}))
        raise SystemExit(1)
    print(json.dumps({'status': 'ok'}))


if __name__ == '__main__':
    main()
