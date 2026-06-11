import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  conversationFetcher,
  roundtableKey,
  soloKey,
} from '../conversation-cache';

const savedFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = savedFetch;
  vi.restoreAllMocks();
});

describe('soloKey', () => {
  it('builds the conversations URL with kind=solo + encoded key', () => {
    expect(soloKey('paulg')).toBe('/api/conversations?kind=solo&key=paulg');
  });

  it('URL-encodes usernames with special characters', () => {
    expect(soloKey('with space')).toBe('/api/conversations?kind=solo&key=with%20space');
  });
});

describe('roundtableKey', () => {
  it('builds the conversations URL with kind=roundtable', () => {
    expect(roundtableKey('paulg,sama')).toBe(
      '/api/conversations?kind=roundtable&key=paulg%2Csama',
    );
  });
});

describe('conversationFetcher', () => {
  it('returns the messages array on 200 JSON', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ messages: [{ id: 'm', text: 'hi' }] }), {
        status: 200,
      }),
    );
    const result = await conversationFetcher('/api/conversations?kind=solo&key=a');
    expect(result).toEqual([{ id: 'm', text: 'hi' }]);
  });

  it('returns [] on non-2xx (no throw)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response('boom', { status: 500 }));
    expect(await conversationFetcher('/x')).toEqual([]);
  });

  it('returns [] when the body has no messages field', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ other: 'value' }), { status: 200 }),
    );
    expect(await conversationFetcher('/x')).toEqual([]);
  });

  it('returns [] when the messages field is not an array', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ messages: 'not an array' }), { status: 200 }),
    );
    expect(await conversationFetcher('/x')).toEqual([]);
  });
});
