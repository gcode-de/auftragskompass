import { afterEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pull: vi.fn(),
  acknowledge: vi.fn(),
}));

vi.mock('../../packages/core/src/website-inquiry-pull.js', () => ({
  pullWebsiteInquiries: mocks.pull,
}));
vi.mock('../../packages/core/src/website-inquiry-ack-send.js', () => ({
  acknowledgeWebsiteInquiries: mocks.acknowledge,
}));

import { startWebsiteInquirySync } from '../../packages/core/src/inquiry-sync-worker.js';

const config = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  actorId: '22222222-2222-4222-8222-222222222222',
  origin: 'https://fictional.invalid',
  requestKey: { id: 'fictional', secret: new Uint8Array(32) } as never,
  responseKeys: [],
  intervalMs: 60_000,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('website inquiry sync wake', () => {
  test('wakes after the pull succeeds, before acknowledgement completes', async () => {
    let finishAck!: () => void;
    mocks.pull.mockResolvedValue(undefined);
    mocks.acknowledge.mockReturnValue(
      new Promise<void>((resolve) => {
        finishAck = resolve;
      }),
    );
    const wake = vi.fn();
    const loop = startWebsiteInquirySync({} as never, config, vi.fn(), wake);
    try {
      await vi.waitFor(() => expect(wake).toHaveBeenCalledTimes(1));
      expect(mocks.acknowledge).toHaveBeenCalledTimes(1);
    } finally {
      finishAck();
      await loop.stop();
    }
  });

  test('does not wake when the gateway pull fails', async () => {
    mocks.pull.mockRejectedValue(new Error('synthetic failure'));
    const wake = vi.fn();
    const reportError = vi.fn();
    const loop = startWebsiteInquirySync(
      {} as never,
      config,
      reportError,
      wake,
    );
    try {
      await vi.waitFor(() => expect(reportError).toHaveBeenCalledOnce());
      expect(loop.ready()).toBe(false);
      expect(wake).not.toHaveBeenCalled();
    } finally {
      await loop.stop();
    }
  });
});
