import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import type { CustomFetch } from 'openid-client';
import { googleProvider } from '../../packages/core/src/oidc.js';
import type { GoogleAuthConfig } from '../../packages/core/src/auth-config.js';
export async function syntheticGoogle(config: GoogleAuthConfig) {
  const key = await generateKeyPair('RS256');
  const wrongKey = await generateKeyPair('RS256');
  const jwk = {
    ...(await exportJWK(key.publicKey)),
    kid: 'synthetic',
    alg: 'RS256',
    use: 'sig',
  };
  const codes = new Map<
    string,
    { nonce: string; challenge: string; overrides?: Record<string, unknown> }
  >();
  const transport: CustomFetch = async (input, options) => {
    const url = String(input);
    if (url.includes('.well-known'))
      return Response.json({
        issuer: 'https://accounts.google.com',
        authorization_endpoint: 'https://accounts.google.com/authorize',
        token_endpoint: 'https://accounts.google.com/token',
        jwks_uri: 'https://accounts.google.com/jwks',
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_post'],
        code_challenge_methods_supported: ['S256'],
      });
    if (url.endsWith('/jwks')) return Response.json({ keys: [jwk] });
    if (!url.endsWith('/token')) throw new Error('Unexpected network request');
    const body = new URLSearchParams(String(options.body));
    const code = codes.get(body.get('code')!);
    codes.delete(body.get('code')!);
    if (!code || body.get('redirect_uri') !== `${config.origin}/auth/callback`)
      return Response.json({ error: 'invalid_grant' }, { status: 400 });
    const { calculatePKCECodeChallenge } = await import('openid-client');
    if (
      (await calculatePKCECodeChallenge(body.get('code_verifier')!)) !==
      code.challenge
    )
      return Response.json({ error: 'invalid_grant' }, { status: 400 });
    const claims = {
      iss: 'https://accounts.google.com',
      aud: config.clientId,
      sub: 'synthetic-subject',
      nonce: code.nonce,
      email: 'synthetic@example.invalid',
      email_verified: true,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      ...code.overrides,
    };
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'synthetic' })
      .sign(
        code.overrides?.badSignature ? wrongKey.privateKey : key.privateKey,
      );
    return Response.json({
      access_token: 'synthetic-unused',
      token_type: 'Bearer',
      id_token: token,
    });
  };
  return {
    provider: await googleProvider(config, transport),
    code(authorization: string, overrides?: Record<string, unknown>) {
      const url = new URL(authorization);
      const code = crypto.randomUUID();
      codes.set(code, {
        nonce: url.searchParams.get('nonce')!,
        challenge: url.searchParams.get('code_challenge')!,
        ...(overrides ? { overrides } : {}),
      });
      return `${config.origin}/auth/callback?code=${code}&state=${url.searchParams.get('state')!}`;
    },
  };
}
