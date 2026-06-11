import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the AI SDK so we don't hit a real model.
vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return {
    ...actual,
    streamText: vi.fn(() => ({
      toUIMessageStreamResponse: () => new Response('streamed', { status: 200 }),
    })),
    generateText: vi.fn(async () => ({ text: 'none' })),
    embed: vi.fn(async () => ({ embedding: [0, 0, 0, 0] })),
  };
});

vi.mock('@/lib/llm', () => ({
  modelFor: vi.fn(() => 'mocked-model'),
  cacheableProviderOptions: vi.fn(() => undefined),
  embeddingModel: vi.fn(() => 'mock-embedder'),
  embeddingProviderOptions: vi.fn(() => undefined),
}));

import { POST } from '../[username]/route';

const tmp = mkdtempSync(join(tmpdir(), 'wwxd-chat-route-'));
const originalCwd = process.cwd();

beforeAll(async () => {
  process.chdir(tmp);
  await mkdir(resolve(tmp, 'data'), { recursive: true });
});
afterAll(() => {
  process.chdir(originalCwd);
  rmSync(tmp, { recursive: true, force: true });
});
beforeEach(() => {
  vi.clearAllMocks();
});

async function writeCorpus(username: string, tweets: number = 0) {
  const items = Array.from({ length: tweets }, (_, i) => ({
    id: `t${i}`,
    url: '',
    text: `tweet ${i}`,
    createdAt: '',
    likes: 0,
    retweets: 0,
    replies: 0,
    views: 0,
    isReply: false,
    isRetweet: false,
    isQuote: false,
  }));
  await writeFile(
    resolve(tmp, 'data', `${username}.json`),
    JSON.stringify({ username, displayName: username, fetchedAt: '', tweets: items }),
  );
}

async function paramOf(username: string) {
  return Promise.resolve({ username });
}

function chatRequest(body: unknown): Request {
  return new Request('http://test.local/api/chat/x', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/chat/[username]', () => {
  it('returns 500 when the persona corpus is missing', async () => {
    const res = await POST(chatRequest({ messages: [] }), { params: paramOf('not-here') });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Could not load tweets for @not-here/);
    expect(body.error).toMatch(/fetch-tweets not-here/);
  });

  it('returns a streamed response for a valid persona + message', async () => {
    await writeCorpus('alice', 3);
    const res = await POST(
      chatRequest({
        messages: [
          {
            id: 'u1',
            role: 'user',
            parts: [{ type: 'text', text: 'what do you think?' }],
          },
        ],
      }),
      { params: paramOf('alice') },
    );
    expect(res.status).toBe(200);
    const { streamText } = await import('ai');
    expect(vi.mocked(streamText)).toHaveBeenCalledOnce();
    const call = vi.mocked(streamText).mock.calls[0][0];
    expect(call.model).toBe('mocked-model');
  });

  it('runs the risk classifier in parallel with retrieval', async () => {
    await writeCorpus('bob', 5);
    const { generateText } = await import('ai');
    await POST(
      chatRequest({
        messages: [
          {
            id: 'u1',
            role: 'user',
            parts: [
              { type: 'text', text: 'Should I put my retirement savings into this?' },
            ],
          },
        ],
      }),
      { params: paramOf('bob') },
    );
    expect(vi.mocked(generateText)).toHaveBeenCalled();
  });

  it('handles an empty message list (no query → no retrieval, no classifier)', async () => {
    await writeCorpus('carol', 0);
    const res = await POST(chatRequest({ messages: [] }), { params: paramOf('carol') });
    expect(res.status).toBe(200);
    const { embed, generateText } = await import('ai');
    expect(vi.mocked(embed)).not.toHaveBeenCalled();
    expect(vi.mocked(generateText)).not.toHaveBeenCalled();
  });
});
