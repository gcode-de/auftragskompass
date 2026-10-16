import { pathToFileURL } from 'node:url';

export async function ensureRepository(env, request = fetch) {
  const user = env.DOCKERHUB_USER;
  const secret = env.DOCKERHUB_TOKEN;
  const visibility = env.DOCKERHUB_VISIBILITY;
  if (
    !/^[a-z0-9]{2,30}$/.test(user ?? '') ||
    !secret ||
    !['private', 'public'].includes(visibility)
  )
    throw new Error('Invalid Docker Hub configuration');
  const call = (path, options) =>
    request(`https://hub.docker.com/v2/${path}`, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
  const login = await call('auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: user, secret }),
  });
  if (!login.ok) throw new Error('Docker Hub authentication failed');
  const { access_token: token } = await login.json();
  if (typeof token !== 'string' || !token)
    throw new Error('Invalid Docker Hub authentication response');
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const path = `namespaces/${user}/repositories`;
  const existing = await call(`${path}/auftragskompass`, { headers });
  if (existing.ok) {
    if ((await existing.json()).is_private !== (visibility === 'private'))
      throw new Error(
        'Existing Docker Hub visibility differs; no changes made',
      );
    return;
  }
  if (existing.status !== 404) throw new Error('Docker Hub lookup failed');
  const created = await call(path, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      namespace: user,
      name: 'auftragskompass',
      registry: 'docker.io',
      is_private: visibility === 'private',
    }),
  });
  if (!created.ok) throw new Error('Docker Hub repository creation failed');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  ensureRepository(process.env).catch(() => {
    console.error(
      'Docker Hub setup failed; check credentials, create permission, quota and repository visibility.',
    );
    process.exitCode = 1;
  });
