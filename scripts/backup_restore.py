"""Non-destructive PostgreSQL backup/restore for Compose or named Podman containers."""
import argparse
import os
import re
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['backup', 'restore'])
    parser.add_argument('--runtime', choices=['compose', 'podman'], default='compose')
    parser.add_argument('--env-file', help='Required only for Compose')
    parser.add_argument('--project', required=True, help='Compose project or Podman container-name prefix')
    parser.add_argument('--file', required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]*', args.project):
        parser.error('Invalid project or container-name prefix')
    if args.runtime == 'compose' and not args.env_file:
        parser.error('Compose requires --env-file')
    if args.runtime == 'podman' and args.env_file:
        parser.error('Podman uses existing container configuration; omit --env-file')
    path = Path(args.file).resolve()
    if path.is_relative_to(ROOT):
        parser.error('Backup files must be outside the repository')
    if args.runtime == 'compose':
        compose = ['docker', 'compose', '--env-file', str(Path(args.env_file).resolve()),
                   '-p', args.project, '-f', str(ROOT / 'compose.yaml')]
        base = compose + ['exec', '-T', 'database']
        running_command = compose + ['ps', '--status', 'running', '--services']
        writers = {'api', 'worker'}
    else:
        base = ['podman', 'exec', '-i', args.project + '-database']
        running_command = ['podman', 'ps', '--format', '{{.Names}}']
        writers = {args.project + '-api', args.project + '-worker'}
    if args.mode == 'backup':
        if path.exists():
            parser.error('Refusing to overwrite an existing backup')
        # Owner-only temporary file, published atomically after successful pg_dump.
        with tempfile.NamedTemporaryFile(dir=path.parent) as temporary:
            subprocess.run(base + ['pg_dump', '-U', 'ak', '-d', 'auftragskompass', '-Fc'],
                           stdout=temporary, stderr=subprocess.PIPE, check=True)
            temporary.flush()
            os.fsync(temporary.fileno())
            os.link(temporary.name, path)
    else:
        running = subprocess.check_output(running_command, text=True)
        if writers.intersection(running.splitlines()):
            parser.error('Restore requires an isolated database with API and worker stopped')
        count = subprocess.check_output(base + ['psql', '-U', 'ak', '-d', 'auftragskompass', '-Atc',
            "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'"], text=True)
        if count.strip() != '0':
            parser.error('Restore requires an empty database; existing data is never deleted')
        with path.open('rb') as source:
            subprocess.run(base + ['pg_restore', '-U', 'ak', '-d', 'auftragskompass',
                                   '--single-transaction', '--exit-on-error', '--no-owner'],
                           stdin=source, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True)
    print('Backup completed' if args.mode == 'backup' else 'Restore completed')


if __name__ == '__main__':
    try:
        main()
    except (subprocess.CalledProcessError, OSError):
        # Database diagnostics may contain personal data; do not print them.
        raise SystemExit('Backup/restore failed; inspect the local service state') from None
