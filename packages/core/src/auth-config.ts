export type GoogleAuthConfig = {
  mode?: 'google';
  origin: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
};
export type PasswordAuthConfig = {
  mode: 'password';
  origin: string;
  tenantId: string;
};
export type AuthConfig = GoogleAuthConfig | PasswordAuthConfig;
export function loadAuthConfig(
  env: NodeJS.ProcessEnv,
  readSecret: (path: string) => string,
): AuthConfig | undefined {
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
  if (env.AK_AUTH_MODE === 'password')
    return { mode: 'password', origin: origin.origin, tenantId };
  if (env.AK_AUTH_MODE && env.AK_AUTH_MODE !== 'google')
    throw new Error('Invalid AK_AUTH_MODE');
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
