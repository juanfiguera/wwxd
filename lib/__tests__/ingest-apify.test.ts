import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

// Mock the Apify client. Each test sets up scripted return values per-window.
// vi.hoisted is used so the mock factory (hoisted to top of file by vitest)
// can reference these mocks safely.
const { actorCall, datasetList } = vi.hoisted(() => ({
  actorCall: vi.fn(),
  datasetList: vi.fn(),
}));
vi.mock('apify-client', () => ({
  // Must be `new`-callable. Use a class.
  ApifyClient: class {
    actor() {
      return { call: actorCall };
    }
    dataset() {
      return { listItems: datasetList };
    }
  },
}));

import { apifyIngester } from '../ingest/apify';
import { loadCorpus } from '../persona';

const tmp = mkdtempSync(join(tmpdir(), 'wwxd-apify-'));
const originalCwd = process.cwd();

beforeAll(() => {
  process.env.APIFY_TOKEN = 'test-token';
  process.chdir(tmp);
});
afterAll(() => {
  process.chdir(originalCwd);
  delete process.env.APIFY_TOKEN;
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  actorCall.mockReset();
  datasetList.mockReset();
});
afterEach(() => vi.clearAllMocks());

function mockBatch(items: Array<Record<string, unknown>>) {
  actorCall.mockResolvedValueOnce({ defaultDatasetId: 'ds1' });
  datasetList.mockResolvedValueOnce({ items });
}

describe('apifyIngester', () => {
  it('throws when APIFY_TOKEN is unset', async () => {
    const saved = process.env.APIFY_TOKEN;
    delete process.env.APIFY_TOKEN;
    await expect(apifyIngester('x', {}, () => {})).rejects.toThrow(/APIFY_TOKEN/);
    process.env.APIFY_TOKEN = saved;
  });

  it('latest mode: fetches one window and saves normalized tweets', async () => {
    mockBatch([
      {
        id: '100',
        text: 'hello world',
        createdAt: '2025-06-01T00:00:00Z',
        likeCount: 42,
        author: { name: 'Test User' },
      },
      {
        id: '101',
        fullText: 'second tweet',
        createdAt: '2025-06-02T00:00:00Z',
        isReply: true,
      },
    ]);
    const events: string[] = [];
    const result = await apifyIngester('alice', {}, (e) => events.push(e.type));
    expect(result.total).toBe(2);
    expect(result.originals).toBe(1); // tweet 101 is a reply
    expect(result.displayName).toBe('Test User');
    expect(events).toContain('start');
    expect(events).toContain('saved');

    const corpus = await loadCorpus('alice');
    expect(corpus.tweets.find((t) => t.id === '101')?.text).toBe('second tweet');
    expect(corpus.tweets.find((t) => t.id === '100')?.likes).toBe(42);
  });

  it('deep mode: walks windows backward and stops after empty streaks', async () => {
    // Window 1 returns one tweet, then 3 empty windows trigger stop.
    mockBatch([
      { id: '200', text: 'first', createdAt: '2025-01-01T00:00:00Z' },
    ]);
    mockBatch([]);
    mockBatch([]);
    mockBatch([]);

    const events: string[] = [];
    const result = await apifyIngester(
      'bob',
      { deep: true, earliestYear: 2000, emptyWindowLimit: 3, windowMonths: 6 },
      (e) => events.push(e.type),
    );
    expect(result.total).toBe(1);
    expect(actorCall).toHaveBeenCalledTimes(4); // 1 with data + 3 empty
    expect(events.filter((t) => t === 'window').length).toBeGreaterThanOrEqual(4);
    expect(events).toContain('saved');
  });

  it('reports a window-error event if a single window throws but keeps going', async () => {
    actorCall.mockRejectedValueOnce(new Error('Apify hiccup'));
    mockBatch([{ id: '300', text: 'after recovery', createdAt: '2025-06-01T00:00:00Z' }]);
    mockBatch([]);
    mockBatch([]);
    mockBatch([]);

    const events: { type: string; message?: string }[] = [];
    const result = await apifyIngester(
      'carol',
      { deep: true, earliestYear: 2000, emptyWindowLimit: 3, windowMonths: 6 },
      (e) => events.push(e as { type: string; message?: string }),
    );
    expect(result.total).toBe(1);
    expect(events.some((e) => e.type === 'window-error' && /hiccup/i.test(e.message ?? ''))).toBe(
      true,
    );
  });

  it('merges with an existing corpus on subsequent runs', async () => {
    mockBatch([{ id: '400', text: 'first run', createdAt: '2025-01-01T00:00:00Z' }]);
    await apifyIngester('dana', {}, () => {});

    mockBatch([
      { id: '400', text: 'updated text', createdAt: '2025-01-01T00:00:00Z' },
      { id: '401', text: 'new', createdAt: '2025-02-01T00:00:00Z' },
    ]);
    const second = await apifyIngester('dana', {}, () => {});
    expect(second.total).toBe(2);
    const corpus = await loadCorpus('dana');
    expect(corpus.tweets.find((t) => t.id === '400')?.text).toBe('updated text');
  });

  it('drops malformed tweets that fail the zod schema (missing id/text)', async () => {
    mockBatch([
      { id: '500', text: 'good one', createdAt: '2025-06-01' },
      { id: '', text: 'no id' },
      { unknownField: 'totally garbage' },
    ]);
    const result = await apifyIngester('eve', {}, () => {});
    expect(result.total).toBe(1);
  });
});
