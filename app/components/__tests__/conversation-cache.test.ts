import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  conversationFetcher,
  conversationMessagesUrl,
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

describe('SWR keys', () => {
  it('soloKey returns the solo virtual key for a persona', () => {
    expect(soloKey('paulg')).toBe('solo:paulg');
  });

  it('roundtableKey returns the roundtable key for a UUID', () => {
    expect(roundtableKey('abc-123')).toBe('roundtable:abc-123');
  });

  it('conversationMessagesUrl encodes the UUID', () => {
    expect(conversationMessagesUrl('abc 123')).toBe('/api/conversations/abc%20123');
  });
});

describe('conversationFetcher', () => {
  it('solo: POSTs to create-or-find then GETs the conversation', async () => {
    const mocked = vi.mocked(globalThis.fetch);
    // First call: POST /api/conversations → conversation
    mocked.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          conversation: {
            id: 'uuid-1',
            kind: 'solo',
            title: null,
            createdAt: '',
            updatedAt: '',
          },
        }),
        { status: 200 },
      ),
    );
    // Second call: GET /api/conversations/uuid-1 → payload
    mocked.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          conversation: {
            id: 'uuid-1',
            kind: 'solo',
            title: null,
            createdAt: '',
            updatedAt: '',
          },
          participants: ['paulg'],
          messages: [{ id: 'm1', role: 'user', speaker: null, text: 'hi', metadata: null }],
        }),
        { status: 200 },
      ),
    );

    const result = await conversationFetcher('solo:paulg');
    expect(result.conversation.id).toBe('uuid-1');
    expect(result.participants).toEqual(['paulg']);
    expect(result.messages).toHaveLength(1);

    // Sanity: first call POSTed with the solo + persona body
    expect(mocked.mock.calls[0][0]).toBe('/api/conversations');
    const init = mocked.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toContain('"kind":"solo"');
    expect(init.body).toContain('"persona":"paulg"');
  });

  it('roundtable: GETs the conversation by UUID', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          conversation: {
            id: 'rt-1',
            kind: 'roundtable',
            title: null,
            createdAt: '',
            updatedAt: '',
          },
          participants: ['paulg', 'sama'],
          messages: [],
        }),
        { status: 200 },
      ),
    );
    const result = await conversationFetcher('roundtable:rt-1');
    expect(result.conversation.id).toBe('rt-1');
    expect(result.participants).toEqual(['paulg', 'sama']);
  });

  it('throws on an unknown key prefix', async () => {
    await expect(conversationFetcher('weird:thing')).rejects.toThrow(/Unknown/);
  });
});
