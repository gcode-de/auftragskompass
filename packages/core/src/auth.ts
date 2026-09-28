import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, gt, sql } from 'drizzle-orm';
import { sessions, loginAttempts, memberships, users } from './schema.js';
import { identityRepository } from './identity.js';
import type { AuthConfig } from './auth-config.js';
import type { IdentityProvider, GoogleIdentity } from './oidc.js';
export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const sessionCookie = '__Host-ak-session';
const flowCookie = '__Host-ak-flow';
const cookieOptions = {
  path: '/',
  secure: true,
  httpOnly: true,
  sameSite: 'lax' as const,
};
export type Session = { userId: string; email: string };
export type Authorize = (
  identity: GoogleIdentity,
) => Promise<{ id: string } | undefined>;

export async function registerAuth(
  app: FastifyInstance,
  pool: Pool,
  config?: AuthConfig,
  provider?: IdentityProvider,
  authorize?: Authorize,
) {
  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    max: 20,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ statusCode: 429, error: 'rate_limited' }),
  });
  const db = drizzle(pool);
  app.decorateRequest('authSession', null);
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0]!;
    if (!path.startsWith('/auth/') && !path.startsWith('/api/')) return;
    reply
      .header('Cache-Control', 'no-store')
      .header('Referrer-Policy', 'no-referrer');
    if (!config || !provider)
      return reply.code(503).send({ error: 'auth_not_configured' });
    if (path === '/auth/login' || path === '/auth/callback') return;
    const token = request.cookies[sessionCookie];
    if (!token) return reply.code(401).send({ error: 'unauthorized' });
    const [session] = await db
      .select({ userId: users.id, email: users.email })
      .from(sessions)
      .innerJoin(
        memberships,
        and(
          eq(memberships.tenantId, sessions.tenantId),
          eq(memberships.userId, sessions.userId),
        ),
      )
      .innerJoin(
        users,
        and(
          eq(users.tenantId, sessions.tenantId),
          eq(users.id, sessions.userId),
        ),
      )
      .where(
        and(
          eq(sessions.tenantId, config.tenantId),
          eq(sessions.tokenHash, digest(token)),
          gt(sessions.expiresAt, sql`now()`),
          eq(memberships.active, true),
        ),
      );
    if (!session) return reply.code(401).send({ error: 'unauthorized' });
    request.authSession = session;
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      (request.headers.origin !== config.origin ||
        request.headers['x-csrf-token'] !== digest(`csrf:${token}`))
    )
      return reply.code(403).send({ error: 'csrf_rejected' });
  });
  app.get(
    '/auth/login',
    { config: { rateLimit: {} } },
    async (_request, reply) => {
      const state = random(),
        binding = random(),
        verifier = random(),
        nonce = random();
      await db
        .delete(loginAttempts)
        .where(sql`${loginAttempts.expiresAt} <= now()`);
      await db.delete(sessions).where(sql`${sessions.expiresAt} <= now()`);
      const redirect = await provider!.authorization({
        state,
        verifier,
        nonce,
      });
      await db.insert(loginAttempts).values({
        tenantId: config!.tenantId,
        stateHash: digest(state),
        bindingHash: digest(binding),
        verifier,
        nonce,
        expiresAt: new Date(Date.now() + 300_000),
      });
      return reply
        .setCookie(flowCookie, binding, { ...cookieOptions, maxAge: 300 })
        .redirect(redirect);
    },
  );
  app.get(
    '/auth/callback',
    { config: { rateLimit: {} } },
    async (request, reply) => {
      reply.clearCookie(flowCookie, cookieOptions);
      try {
        // Never build a callback from untrusted Host or forwarded headers.
        const url = new URL(request.url, config!.origin);
        const state = url.searchParams.get('state');
        const binding = request.cookies[flowCookie];
        if (!state || !binding || url.searchParams.getAll('state').length !== 1)
          throw new Error('Invalid state');
        const [attempt] = await db
          .delete(loginAttempts)
          .where(
            and(
              eq(loginAttempts.tenantId, config!.tenantId),
              eq(loginAttempts.stateHash, digest(state)),
              eq(loginAttempts.bindingHash, digest(binding)),
              gt(loginAttempts.expiresAt, sql`now()`),
            ),
          )
          .returning();
        if (!attempt) throw new Error('Expired state');
        const identity = await provider!.redeem(url, {
          state,
          verifier: attempt.verifier,
          nonce: attempt.nonce,
        });
        const user = authorize
          ? await authorize(identity)
          : await identityRepository(pool, config!.tenantId).findAdministrator(
              identity.subject,
            );
        if (!user) return reply.code(403).send({ error: 'login_denied' });
        const token = random();
        await db.insert(sessions).values({
          tenantId: config!.tenantId,
          tokenHash: digest(token),
          userId: user.id,
          expiresAt: new Date(Date.now() + 8 * 60 * 60_000),
        });
        return reply
          .setCookie(sessionCookie, token, {
            ...cookieOptions,
            maxAge: 8 * 60 * 60,
          })
          .redirect('/');
      } catch {
        return reply.code(400).send({ error: 'login_failed' });
      }
    },
  );
  app.get(
    '/auth/me',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            required: ['email', 'csrfToken'],
            properties: {
              email: { type: 'string' },
              csrfToken: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
      },
    },
    async (request) => ({
      email: request.authSession!.email,
      csrfToken: digest(`csrf:${request.cookies[sessionCookie]!}`),
    }),
  );
  app.post('/auth/logout', async (request, reply) => {
    await db
      .delete(sessions)
      .where(
        and(
          eq(sessions.tenantId, config!.tenantId),
          eq(sessions.tokenHash, digest(request.cookies[sessionCookie]!)),
        ),
      );
    return reply.clearCookie(sessionCookie, cookieOptions).code(204).send();
  });
}
declare module 'fastify' {
  interface FastifyRequest {
    authSession: Session | null;
  }
}
