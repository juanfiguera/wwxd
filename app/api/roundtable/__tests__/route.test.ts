import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { streamTextMock, generateTextMock, embedMock } = vi.hoisted(() => ({
  streamTextMock: vi.fn(),
  generateTextMock: vi.fn(),
  embedMock: vi.fn(),
}));
vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return {
    ...actual,
    streamText: streamTextMock,
    generateText: generateTextMock,
    embed: embedMock,
  };
});

vi.mock('@/lib/llm', () => ({
  modelFor: vi.fn(() => 'mocked-model'),
  cacheableProviderOptions: vi.fn(() => undefined),
  embeddingModel: vi.fn(() => 'mock-embedder'),
  embeddingProviderOptions: vi.fn(() => undefined),
}));

import { POST } from '../route';

const tmp = mkdtempSync(join(tmpdir(), 'wwxd-rt-route-'));
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
  streamTextMock.mockReset();
  streamTextMock.mockReturnValue({
    toTextStreamResponse: ({ headers }: { headers?: HeadersInit } = {}) =>
      new Response('streamed', { status: 200, headers }),
  });
  generateTextMock.mockReset();
  generateTextMock.mockResolvedValue({ text: 'YES — speak' });
  embedMock.mockReset();
  embedMock.mockResolvedValue({ embedding: [0, 0, 0, 0] });
});

async function writeCorpus(username: string, tweets: number = 0) {
  const items = Array.from({ length: tweets }, (_, i) => ({
    id: `${username}-t${i}`,
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

function postReq(body: unknown): Request {
  return new Request('http://test.local/api/roundtable', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const baseHistory = [
  { role: 'user' as const, text: 'what should I do?' },
];

describe('POST /api/roundtable', () => {
  it('returns 400 for missing required fields', async () => {
    const res = await POST(postReq({ speaker: 'paulg' }));
    expect(res.status).toBe(400);
  });

  it('returns 500 when the persona corpus is missing', async () => {
    const res = await POST(
      postReq({
        speaker: 'nobody',
        speakers: [
          { username: 'nobody', displayName: 'Nobody' },
          { username: 'someone', displayName: 'Someone' },
        ],
        history: baseHistory,
      }),
    );
    expect(res.status).toBe(500);
  });

  it('returns a streamed text response for the first speaker (no gate)', async () => {
    await writeCorpus('paulg', 3);
    await writeCorpus('sama', 3);
    const res = await POST(
      postReq({
        speaker: 'paulg',
        speakers: [
          { username: 'paulg', displayName: 'Paul Graham' },
          { username: 'sama', displayName: 'Sam Altman' },
        ],
        history: baseHistory,
      }),
    );
    expect(res.status).toBe(200);
    expect(streamTextMock).toHaveBeenCalledOnce();
    // The first speaker runs the risk classifier but bypasses the gate.
    expect(generateTextMock).toHaveBeenCalledTimes(1);
  });

  it('runs the gate for non-first speakers and returns JSON "passed" when gate says NO', async () => {
    await writeCorpus('paulg', 3);
    await writeCorpus('sama', 3);
    // Non-first speakers SKIP risk classification, so the only generateText
    // call is the gate.
    const history = [
      ...baseHistory,
      {
        role: 'assistant' as const,
        text: "I'll start. I think you should ship faster.",
        speaker: 'paulg',
      },
    ];
    generateTextMock.mockResolvedValueOnce({ text: 'NO — no real take' });

    const res = await POST(
      postReq({
        speaker: 'sama',
        speakers: [
          { username: 'paulg', displayName: 'Paul Graham' },
          { username: 'sama', displayName: 'Sam Altman' },
        ],
        history,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { passed: boolean; speaker: string };
    expect(body.passed).toBe(true);
    expect(body.speaker).toBe('sama');
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it('proceeds to streaming when the gate says YES', async () => {
    await writeCorpus('paulg', 3);
    await writeCorpus('sama', 3);
    const history = [
      ...baseHistory,
      {
        role: 'assistant' as const,
        text: "I'll start. Make something people want.",
        speaker: 'paulg',
      },
    ];
    generateTextMock.mockResolvedValueOnce({ text: 'YES — speak' });

    const res = await POST(
      postReq({
        speaker: 'sama',
        speakers: [
          { username: 'paulg', displayName: 'Paul Graham' },
          { username: 'sama', displayName: 'Sam Altman' },
        ],
        history,
      }),
    );
    expect(res.status).toBe(200);
    expect(streamTextMock).toHaveBeenCalledOnce();
  });
});
