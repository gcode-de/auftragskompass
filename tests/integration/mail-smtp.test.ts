import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';
import { SMTPServer } from 'smtp-server';
import nodemailer from 'nodemailer';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

// MAIL-021-B2: an authenticated send now requires TLS, so the success cases need
// a session the client can actually verify. No public certificate and no public
// key may enter the repository, so the fixture is a throwaway self-signed
// certificate generated once per run with the openssl CLI: valid for two days,
// for 127.0.0.1 only, kept in a temporary directory and deleted afterwards.
// It is the mock server's certificate *and* the only extra trust anchor of this
// test process - verification stays enabled, nothing is disabled.
type TlsFixture = { key: string; cert: string; directory: string };
let fixture: TlsFixture;

function createFixture(): TlsFixture {
  const directory = mkdtempSync(join(tmpdir(), 'ak-mail-tls-')),
    config = join(directory, 'openssl.cnf');
  writeFileSync(
    config,
    [
      '[req]',
      'distinguished_name = dn',
      'x509_extensions = ext',
      'prompt = no',
      '[dn]',
      'CN = 127.0.0.1',
      '[ext]',
      'subjectAltName = IP:127.0.0.1',
      'basicConstraints = critical,CA:TRUE',
      'keyUsage = critical,digitalSignature,keyEncipherment,keyCertSign',
      'extendedKeyUsage = serverAuth',
      '',
    ].join('\n'),
  );
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '2',
      '-config',
      config,
      '-keyout',
      join(directory, 'key.pem'),
      '-out',
      join(directory, 'cert.pem'),
    ],
    { stdio: 'ignore' },
  );
  return {
    key: readFileSync(join(directory, 'key.pem'), 'utf8'),
    cert: readFileSync(join(directory, 'cert.pem'), 'utf8'),
    directory,
  };
}

// The adapter deliberately has no test hook, so the trust anchor is added where
// only a test can reach it: the one nodemailer call the adapter makes. The
// injected `ca` adds a trust anchor; `rejectUnauthorized` keeps its secure
// default and is never touched here.
let transportOptions: Record<string, unknown>[] = [];

beforeAll(() => {
  fixture = createFixture();
  const realCreate = nodemailer.createTransport.bind(nodemailer) as (
    options: Record<string, unknown>,
    defaults?: Record<string, unknown>,
  ) => ReturnType<typeof nodemailer.createTransport>;
  vi.spyOn(nodemailer, 'createTransport').mockImplementation(((
    options: Record<string, unknown>,
    defaults?: Record<string, unknown>,
  ) => {
    transportOptions.push(options);
    return realCreate(
      {
        ...options,
        tls: {
          ...((options.tls as Record<string, unknown> | undefined) ?? {}),
          ca: fixture.cert,
        },
      },
      defaults,
    );
  }) as typeof nodemailer.createTransport);
});
afterAll(() => {
  vi.restoreAllMocks();
  rmSync(fixture.directory, { recursive: true, force: true });
});
beforeEach(() => {
  transportOptions = [];
});

type Behaviour = {
  rejectAuth?: boolean;
  rejectRecipient?: boolean;
  dropBeforeData?: boolean;
  dropAfterData?: boolean;
  hangAfterData?: boolean;
  /** No TLS at all: a provider that would take the password in clear text. */
  plaintext?: boolean;
  /** STARTTLS with smtp-server's built-in, publicly known and expired cert. */
  expiredCertificate?: boolean;
};

function mockServer(behaviour: Behaviour = {}) {
  const state = {
    recipients: [] as string[],
    message: null as string | null,
    authAttempts: 0,
  };
  let socket: Socket | null = null;
  const server = new SMTPServer({
    // The plaintext case withdraws STARTTLS from EHLO entirely; every other case
    // offers it, with the fixture certificate or the built-in expired one.
    disabledCommands: behaviour.plaintext ? ['STARTTLS'] : [],
    ...(behaviour.plaintext || behaviour.expiredCertificate
      ? {}
      : { key: fixture.key, cert: fixture.cert }),
    // PIPELINING is withdrawn for the "abort before DATA" case: a pipelining
    // client writes MAIL FROM, RCPT TO and DATA in one go, so DATA has already
    // left the client before the envelope reply arrives.
    hidePIPELINING: behaviour.dropBeforeData === true,
    authOptional: !behaviour.rejectAuth,
    // The mock accepts AUTH on a session the client did not encrypt, so a
    // password sent in clear text would be visible instead of impossible. That
    // is exactly the leak the adapter must never cause - the tests assert the
    // adapter does not get that far, not that the mock would refuse it.
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
    // Configured credentials travel over TLS only: the session was upgraded
    // before AUTH, and the adapter asked the library to require that upgrade.
    expect(transportOptions[0]?.requireTLS).toBe(true);
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

  test('credentials without STARTTLS never reach an unencrypted session', async () => {
    // A provider that offers no TLS at all: with credentials configured the
    // adapter must refuse before AUTH, because the password would otherwise
    // cross the wire in clear text. The mock would accept it - this test proves
    // the adapter never tries.
    const { mock, send } = await sender({ plaintext: true });
    expect(await send()).toEqual({ failed: 'provider_tls_required' });
    expect(mock.state.authAttempts).toBe(0);
    expect(mock.state.message).toBeNull();
    expect(mock.state.recipients).toEqual([]);
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
    // switched verification off - or that trusted the fixture blindly - would
    // deliver instead. The fixture CA does not sign this certificate.
    const { mock, send } = await sender({ expiredCertificate: true });
    const result = await send();
    expect(result).not.toBe('sent');
    expect(result).toEqual({ failed: 'provider_timeout' });
    expect(mock.state.message).toBeNull();
  });

  test('carries html and a stored Message-ID, and sends unauthenticated without a username', async () => {
    // No credentials means a local relay: TLS is not forced, because there is no
    // password to protect. Plaintext is the deliberate exception, not the rule.
    const mock = mockServer({ plaintext: true });
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
    expect(transportOptions[0]?.requireTLS).toBe(false);
    expect(mock.state.message?.toLowerCase()).toContain(
      'message-id: <fictional-thread@example.invalid>',
    );
    expect(mock.state.message).toContain('Synthetic html body.');
    // An account without a username authenticates with nothing at all.
    expect(mock.state.authAttempts).toBe(0);
  });
});

// MAIL-DOC-01: the adapter forwards the attachment it was handed. The bytes
// are a synthetic PDF artefact - no real document exists anywhere in this test.
function attachmentBytes(raw: string, filename: string) {
  // nodemailer quotes a filename only when it has to; the marker is the name.
  const named = raw.indexOf(filename);
  if (named < 0) throw new Error('fictional attachment missing');
  const bodyStart = raw.indexOf('\r\n\r\n', named) + 4,
    bodyEnd = raw.indexOf('\r\n--', bodyStart);
  return Buffer.from(
    raw.slice(bodyStart, bodyEnd < 0 ? undefined : bodyEnd).replace(/\s+/g, ''),
    'base64',
  );
}

test('carries the stored PDF as a byte-identical MIME attachment', async () => {
  const mock = mockServer({ plaintext: true });
  open.push(mock);
  const port = await mock.listen();
  const bytes = Buffer.from(
    '%PDF-1.4\n% fictional attachment for the mail fixture\n' +
      '1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<<>>\n%%EOF\n',
    'latin1',
  );
  const result = await smtpMailSender({
    host: '127.0.0.1',
    port,
    username: '',
    secret: '',
  }).send(envelope, {
    ...content,
    attachments: [
      {
        filename: 'Dokument-RE-2030-0001.pdf',
        content: bytes,
        contentType: 'application/pdf',
      },
    ],
  });
  expect(result).toBe('sent');
  const raw = mock.state.message!;
  expect(raw).toContain('Content-Type: application/pdf');
  expect(raw).toContain('Dokument-RE-2030-0001.pdf');
  expect(raw).toContain('Content-Transfer-Encoding: base64');
  // The attachment is rebuilt exactly from the transferred bytes: the adapter
  // added transport encoding, nothing else.
  expect(
    Buffer.compare(attachmentBytes(raw, 'Dokument-RE-2030-0001.pdf'), bytes),
  ).toBe(0);
  // A message without attachments keeps its single-part shape.
  expect(raw).not.toContain('filename="Dokument-RE-2030-0002.pdf"');
});
