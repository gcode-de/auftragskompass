"""Poll green branch-head builds and update the existing Podman test stack as one unit."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request

REPO = 'gcode-de/auftragskompass'
BRANCH = 'codex/local-runtime-ci'
NAMES = ['api', 'worker', 'admin']
SHA = r'[a-f0-9]{40}'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, url):
        return None


def github(path):
    request = urllib.request.Request('https://api.github.com/repos/' + REPO + '/' + path,
                                     headers={'Accept': 'application/vnd.github+json',
                                              'User-Agent': 'AuftragsKompass-updater'})
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=20) as response:
        data = response.read(1024 * 1024 + 1)
        if len(data) > 1024 * 1024:
            raise ValueError('GitHub response too large')
        return json.loads(data)


def remote(config, args, *, input=None):
    return subprocess.run(['pct', 'exec', str(config['container']), '--', *args],
                          input=input, text=True, capture_output=True, check=True,
                          timeout=900).stdout.strip()


def private_directory(path):
    path = Path(path)
    if (not path.is_absolute() or path.is_symlink() or not path.is_dir()
            or path.stat().st_uid != os.getuid() or path.stat().st_mode & 0o777 != 0o700):
        raise ValueError('Private operator directory required')
    return path


def copy_backup(config, source, destination):
    size = int(remote(config, ['stat', '-c', '%s', source]))
    if size <= 0 or shutil.disk_usage(destination.parent).free < size + 64 * 1024 * 1024:
        raise RuntimeError('Insufficient backup space')
    expected = remote(config, ['sha256sum', source]).split()[0]
    if not re.fullmatch(r'[a-f0-9]{64}', expected):
        raise ValueError('Invalid backup checksum')
    with destination.open('xb') as output:
        os.fchmod(output.fileno(), 0o600)
        subprocess.run(['pct', 'exec', str(config['container']), '--', 'cat', source],
                       stdout=output, stderr=subprocess.PIPE, check=True, timeout=900)
        output.flush()
        os.fsync(output.fileno())
    actual = hashlib.sha256()
    with destination.open('rb') as stored:
        for chunk in iter(lambda: stored.read(1024 * 1024), b''):
            actual.update(chunk)
    if destination.stat().st_size != size or actual.hexdigest() != expected:
        raise RuntimeError('Backup copy not confirmed')


def write_private(path, value):
    with path.open('x') as output:
        os.chmod(path, 0o600)
        json.dump(value, output)
        output.flush()
        os.fsync(output.fileno())
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def states(config):
    result = remote(config, ['podman', 'inspect', *['ak-test-' + name for name in NAMES],
                            '--format', '{{index .Config.Labels "org.opencontainers.image.revision"}} {{.State.Health.Status}}'])
    values = result.splitlines()
    if (len(values) != 3 or len(set(values)) != 1
            or not re.fullmatch(SHA + r' healthy', values[0])):
        raise RuntimeError('Healthy consistent stack required')
    return values[0].split()[0]


def update(config, *, check_only=False):
    state_dir = private_directory(config['state_dir'])
    marker = state_dir / 'needs-attention'
    if marker.exists():
        raise RuntimeError('Previous update requires operator inspection')
    head = github('git/ref/heads/' + BRANCH)['object']['sha']
    if not isinstance(head, str) or not re.fullmatch(SHA, head):
        raise ValueError('Invalid revision')
    runs = github('actions/workflows/quality.yml/runs?' + urllib.parse.urlencode(
        {'branch': BRANCH, 'event': 'push', 'per_page': 1}))['workflow_runs']
    if not runs or any(runs[0].get(key) != value for key, value in {
        'head_sha': head, 'head_branch': BRANCH, 'event': 'push',
        'status': 'completed', 'conclusion': 'success',
        'path': '.github/workflows/quality.yml',
    }.items()):
        return 'waiting-for-green-head'
    current = states(config)
    if current == head:
        return 'current'
    if github('compare/' + current + '...' + head).get('status') != 'ahead':
        raise RuntimeError('Only forward updates allowed')
    if check_only:
        return 'update-available'
    images = {}
    for target in ['runtime', 'admin']:
        tag = config['image'] + ':' + target + '-' + head
        remote(config, ['podman', 'pull', '--quiet', tag])
        image = remote(config, ['podman', 'image', 'inspect', tag, '--format',
                                '{{.Digest}} {{index .Labels "org.opencontainers.image.revision"}}'])
        if not re.fullmatch(r'sha256:[a-f0-9]{64} ' + head, image):
            raise RuntimeError('Image revision not confirmed')
        images[target] = config['image'] + '@' + image.split()[0]
    unit_dir = '/etc/containers/systemd/'
    before = {name: remote(config, ['cat', unit_dir + 'ak-test-' + name + '.container']) + '\n'
              for name in NAMES}
    after = {}
    for name, contents in before.items():
        if 'AutoUpdate=' in contents or 'Secret=ak-test-bootstrap,' in contents:
            raise RuntimeError('Conflicting updater or bootstrap')
        contents, count = re.subn(r'^Image=.*$', lambda _: 'Image=' + images['admin' if name == 'admin' else 'runtime'], contents, flags=re.M)
        if count != 1:
            raise ValueError('Exactly one image required')
        if name != 'admin':
            contents, count = re.subn(r'^Environment=AK_BUILD_REVISION=.*$', lambda _: 'Environment=AK_BUILD_REVISION=' + head, contents, flags=re.M)
            if count != 1:
                raise ValueError('Exactly one build revision required')
        after[name] = contents
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    basename = 'preupdate-' + head[:12] + '-' + stamp
    backup = '/var/backups/auftragskompass-test/' + basename + '.dump'
    write_private(state_dir / (basename + '-quadlets.json'), before)
    # Persist before pausing: a crash or any uncertain migration requires human inspection.
    write_private(marker, {'revision': head, 'backup': backup})
    remote(config, ['python3', '/etc/auftragskompass-test/update_checkpoint.py',
                    '--project', 'ak-test', '--file', backup])
    copy_backup(config, backup, state_dir / (basename + '.dump'))
    writer = ('import os,sys,tempfile; from pathlib import Path; p=Path(sys.argv[1]); '
              'fd,t=tempfile.mkstemp(dir=p.parent,prefix=".ak-update-"); '
              'f=os.fdopen(fd,"w"); f.write(sys.stdin.read()); f.flush(); os.fsync(f.fileno()); '
              'f.close(); os.chmod(t,0o644); os.replace(t,p)')
    for name, contents in after.items():
        remote(config, ['python3', '-c', writer, unit_dir + 'ak-test-' + name + '.container'], input=contents)
    remote(config, ['systemctl', 'daemon-reload'])
    remote(config, ['systemctl', 'start', 'ak-test-admin.service'])
    if states(config) != head:
        raise RuntimeError('New stack not confirmed')
    record = state_dir / (basename + '-success.json')
    write_private(record, {'revision': head, 'images': images, 'backup': backup})
    os.replace(record, state_dir / 'last-success.json')
    marker.unlink()
    return 'updated'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--check-only', action='store_true')
    args = parser.parse_args()
    try:
        config_path = Path(args.config)
        if (config_path.is_symlink() or config_path.stat().st_uid != os.getuid()
                or config_path.stat().st_mode & 0o777 != 0o600):
            raise ValueError('Private operator configuration required')
        config = json.loads(config_path.read_text())
        if (set(config) != {'container', 'image', 'state_dir'}
                or type(config['container']) is not int or config['container'] <= 0
                or not re.fullmatch(r'docker.io/[a-z0-9_-]+/auftragskompass', config['image'])):
            raise ValueError('Invalid operator configuration')
        os.umask(0o077)
        with open('/run/lock/auftragskompass-update.lock', 'a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            print(update(config, check_only=args.check_only))
    except Exception:
        # Never print API bodies, command output, configuration or private paths.
        print('Update not confirmed; inspect operator state and service health', file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == '__main__':
    main()
