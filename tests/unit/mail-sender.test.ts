import { describe, expect, test } from 'vitest';
import {
  classifySmtpFailure,
  type SmtpAttemptPhase,
} from '../../packages/core/src/mail-sender.js';

// MAIL-021-B: the adapter may only answer three things - accepted, unclear, or
// definitively refused with one code from a closed set. The table below is the
// whole diagnosis vocabulary; nothing else may reach a log or a row.
function error(
  shape: {
    code?: string;
    command?: string;
    responseCode?: number;
    message?: string;
  },
  phase: SmtpAttemptPhase,
) {
  const value = new Error(shape.message ?? 'fictional transport failure');
  Object.assign(value, shape);
  return classifySmtpFailure(value, phase);
}

describe('SMTP failure classification', () => {
  test('a refused authentication is a definitive, redacted failure', () => {
    expect(
      error(
        {
          code: 'EAUTH',
          command: 'AUTH PLAIN',
          responseCode: 535,
          message: 'Invalid login: 535 5.7.8 Bad credentials',
        },
        'envelope',
      ),
    ).toEqual({ failed: 'provider_auth_failed' });
  });

  test('a rejected recipient is told apart from any other refusal', () => {
    expect(
      error(
        {
          code: 'EENVELOPE',
          command: 'RCPT TO',
          responseCode: 550,
          message: "Can't send mail - all recipients were rejected",
        },
        'envelope',
      ),
    ).toEqual({ failed: 'provider_recipient_rejected' });
    expect(
      error(
        { code: 'EENVELOPE', command: 'MAIL FROM', responseCode: 553 },
        'envelope',
      ),
    ).toEqual({ failed: 'provider_rejected' });
  });

  test('any server status is a definitive refusal, never an unclear outcome', () => {
    // 554 at the greeting: the server spoke, the content never left.
    expect(
      error(
        { code: 'EPROTOCOL', command: 'CONN', responseCode: 554 },
        'unknown',
      ),
    ).toEqual({ failed: 'provider_rejected' });
    // A temporary 4xx is refused as well; the existing backoff retries it.
    expect(
      error({ command: 'RCPT TO', responseCode: 451 }, 'envelope'),
    ).toEqual({ failed: 'provider_rejected' });
  });

  test('a connection that never reached a server is a retryable failure', () => {
    expect(
      error(
        { code: 'ESOCKET', message: 'connect ECONNREFUSED 127.0.0.1:25' },
        'unknown',
      ),
    ).toEqual({ failed: 'provider_timeout' });
    expect(
      error(
        {
          code: 'ESOCKET',
          message: 'getaddrinfo ENOTFOUND smtp.example.invalid',
        },
        'unknown',
      ),
    ).toEqual({ failed: 'provider_timeout' });
    expect(
      error(
        { code: 'ECONNECTION', message: 'Greeting never received' },
        'envelope',
      ),
    ).toEqual({ failed: 'provider_timeout' });
  });

  test('a refused certificate is a definite non-delivery, not a bypass', () => {
    expect(
      error({ code: 'ESOCKET', message: 'certificate has expired' }, 'unknown'),
    ).toEqual({ failed: 'provider_timeout' });
    expect(
      error(
        {
          code: 'ESOCKET',
          message: 'self-signed certificate in certificate chain',
        },
        'unknown',
      ),
    ).toEqual({ failed: 'provider_timeout' });
  });

  test('a connection lost before the content started is a definite failure', () => {
    expect(
      error(
        { code: 'ECONNECTION', message: 'Connection closed unexpectedly' },
        'envelope',
      ),
    ).toEqual({ failed: 'provider_timeout' });
  });

  test('a connection lost after DATA (or at an unknown stage) stays unclear', () => {
    for (const phase of ['data', 'unknown'] as const)
      expect(
        error(
          { code: 'ECONNECTION', message: 'Connection closed unexpectedly' },
          phase,
        ),
      ).toBe('uncertain');
    expect(error({ code: 'ETIMEDOUT', message: 'Timeout' }, 'data')).toBe(
      'uncertain',
    );
  });

  test('our own message build problems and foreign throws are internal', () => {
    expect(
      error({ code: 'EMESSAGE', message: 'Message size too large' }, 'data'),
    ).toEqual({
      failed: 'internal',
    });
    expect(classifySmtpFailure('fictional non-error throw', 'data')).toEqual({
      failed: 'internal',
    });
  });

  test('never carries a server answer, an address or a token into the result', () => {
    const result = classifySmtpFailure(
      Object.assign(
        new Error('550 5.1.1 <synthetic.contact@example.invalid>: unknown'),
        { code: 'EENVELOPE', command: 'RCPT TO', responseCode: 550 },
      ),
      'data',
    );
    expect(JSON.stringify(result)).not.toContain('@');
    expect(JSON.stringify(result)).not.toContain('550');
    expect(JSON.stringify(result)).not.toContain('unknown');
  });
});

// MAIL-021-B review: with credentials configured the transport must REQUIRE
// TLS - opportunistic STARTTLS would otherwise send the password in clear
// text to a server that never upgrades. Without credentials (local relay) no
// TLS is forced.
