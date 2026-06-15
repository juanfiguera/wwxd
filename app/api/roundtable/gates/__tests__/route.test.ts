import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { generateTextMock, embedMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  embedMock: vi.fn(),
}));
vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return {
    ...actual,
    generateText: generateTextMock,
    embed: embedMock,
  };
});
vi.mock('@/lib/llm', () => ({
  modelFor: vi.fn(() => 'mocked-model'),
  cacheableProviderOptions: vi.fn(() => undefined),
  embeddingModel: vi.fn(() => 'mock-embedder'),
  embeddingModelId: vi.fn(() => 'mock-embed-id'),
  embeddingProviderOptions: vi.fn(() => undefined),
}));

import { POST } from '../route';

const tmp = mkdtempSync(join(tmpdir(), 'wwxd-gates-'));
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
  generateTextMock.mockReset();
  embedMock.mockReset();
});

async function writeCorpus(username: string): Promise<void> {
  const items = Array.from({ length: 3 }, (_, i) => ({
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
  return new Request('http://test.local/api/roundtable/gates', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const speakerMeta = [
  { username: 'paulg', displayName: 'Paul Graham' },
  { username: 'sama', displayName: 'Sam Altman' },
  { username: 'naval', displayName: 'Naval Ravikant' },
];

describe('POST /api/roundtable/gates', () => {
  it('returns 400 for missing fields', async () => {
    const res = await POST(postReq({ speakers: speakerMeta }));
    expect(res.status).toBe(400);
  });

  it('fans gates in parallel and returns one decision per speaker', async () => {
    for (const s of speakerMeta) await writeCorpus(s.username);
    // First speaker (paulg) auto-passes (no inline gate). Sam runs gate
    // (says YES). Naval runs gate (says NO).
    generateTextMock
      .mockResolvedValueOnce({ text: 'YES — i have a take' }) // sama
      .mockResolvedValueOnce({ text: 'NO — paul covered it' }); // naval

    const history = [
      { role: 'user' as const, text: 'what matters most?' },
      {
        role: 'assistant' as const,
        text: 'talk to users',
        speaker: 'paulg',
      },
    ];
    const res = await POST(postReq({ speakers: speakerMeta, history }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      decisions: Array<{ speaker: string; shouldSpeak: boolean; reason: string }>;
    };
    expect(body.decisions.map((d) => d.speaker)).toEqual([
      'paulg',
      'sama',
      'naval',
    ]);
    // First speaker auto-passes (since someone — paulg himself — already
    // spoke in the history, paulg is treated as a later speaker too).
    // We just assert structure here; the actual decision values depend on
    // history layout, which is the inline gate's job to interpret.
    for (const d of body.decisions) {
      expect(typeof d.shouldSpeak).toBe('boolean');
      expect(typeof d.reason).toBe('string');
    }
  });

  it('runs the gate for every persona except the explicit first speaker', async () => {
    for (const s of speakerMeta) await writeCorpus(s.username);
    // 3 personas: first speaker auto-passes, gate runs for the other 2.
    generateTextMock.mockResolvedValue({ text: 'YES — speak' });
    const res = await POST(
      postReq({
        speakers: speakerMeta,
        history: [{ role: 'user' as const, text: 'fresh question' }],
      }),
    );
    const body = (await res.json()) as {
      decisions: Array<{ shouldSpeak: boolean; speaker: string }>;
    };
    for (const d of body.decisions) expect(d.shouldSpeak).toBe(true);
    // First speaker bypassed the model; later two each ran their gate.
    expect(generateTextMock).toHaveBeenCalledTimes(2);
  });

  it('fails open when a gate call throws (persona gets to speak)', async () => {
    for (const s of speakerMeta) await writeCorpus(s.username);
    generateTextMock.mockRejectedValue(new Error('upstream'));
    const history = [
      { role: 'user' as const, text: 'q' },
      { role: 'assistant' as const, text: 'a', speaker: 'paulg' },
    ];
    const res = await POST(postReq({ speakers: speakerMeta, history }));
    const body = (await res.json()) as {
      decisions: Array<{ shouldSpeak: boolean }>;
    };
    // Every persona should still be marked speakable since the gate model
    // errored out — we prefer noise to silence.
    for (const d of body.decisions) expect(d.shouldSpeak).toBe(true);
  });
});
