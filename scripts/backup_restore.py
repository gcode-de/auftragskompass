"""Non-destructive PostgreSQL backup/restore for an explicit Compose project."""
import argparse
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['backup', 'restore'])
    parser.add_argument('--env-file', required=True)
    parser.add_argument('--project', required=True)
    parser.add_argument('--file', required=True)
    args = parser.parse_args()
    path = Path(args.file).resolve()
    if path.is_relative_to(ROOT):
        parser.error('Backup files must be outside the repository')
    compose = ['docker', 'compose', '--env-file', str(Path(args.env_file).resolve()),
               '-p', args.project, '-f', str(ROOT / 'compose.yaml')]
    base = compose + ['exec', '-T', 'database']
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
        running = subprocess.check_output(compose + ['ps', '--status', 'running', '--services'], text=True)
        if 'api' in running.splitlines() or 'worker' in running.splitlines():
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
