"""Pause active Podman app units and leave them stopped after a pre-update dump."""
import argparse
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def checkpoint(project, destination):
    destination = Path(destination).absolute()
    parent = destination.parent
    if (not re.fullmatch(r'[a-z0-9][a-z0-9_-]*', project)
            or destination.resolve().is_relative_to(ROOT)
            or destination.is_symlink() or destination.exists()
            or parent.is_symlink() or not parent.is_dir()
            or parent.stat().st_uid != os.getuid()
            or stat.S_IMODE(parent.stat().st_mode) != 0o700):
        raise ValueError('Update requires a new backup file in a private directory outside Git')
    units = [project + '-' + name + '.service' for name in ['admin', 'api', 'worker']]
    def run(args):
        return subprocess.run(args, check=True, text=True, capture_output=True)
    try:
        for unit in units:
            if run(['systemctl', 'is-active', unit]).stdout.strip() != 'active':
                raise RuntimeError('Update requires active app services')
    except (OSError, subprocess.CalledProcessError):
        raise RuntimeError('Update requires active app services') from None
    try:
        run(['systemctl', 'stop', *units])
        run([sys.executable, str(Path(__file__).with_name('backup_restore.py')),
             'backup', '--runtime', 'podman', '--project', project, '--file', str(destination)])
    except (OSError, subprocess.CalledProcessError):
        # No image, config or schema has changed, so restarting the old app is safe here.
        try:
            run(['systemctl', 'start', *units])
        except (OSError, subprocess.CalledProcessError):
            raise RuntimeError('Checkpoint failed; old services require operator inspection') from None
        raise RuntimeError('Checkpoint failed; old services restarted') from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', required=True)
    parser.add_argument('--file', required=True)
    args = parser.parse_args()
    try:
        checkpoint(args.project, args.file)
    except (ValueError, RuntimeError, OSError) as error:
        # Only fixed messages are emitted; never print database/service diagnostics.
        if isinstance(error, OSError):
            raise SystemExit('Checkpoint failed; inspect local service state') from None
        raise SystemExit(str(error)) from None
    print('Checkpoint completed; app services remain stopped')


if __name__ == '__main__':
    main()
