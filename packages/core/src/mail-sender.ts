import nodemailer from 'nodemailer';

// MAIL-021-B: the provider boundary of the mail core. The outbox owns the
// durable attempt; this module owns the only external effect. It answers one of
// exactly three things - accepted, unclear, or definitively refused with one
// code from the closed set below - and never a message, an address, a server
// reply or a token. SMTP "accepted" is not a delivery proof (BKP023), so the
// outbox records `sent` for it and nothing more.
export type MailSenderAccount = {
  host: string;
  port: number | null;
  username: string;
  /** Plain secret, decrypted for the duration of one attempt only. */
  secret: string;
};
export type MailSendEnvelope = {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
};
export type MailSendContent = {
  subject: string;
  text: string;
  html: string | null;
  messageId: string | null;
};
/** Redacted diagnosis only. Each code names one operator action, nothing else. */
export type MailSendFailureCode =
  | 'provider_auth_failed'
  | 'provider_recipient_rejected'
  | 'provider_rejected'
  | 'provider_timeout'
  | 'internal';
export type MailSendResult =
  'sent' | 'uncertain' | { failed: MailSendFailureCode };
export type MailSender = {
  send(
    envelope: MailSendEnvelope,
    content: MailSendContent,
  ): Promise<MailSendResult>;
};
/** How far the attempt got before it failed. `data` means content may be out. */
export type SmtpAttemptPhase = 'unknown' | 'envelope' | 'data';
export type SmtpSenderOptions = MailSenderAccount & {
  connectionTimeoutMs?: number;
  greetingTimeoutMs?: number;
  socketTimeoutMs?: number;
};

// The one decision that must never be guessed: a connection that dies after the
// DATA command may have left a queued mail at the server, so a resend could
// duplicate it (BKP021, BKP023). Only a server status or a failure before the
// content started proves that nothing was sent.
export function classifySmtpFailure(
  error: unknown,
  phase: SmtpAttemptPhase,
): MailSendResult {
  // A throw of our own making is not a provider answer.
  if (!(error instanceof Error)) return { failed: 'internal' };
  const code = (error as { code?: unknown }).code,
    command = (error as { command?: unknown }).command,
    responseCode = (error as { responseCode?: unknown }).responseCode;
  // The server answered: the message was refused at that step, nothing queued.
  if (code === 'EAUTH') return { failed: 'provider_auth_failed' };
  if (code === 'EENVELOPE')
    return {
      failed:
        typeof command === 'string' && command.startsWith('RCPT TO')
          ? 'provider_recipient_rejected'
          : 'provider_rejected',
    };
  if (typeof responseCode === 'number' && Number.isInteger(responseCode))
    return { failed: 'provider_rejected' };
  // Our own message build problem, not a transport outcome.
  if (code === 'EMESSAGE' || code === 'ESTREAM') return { failed: 'internal' };
  // No server ever participated: no connection, no name, no trusted cert.
  if (
    /^(connect |getaddrinfo )/.test(error.message) ||
    /certificate|self.signed|CERT_/i.test(error.message)
  )
    return { failed: 'provider_timeout' };
  if (
    ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH'].includes(
      String(code),
    ) ||
    error.message === 'Greeting never received' ||
    error.message === 'Connection timeout'
  )
    return { failed: 'provider_timeout' };
  // A lost session is only provably safe while no content was on its way.
  if (phase === 'envelope') return { failed: 'provider_timeout' };
  // `data`, and every stage we could not observe, stays unclear for good.
  return 'uncertain';
}

// nodemailer has no per-phase hook, so the documented debug stream is the only
// supported signal for "the DATA command left the client". We keep one boolean
// and drop the text: nothing from this stream is ever logged or stored.
function phaseTrackingLogger(track: (phase: SmtpAttemptPhase) => void) {
  const nothing = () => {};
  return {
    debug: (entry: unknown, message?: unknown) => {
      if ((entry as { tnx?: string } | undefined)?.tnx !== 'client') return;
      track(
        typeof message === 'string' && message.slice(0, 4) === 'DATA'
          ? 'data'
          : 'envelope',
      );
    },
    trace: nothing,
    info: nothing,
    warn: nothing,
    error: nothing,
    fatal: nothing,
  };
}

// One transport per attempt: a send either completes or is closed, never pooled
// across accounts. TLS is the library default - SMTPS on 465, opportunistic
// STARTTLS everywhere else - and certificate verification is never weakened.
export function smtpMailSender(options: SmtpSenderOptions): MailSender {
  const port = options.port ?? 587;
  return {
    async send(envelope, content) {
      let phase: SmtpAttemptPhase = 'unknown';
      const transport = nodemailer.createTransport({
        host: options.host,
        port,
        secure: port === 465,
        ...(options.username
          ? { auth: { user: options.username, pass: options.secret } }
          : {}),
        connectionTimeout: options.connectionTimeoutMs ?? 10000,
        greetingTimeout: options.greetingTimeoutMs ?? 10000,
        socketTimeout: options.socketTimeoutMs ?? 60000,
        debug: true,
        logger: phaseTrackingLogger((next) => {
          if (next === 'data' || phase === 'unknown') phase = next;
        }),
      });
      try {
        await transport.sendMail({
          envelope: {
            from: envelope.from,
            to: [...envelope.to, ...envelope.cc, ...envelope.bcc],
          },
          from: envelope.from,
          to: envelope.to.join(', '),
          ...(envelope.cc.length ? { cc: envelope.cc.join(', ') } : {}),
          // BCC stays in the envelope. nodemailer keeps it out of the generated
          // header, so no recipient ever sees the blind copies.
          ...(envelope.bcc.length ? { bcc: envelope.bcc.join(', ') } : {}),
          subject: content.subject,
          text: content.text,
          ...(content.html === null ? {} : { html: content.html }),
          ...(content.messageId === null
            ? {}
            : { messageId: content.messageId }),
        });
        return 'sent';
      } catch (error) {
        return classifySmtpFailure(error, phase);
      } finally {
        transport.close();
      }
    },
  };
}
