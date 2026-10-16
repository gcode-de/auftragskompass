"""Operator-only native password recovery through an existing Podman API container."""
import argparse
import json
import os
from pathlib import Path
import re
import stat
import subprocess

# Only process wiring runs here; policy, account checks, mutation and audit live in TS core.
NODE_RESET = r'''
import {readFileSync} from 'node:fs';
import {Pool} from 'pg';
import {loadAuthConfig,loadRuntimeConfig,passwordAccess} from '@auftragskompass/core';
let pool;
try {
  const read = path => readFileSync(path,'utf8');
  const auth = loadAuthConfig(process.env,read);
  if(auth?.mode!=='password') throw Error('disabled');
  const c = loadRuntimeConfig(process.env,read);
  const data = JSON.parse(readFileSync(0,'utf8'));
  pool = new Pool({host:c.host,port:c.dbPort,user:c.user,password:c.password,database:c.database,connectionTimeoutMillis:800,statement_timeout:800,max:1});
  pool.on('error',()=>{});
  if(!await passwordAccess(pool,auth.tenantId).resetPasswordAsOperator(data.username,data.password)) throw Error('not_resettable');
} catch {
  process.exitCode=1;
} finally { await pool?.end(); }
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--project', required=True)
    parser.add_argument('--username', required=True)
    parser.add_argument('--password-file', required=True)
    args, unknown = parser.parse_known_args()
    if unknown:
        parser.error('Unknown arguments; use --password-file, never an inline password')
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]*', args.project):
        parser.error('Invalid project prefix')
    username = args.username.strip().lower()
    if not re.fullmatch(r'[a-z0-9][a-z0-9._-]{2,63}', username):
        parser.error('Invalid username')
    try:
        path = Path(args.password_file).resolve(strict=True)
        if any((directory / '.git').exists() for directory in path.parents):
            parser.error('Password file must be outside Git')
        if not path.is_file():
            parser.error('Password input must be a regular file')
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as stream:
            metadata = os.fstat(stream.fileno())
            if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid()
                    or metadata.st_mode & 0o077 or metadata.st_size > 512):
                parser.error('Password file must be owner-only, owned by the operator and at most 512 bytes')
            raw = stream.read(513)
            if len(raw) > 512:
                parser.error('Password file is too large')
            password = re.sub(r'\r?\n$', '', raw.decode('utf8'), count=1)
    except (OSError, UnicodeError):
        parser.error('Cannot read private UTF-8 password file')
    try:
        subprocess.run(['podman', 'exec', '-i', '--workdir', '/app/apps/api',
                        args.project + '-api', 'node', '--input-type=module', '-e', NODE_RESET],
                       input=json.dumps({'username': username, 'password': password}),
                       text=True, capture_output=True, check=True, timeout=30)
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        parser.exit(1, 'Result not confirmed; check the active account, image and database before retrying.\n')
    print('Password reset completed. Existing sessions revoked.')


if __name__ == '__main__':
    main()
