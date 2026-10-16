import * as oidc from 'openid-client';
import type { GoogleAuthConfig } from './auth-config.js';
export type LoginAttempt = { state: string; verifier: string; nonce: string };
export type GoogleIdentity = { subject: string; email: string };
export interface IdentityProvider {
  authorization(attempt: LoginAttempt): Promise<string>;
  redeem(url: URL, attempt: LoginAttempt): Promise<GoogleIdentity>;
}
export async function googleProvider(
  config: GoogleAuthConfig,
  transport?: oidc.CustomFetch,
): Promise<IdentityProvider> {
  const client = await oidc.discovery(
    new URL('https://accounts.google.com'),
    config.clientId,
    config.clientSecret,
    undefined,
    transport ? { [oidc.customFetch]: transport } : undefined,
  );
  // Also verify the ID token signature instead of relying solely on TLS to the token endpoint.
  oidc.enableNonRepudiationChecks(client);
  return {
    async authorization(attempt) {
      return oidc.buildAuthorizationUrl(client, {
        redirect_uri: `${config.origin}/auth/callback`,
        scope: 'openid email',
        response_type: 'code',
        state: attempt.state,
        nonce: attempt.nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(attempt.verifier),
        code_challenge_method: 'S256',
      }).href;
    },
    async redeem(url, attempt) {
      if (url.origin !== config.origin || url.pathname !== '/auth/callback')
        throw new Error('Invalid callback');
      const tokens = await oidc.authorizationCodeGrant(client, url, {
        pkceCodeVerifier: attempt.verifier,
        expectedState: attempt.state,
        expectedNonce: attempt.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims()!;
      if (
        claims.email_verified !== true ||
        typeof claims.email !== 'string' ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email) ||
        claims.email.length > 254
      )
        throw new Error('Unverified identity');
      return { subject: claims.sub, email: claims.email.toLowerCase() };
    },
  };
}
