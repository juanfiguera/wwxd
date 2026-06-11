import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return {
    ...actual,
    embedMany: vi.fn(async ({ values }: { values: string[] }) => ({
      embeddings: values.map((_, i) => Array(4).fill(0).map((_, j) => i + j * 0.01)),
    })),
  };
});
vi.mock('../llm', () => ({
  embeddingModel: vi.fn(() => 'mock-embedder'),
  embeddingModelId: vi.fn(() => 'mxbai-embed-test'),
  embeddingDimensions: vi.fn(() => 4),
  embeddingProviderOptions: vi.fn(() => undefined),
}));

import { embedTweets } from '../embed';

const tmp = mkdtempSync(join(tmpdir(), 'wwxd-embed-'));
const originalCwd = process.cwd();

beforeAll(() => process.chdir(tmp));
afterAll(() => {
  process.chdir(originalCwd);
  rmSync(tmp, { recursive: true, force: true });
});
afterEach(() => vi.clearAllMocks());

async function writeCorpus(username: string, tweets: { id: string; text: string }[]) {
  const path = resolve(tmp, 'data', `${username}.json`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({
      username,
      displayName: username,
      fetchedAt: new Date().toISOString(),
      tweets: tweets.map((t) => ({
        ...t,
        url: '',
        createdAt: '',
        likes: 0,
        retweets: 0,
        replies: 0,
        views: 0,
        isReply: false,
        isRetweet: false,
        isQuote: false,
      })),
    }),
  );
}

describe('embedTweets', () => {
  it('writes embeddings file with one entry per non-empty tweet', async () => {
    await writeCorpus('e1', [
      { id: 't1', text: 'hello' },
      { id: 't2', text: 'world' },
      { id: 't3', text: '' }, // skipped — empty text
    ]);
    const result = await embedTweets('e1', {}, () => {});
    expect(result.total).toBe(2);
    const path = resolve(tmp, 'data', 'e1.embeddings.json');
    const file = JSON.parse(await readFile(path, 'utf8'));
    expect(file.items).toHaveLength(2);
    expect(file.dimensions).toBe(4);
    expect(file.model).toBe('mxbai-embed-test');
    expect(file.items[0]).toHaveProperty('id', 't1');
    expect(file.items[0]).toHaveProperty('embedding');
  });

  it('batches in chunks of 200', async () => {
    const tweets = Array.from({ length: 450 }, (_, i) => ({
      id: `t${i}`,
      text: `tweet ${i}`,
    }));
    await writeCorpus('e2', tweets);
    const events: string[] = [];
    await embedTweets('e2', {}, (e) => events.push(e.type));
    const { embedMany } = await import('ai');
    expect(vi.mocked(embedMany)).toHaveBeenCalledTimes(3); // 200 + 200 + 50
    // Start + 3 batches + saved = 5 progress events
    expect(events.filter((t) => t === 'batch')).toHaveLength(3);
    expect(events).toContain('start');
    expect(events).toContain('saved');
  });

  it('honors model + dimensions option overrides', async () => {
    await writeCorpus('e3', [{ id: 'x', text: 'hi' }]);
    const result = await embedTweets(
      'e3',
      { model: 'custom-embed', dimensions: 8 },
      () => {},
    );
    expect(result.total).toBe(1);
    const file = JSON.parse(
      await readFile(resolve(tmp, 'data', 'e3.embeddings.json'), 'utf8'),
    );
    expect(file.model).toBe('custom-embed');
    expect(file.dimensions).toBe(8);
  });
});
