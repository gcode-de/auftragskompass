export function loadAuthConfig(
  env: NodeJS.ProcessEnv,
  readSecret: (path: string) => string,
) {
  if (!env.AK_AUTH_ENABLED || env.AK_AUTH_ENABLED === 'false') return undefined;
  if (env.AK_AUTH_ENABLED !== 'true')
    throw new Error('Invalid AK_AUTH_ENABLED');
  const origin = new URL(env.AK_AUTH_ORIGIN ?? '');
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error('Invalid AK_AUTH_ORIGIN');
  const tenantId = env.AK_TENANT_ID ?? '';
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      tenantId,
    )
  )
    throw new Error('Invalid AK_TENANT_ID');
  const clientId = env.AK_GOOGLE_CLIENT_ID;
  const secretFile = env.AK_GOOGLE_SECRET_FILE;
  if (!clientId?.trim() || !secretFile?.trim())
    throw new Error('Missing Google configuration');
  let clientSecret: string;
  try {
    clientSecret = readSecret(secretFile).trim();
  } catch {
    throw new Error('Cannot read Google secret');
  }
  if (!clientSecret) throw new Error('Empty Google secret');
  return { origin: origin.origin, tenantId, clientId, clientSecret };
}
export type AuthConfig = NonNullable<ReturnType<typeof loadAuthConfig>>;
