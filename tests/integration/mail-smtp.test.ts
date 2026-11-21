import { afterEach, describe, expect, test } from 'vitest';
import { SMTPServer } from 'smtp-server';
import type { AddressInfo, Socket } from 'node:net';
import { smtpMailSender } from '../../packages/core/src/mail-sender.js';

// MAIL-021-B: only a local mock SMTP server on 127.0.0.1. No provider, no real
// credentials, no real recipient. Every address is synthetic and reserved.
const envelope = {
  from: 'synthetic.sender@example.invalid',
  to: ['synthetic.contact@example.invalid'],
  cc: ['synthetic.copy@example.invalid'],
  bcc: ['synthetic.blind@example.invalid'],
};
const content = {
  subject: 'Fictional SMTP slice',
  text: 'Synthetic body text.',
  html: null,
  messageId: '<fictional-message@example.invalid>',
};

type Behaviour = {
  rejectAuth?: boolean;
  rejectRecipient?: boolean;
  dropBeforeData?: boolean;
  dropAfterData?: boolean;
  hangAfterData?: boolean;
  advertiseStartTls?: boolean;
};

function mockServer(behaviour: Behaviour = {}) {
  const state = {
    recipients: [] as string[],
    message: null as string | null,
    authAttempts: 0,
  };
  let socket: Socket | null = null;
  const server = new SMTPServer({
    // The mock offers no TLS unless a test asks for it, so the client's default
    // opportunistic STARTTLS simply has nothing to upgrade to. The adapter never
    // disables certificate verification - see the TLS test below.
    // PIPELINING is withdrawn for the "abort before DATA" case: a pipelining
    // client writes MAIL FROM, RCPT TO and DATA in one go, so DATA has already
    // left the client before the envelope reply arrives.
    disabledCommands: behaviour.advertiseStartTls ? [] : ['STARTTLS'],
    hidePIPELINING: behaviour.dropBeforeData === true,
    authOptional: !behaviour.rejectAuth,
    // The mock is plaintext localhost, so it accepts the synthetic password
    // without TLS. This is a property of the mock; the adapter neither asks for
    // plaintext auth nor weakens certificate checks.
    allowInsecureAuth: true,
    logger: false,
    onAuth(auth, session, callback) {
      state.authAttempts += 1;
      if (behaviour.rejectAuth) return callback(new Error('Invalid login'));
      callback(null, { user: auth.username });
    },
    onRcptTo(address, session, callback) {
      if (behaviour.rejectRecipient)
        return callback(
          Object.assign(new Error('550 Unknown recipient'), {
            responseCode: 550,
          }),
        );
      state.recipients.push(address.address);
      if (behaviour.dropBeforeData) {
        // The envelope was accepted, the content never started: the client is
        // left waiting for a reply until the socket dies.
        setImmediate(() => socket?.destroy());
        return;
      }
      callback();
    },
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => {
        state.message = Buffer.concat(chunks).toString('utf8');
        if (behaviour.dropAfterData) {
          socket?.destroy();
          return;
        }
        if (behaviour.hangAfterData) return;
        callback();
      });
    },
  });
  server.server.on('connection', (connection) => (socket = connection));
  return {
    state,
    async listen() {
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', () => resolve()),
      );
      return (server.server.address() as AddressInfo).port;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const open: { close: () => Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((server) => server.close()));
});

async function sender(behaviour: Behaviour = {}, port?: number) {
  const mock = mockServer(behaviour);
  open.push(mock);
  const resolved = port ?? (await mock.listen());
  return {
    mock,
    port: resolved,
    send: () =>
      smtpMailSender({
        host: '127.0.0.1',
        port: resolved,
        username: 'synthetic.sender@example.invalid',
        secret: 'synthetic-smtp-secret',
        connectionTimeoutMs: 2000,
        greetingTimeoutMs: 2000,
        socketTimeoutMs: 500,
      }).send(envelope, content),
  };
}

describe('SMTP sender against a local mock', () => {
  test('an accepted message is the only thing reported as sent', async () => {
    const { mock, send } = await sender();
    expect(await send()).toBe('sent');
    // An, CC and BCC reach the envelope; BCC never becomes a visible header.
    expect(mock.state.recipients.sort()).toEqual(
      [...envelope.to, ...envelope.cc, ...envelope.bcc].sort(),
    );
    expect(mock.state.message).toContain('Subject: Fictional SMTP slice');
    expect(mock.state.message).toContain('Synthetic body text.');
    expect(mock.state.message?.toLowerCase()).not.toContain('bcc:');
    expect(mock.state.message).not.toContain('synthetic.blind@example.invalid');
  });

  test('a rejected recipient is a definitively failed attempt', async () => {
    const { mock, send } = await sender({ rejectRecipient: true });
    expect(await send()).toEqual({ failed: 'provider_recipient_rejected' });
    expect(mock.state.message).toBeNull();
  });

  test('a refused authentication is a definitively failed attempt', async () => {
    const { mock, send } = await sender({ rejectAuth: true });
    expect(await send()).toEqual({ failed: 'provider_auth_failed' });
    expect(mock.state.message).toBeNull();
  });

  test('a broken connection before the content is a definitively failed attempt', async () => {
    const { mock, send } = await sender({ dropBeforeData: true });
    expect(await send()).toEqual({ failed: 'provider_timeout' });
    expect(mock.state.message).toBeNull();
  });

  test('a connection lost after DATA stays uncertain - the server may have it', async () => {
    const { mock, send } = await sender({ dropAfterData: true });
    expect(await send()).toBe('uncertain');
    // Proof that the content really reached the mock before the connection died.
    expect(mock.state.message).toContain('Synthetic body text.');
  });

  test('a timeout after the content started stays uncertain as well', async () => {
    const { mock, send } = await sender({ hangAfterData: true });
    expect(await send()).toBe('uncertain');
    expect(mock.state.message).toContain('Synthetic body text.');
  });

  test('a host that never answers is a retryable failure', async () => {
    // Reserve a port and close it again: nothing is listening there.
    const probe = mockServer();
    const port = await probe.listen();
    await probe.close();
    const { send } = await sender({}, port);
    expect(await send()).toEqual({ failed: 'provider_timeout' });
  });

  test('an unverifiable certificate is refused instead of bypassed', async () => {
    // The mock's built-in certificate is publicly known and expired, so a client
    // that verified it would have to reject the connection. A sender that
    // switched verification off would deliver instead.
    const { mock, send } = await sender({ advertiseStartTls: true });
    const result = await send();
    expect(result).not.toBe('sent');
    expect(result).toEqual({ failed: 'provider_timeout' });
    expect(mock.state.message).toBeNull();
  });

  test('carries html and a stored Message-ID, and sends unauthenticated without a username', async () => {
    const mock = mockServer();
    open.push(mock);
    const port = await mock.listen();
    const result = await smtpMailSender({
      host: '127.0.0.1',
      port,
      username: '',
      secret: '',
    }).send(envelope, {
      ...content,
      html: '<p>Synthetic html body.</p>',
      messageId: '<fictional-thread@example.invalid>',
    });
    expect(result).toBe('sent');
    expect(mock.state.message?.toLowerCase()).toContain(
      'message-id: <fictional-thread@example.invalid>',
    );
    expect(mock.state.message).toContain('Synthetic html body.');
    // An account without a username authenticates with nothing at all.
    expect(mock.state.authAttempts).toBe(0);
  });
});
