import { describe, expect, test } from 'vitest';
import {
  canTransitionMailOutbox,
  mailOutboxRetryDelaySeconds,
  mailFolders,
  mailSendStates,
} from '../../packages/core/src/mail.js';

// MAIL-021-A: the outbox is the only thing that ever talks to a provider. Its
// states may move forward (including an explicit retry after a failure), never
// back to an earlier state, and never out of a terminal state.
describe('mail outbox transitions', () => {
  test('queue, claim, delivery and failure move forward', () => {
    expect(canTransitionMailOutbox('pending', 'sending')).toBe(true);
    expect(canTransitionMailOutbox('sending', 'sent')).toBe(true);
    expect(canTransitionMailOutbox('sending', 'failed')).toBe(true);
    expect(canTransitionMailOutbox('sending', 'uncertain')).toBe(true);
    // EM-07: a failed attempt may be retried once its backoff has elapsed.
    expect(canTransitionMailOutbox('failed', 'sending')).toBe(true);
  });

  test('nothing moves backwards or leaves a terminal state', () => {
    for (const [from, to] of [
      ['sending', 'pending'],
      ['sent', 'sending'],
      ['sent', 'pending'],
      ['sent', 'failed'],
      ['uncertain', 'sending'],
      ['uncertain', 'failed'],
      ['pending', 'sent'],
      ['pending', 'failed'],
      ['failed', 'sent'],
    ] as const)
      expect(canTransitionMailOutbox(from, to)).toBe(false);
  });
});

describe('mail outbox retry spacing', () => {
  test('grows exponentially and stops at the six hour ceiling', () => {
    expect(mailOutboxRetryDelaySeconds(0)).toBe(15);
    expect(mailOutboxRetryDelaySeconds(1)).toBe(30);
    expect(mailOutboxRetryDelaySeconds(4)).toBe(240);
    expect(mailOutboxRetryDelaySeconds(10)).toBe(15360);
    // The stored attempt counter is unbounded; the delay is not.
    expect(mailOutboxRetryDelaySeconds(40)).toBe(21600);
  });
});

describe('mail vocabulary', () => {
  test('folders and send states are the closed documented sets', () => {
    expect(mailFolders).toEqual(['inbox', 'drafts', 'sent', 'trash']);
    expect(mailSendStates).toEqual([
      'none',
      'scheduled',
      'sending',
      'sent',
      'failed',
      'uncertain',
    ]);
  });
});
