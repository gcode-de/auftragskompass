import {
  inquiryFormV1,
  type InquirySubmission,
} from '@auftragskompass/core/inquiry-form-definition';
export class InquiryClientError extends Error {
  constructor(
    readonly reason:
      'invalid' | 'unavailable' | 'rejected' | 'conflict' | 'rate_limited',
  ) {
    super('Inquiry submission unavailable');
  }
}
export function createInquirySubmission(
  origin: string,
  fields: InquirySubmission['fields'],
  website?: string,
) {
  let endpoint: string, body: string;
  try {
    const url = new URL(origin);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error();
    endpoint =
      url.origin + '/public/v1/forms/' + inquiryFormV1.id + '/inquiries';
    body = JSON.stringify({
      submissionId: crypto.randomUUID(),
      submission: {
        formId: inquiryFormV1.id,
        formVersion: inquiryFormV1.version,
        fields,
      },
      ...(website === undefined ? {} : { website }),
    });
  } catch {
    throw new InquiryClientError('invalid');
  }
  let received = false,
    inFlight: Promise<{ status: 'received' }> | null = null;
  async function submit(): Promise<{ status: 'received' }> {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
      if (response.status !== 202) {
        await response.body?.cancel();
        throw new InquiryClientError(
          response.status === 400
            ? 'rejected'
            : response.status === 409
              ? 'conflict'
              : response.status === 429
                ? 'rate_limited'
                : 'unavailable',
        );
      }
      if (
        response.headers
          .get('content-type')
          ?.split(';')[0]
          ?.trim()
          .toLowerCase() !== 'application/json' ||
        !response.body
      ) {
        await response.body?.cancel();
        throw new InquiryClientError('unavailable');
      }
      const reader = response.body.getReader(),
        chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        if (Number(response.headers.get('content-length')) > 4096)
          throw new Error();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 4096) throw new Error();
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const joined = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const value: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(joined),
      );
      if (
        !value ||
        typeof value !== 'object' ||
        Object.keys(value).join(',') !== 'status' ||
        !('status' in value) ||
        value.status !== 'received'
      )
        throw new Error();
      received = true;
      body = '';
      return { status: 'received' };
    } catch (error) {
      if (error instanceof InquiryClientError) throw error;
      throw new InquiryClientError('unavailable');
    }
  }
  return {
    send() {
      if (received) return Promise.resolve({ status: 'received' as const });
      if (!inFlight)
        inFlight = submit().finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
  };
}
