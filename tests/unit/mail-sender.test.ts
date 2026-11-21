import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  classifySmtpFailure,
  smtpMailSender,
  type MailSendEnvelope,
  type MailSendResult,
  type SmtpAttemptPhase,
  type SmtpSenderOptions,
} from '../../packages/core/src/mail-sender.js';

// MAIL-ACCOUNT-01: the adapter has no seam of its own, so the one nodemailer
// call it makes is replaced here. Both the transport options and the sendMail
// payload are captured; the fake transport accepts every message.
const { transportOptions, sendMailCalls } = vi.hoisted(() => ({
  transportOptions: [] as Record<string, unknown>[],
  sendMailCalls: [] as Record<string, unknown>[],
}));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: (options: Record<string, unknown>) => {
      transportOptions.push(options);
      return {
        sendMail: async (message: Record<string, unknown>) => {
          sendMailCalls.push(message);
          return { messageId: 'fictional-message-id' };
        },
        close: () => {},
      };
    },
  },
}));

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
describe('SMTP TLS requirement', () => {
  test('a provider without STARTTLS is a definitive failure, not an unclear one', () => {
    // nodemailer's own wording when the required upgrade never happens: the
    // session stayed in plaintext, so no credential and no content left.
    expect(
      error(
        {
          code: 'ETLS',
          command: 'STARTTLS',
          responseCode: 500,
          message:
            'Error upgrading connection with STARTTLS: 500 Error: command not recognized',
        },
        'unknown',
      ),
    ).toEqual({ failed: 'provider_tls_required' });
  });

  test('a certificate problem at the same step keeps its own diagnosis', () => {
    // A failed upgrade because the chain cannot be verified is not a provider
    // without TLS; verification must stay the reason that is reported.
    expect(
      error(
        {
          code: 'ETLS',
          command: 'STARTTLS',
          message: 'Error initiating TLS - certificate has expired',
        },
        'unknown',
      ),
    ).toEqual({ failed: 'provider_timeout' });
  });
});

// MAIL-ACCOUNT-01: an explicit security choice from the account settings must
// reach nodemailer unchanged, and the display name may only decorate the From
// header - the envelope keeps the bare address the server validates.
const account = {
  host: 'smtp.example.invalid',
  port: 587,
  username: '',
  secret: '',
};

const content = {
  subject: 'Fictional subject',
  text: 'Fictional body',
  html: null,
  messageId: null,
};

const bareEnvelope: MailSendEnvelope = {
  from: 'versand@example.invalid',
  to: ['synthetic.contact@example.invalid'],
  cc: [],
  bcc: [],
};

async function send(
  options: Partial<SmtpSenderOptions>,
  envelope: MailSendEnvelope = bareEnvelope,
): Promise<MailSendResult> {
  return smtpMailSender({ ...account, ...options }).send(envelope, content);
}

describe('SMTP transport security and sender identity', () => {
  beforeEach(() => {
    transportOptions.length = 0;
    sendMailCalls.length = 0;
  });

  test('starttls hard-requires the upgrade, with and without a username', async () => {
    expect(await send({ security: 'starttls' })).toBe('sent');
    expect(
      await send({
        security: 'starttls',
        username: 'synthetic.user@example.invalid',
        secret: 'fictional-secret',
      }),
    ).toBe('sent');
    expect(
      transportOptions.map((options) => ({
        secure: options.secure,
        requireTLS: options.requireTLS,
      })),
    ).toEqual([
      { secure: false, requireTLS: true },
      { secure: false, requireTLS: true },
    ]);
  });

  test('implicit is TLS from the first byte, never a second upgrade', async () => {
    await send({
      security: 'implicit',
      username: 'synthetic.user@example.invalid',
      secret: 'fictional-secret',
    });
    expect(transportOptions).toHaveLength(1);
    expect(transportOptions[0]).toMatchObject({
      secure: true,
      requireTLS: false,
    });
  });

  test('none stays plaintext and never demands an upgrade', async () => {
    await send({ security: 'none', port: 25 });
    expect(transportOptions).toHaveLength(1);
    expect(transportOptions[0]).toMatchObject({
      secure: false,
      requireTLS: false,
    });
  });

  test('without a security choice the legacy derivation still applies', async () => {
    await send({
      username: 'synthetic.user@example.invalid',
      secret: 'fictional-secret',
    });
    await send({ port: 465 });
    expect(
      transportOptions.map((options) => ({
        secure: options.secure,
        requireTLS: options.requireTLS,
      })),
    ).toEqual([
      // A username forces STARTTLS on the submission port ...
      { secure: false, requireTLS: true },
      // ... while 465 is SMTPS without any credentials.
      { secure: true, requireTLS: false },
    ]);
  });

  test('a display name decorates the header, not the envelope', async () => {
    expect(
      await send({}, { ...bareEnvelope, fromName: 'Fotobox Muster' }),
    ).toBe('sent');
    await send({});
    expect(sendMailCalls[0]).toMatchObject({
      from: 'Fotobox Muster <versand@example.invalid>',
      envelope: { from: 'versand@example.invalid' },
    });
    expect(sendMailCalls[1]).toMatchObject({
      from: 'versand@example.invalid',
      envelope: { from: 'versand@example.invalid' },
    });
  });
});
