import { describe, expect, it } from 'vitest';
import { rtToStored, storedToRt, uid, type RoundtableMessage } from '../roundtable-message';

describe('uid', () => {
  it('returns a non-empty string', () => {
    const id = uid();
    expect(id.length).toBeGreaterThan(0);
    expect(typeof id).toBe('string');
  });

  it('does not collide across 1000 sequential calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i += 1) ids.add(uid());
    expect(ids.size).toBe(1000);
  });
});

describe('rtToStored', () => {
  it('round-trips a user message with no metadata', () => {
    const m: RoundtableMessage = { id: 'a', role: 'user', text: 'Hello' };
    expect(rtToStored(m)).toEqual({
      id: 'a',
      role: 'user',
      speaker: null,
      text: 'Hello',
      metadata: null,
    });
  });

  it('includes retrievedTweets in metadata when present', () => {
    const m: RoundtableMessage = {
      id: 'a',
      role: 'assistant',
      speaker: 'paulg',
      text: 'Reply.',
      retrievedTweets: [
        { id: 't1', text: 'tweet', url: 'u', createdAt: 'c', source: 'tweet' },
      ],
    };
    const stored = rtToStored(m);
    expect(stored.metadata).toEqual({
      retrievedTweets: [
        { id: 't1', text: 'tweet', url: 'u', createdAt: 'c', source: 'tweet' },
      ],
    });
  });

  it('includes passed + passReason in metadata when present', () => {
    const m: RoundtableMessage = {
      id: 'a',
      role: 'assistant',
      speaker: 'naval',
      text: '',
      passed: true,
      passReason: 'no fresh take',
    };
    const stored = rtToStored(m);
    expect(stored.metadata).toEqual({ passed: true, passReason: 'no fresh take' });
  });
});

describe('storedToRt', () => {
  it('round-trips a plain assistant message', () => {
    const stored = {
      id: 'a',
      role: 'assistant' as const,
      speaker: 'paulg',
      text: 'Hello',
      metadata: null,
    };
    const m = storedToRt(stored);
    expect(m).toEqual({
      id: 'a',
      role: 'assistant',
      text: 'Hello',
      speaker: 'paulg',
      retrievedTweets: undefined,
      passed: undefined,
      passReason: undefined,
    });
  });

  it('hydrates retrievedTweets + passed from metadata', () => {
    const stored = {
      id: 'a',
      role: 'assistant' as const,
      speaker: 'naval',
      text: '',
      metadata: {
        retrievedTweets: [
          { id: 't1', text: 'tweet', url: 'u', createdAt: 'c', source: 'tweet' },
        ],
        passed: true,
        passReason: 'paul covered it',
      },
    };
    const m = storedToRt(stored);
    expect(m.passed).toBe(true);
    expect(m.passReason).toBe('paul covered it');
    expect(m.retrievedTweets).toHaveLength(1);
  });

  it('treats null speaker as undefined', () => {
    const m = storedToRt({
      id: 'a',
      role: 'user',
      speaker: null,
      text: 'Hi',
      metadata: null,
    });
    expect(m.speaker).toBeUndefined();
  });
});

describe('rtToStored + storedToRt round-trip', () => {
  it('preserves message shape across one full round-trip', () => {
    const original: RoundtableMessage = {
      id: 'abc-123',
      role: 'assistant',
      speaker: 'karpathy',
      text: 'A measured reply.',
      retrievedTweets: [
        { id: 't1', text: 'tweet 1', url: 'u1', createdAt: 'c1', source: 'tweet' },
      ],
    };
    const restored = storedToRt(rtToStored(original));
    expect(restored).toEqual({
      ...original,
      passed: undefined,
      passReason: undefined,
    });
  });
});
