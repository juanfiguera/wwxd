import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
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

// ─── Mocks ────────────────────────────────────────────────────────────────
// Must be declared before the engine module is imported. vi.mock is hoisted.

const mockStreamText = vi.fn();
const mockGenerateText = vi.fn();
const mockEmbedQuery = vi.fn();
const mockClassifyRisk = vi.fn();

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    streamText: (...args: unknown[]) => mockStreamText(...args),
    generateText: (...args: unknown[]) => mockGenerateText(...args),
  };
});

vi.mock('../retrieve', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../retrieve')>();
  return {
    ...actual,
    embedQuery: (...args: unknown[]) => mockEmbedQuery(...args),
  };
});

vi.mock('../risk-classifier', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../risk-classifier')>();
  return {
    ...actual,
    classifyRisk: (...args: unknown[]) => mockClassifyRisk(...args),
  };
});

// Imported AFTER vi.mock declarations.
import {
  createRoundtable,
  getDb,
  getOrCreateSolo,
  loadEvents,
} from '../db';
import { invalidate } from '../persona-cache';
import {
  clearQueryEmbedCache,
  queryEmbedCacheSize,
  runTurn,
  type HistoryMessage,
  type Speaker,
  type TurnStreamPart,
} from '../turn-engine';

// ─── Helpers ──────────────────────────────────────────────────────────────

let tmpDir = '';
let originalDataDir: string | undefined;
let originalEmbeddingApiKey: string | undefined;
let originalDbPath: string | undefined;

function corpusFixture(username: string, mode: 'grounded' | 'prior-only' = 'grounded') {
  return {
    username,
    displayName: username[0].toUpperCase() + username.slice(1),
    fetchedAt: '2026-01-01T00:00:00.000Z',
    mode,
    tweets: Array.from({ length: 4 }, (_, i) => ({
      id: `${username}-tweet-${i}`,
      url: `https://x.com/${username}/status/${i}`,
      text: `representative thought ${i} from ${username}`,
      createdAt: '2026-01-01T00:00:00.000Z',
      likes: 0,
      retweets: 0,
      replies: 0,
      views: 0,
      isReply: false,
      isRetweet: false,
      isQuote: false,
    })),
  };
}

async function writeCorpus(username: string, mode: 'grounded' | 'prior-only' = 'grounded'): Promise<void> {
  await writeFile(
    resolve(tmpDir, `${username}.json`),
    JSON.stringify(corpusFixture(username, mode)),
    'utf8',
  );
}

function fakeTextStream(chunks: string[]): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
}

function fakeErrorStream(message: string): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      throw new Error(message);
    },
  };
}

async function drainStream(stream: ReadableStream<TurnStreamPart>): Promise<TurnStreamPart[]> {
  const parts: TurnStreamPart[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value !== undefined) parts.push(value);
  }
  return parts;
}

const SPEAKERS: Speaker[] = [
  { username: 'paulg', displayName: 'Paul Graham' },
  { username: 'naval', displayName: 'Naval Ravikant' },
  { username: 'sama', displayName: 'Sam Altman' },
];

// ─── Setup / teardown ─────────────────────────────────────────────────────

beforeAll(async () => {
  tmpDir = await mkdtemp(resolve(tmpdir(), 'wwxd-engine-'));
  originalDataDir = process.env.WWXD_DATA_DIR;
  originalEmbeddingApiKey = process.env.OPENAI_API_KEY;
  originalDbPath = process.env.WWXD_DB_PATH;
  process.env.WWXD_DATA_DIR = tmpDir;
  process.env.WWXD_DB_PATH = resolve(tmpDir, 'wwxd.db');
  // Force embeddings OFF for most tests; turned ON inline where needed.
  delete process.env.OPENAI_API_KEY;
  delete process.env.EMBEDDING_API_KEY;
  delete process.env.LLM_API_KEY;
  delete process.env.EMBEDDING_BASE_URL;
  delete process.env.LLM_BASE_URL;
});

afterAll(async () => {
  if (originalDataDir === undefined) delete process.env.WWXD_DATA_DIR;
  else process.env.WWXD_DATA_DIR = originalDataDir;
  if (originalEmbeddingApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalEmbeddingApiKey;
  if (originalDbPath === undefined) delete process.env.WWXD_DB_PATH;
  else process.env.WWXD_DB_PATH = originalDbPath;
  await rm(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  invalidate();
  clearQueryEmbedCache();
  mockStreamText.mockReset();
  mockGenerateText.mockReset();
  mockEmbedQuery.mockReset();
  mockClassifyRisk.mockReset();
  // Default LLM behaviour: streams two short chunks, no upstream error.
  mockStreamText.mockReturnValue({ textStream: fakeTextStream(['Hello ', 'world.']) });
  // Default classifier: no risk.
  mockClassifyRisk.mockResolvedValue(null);
});

afterEach(() => {
  invalidate();
  clearQueryEmbedCache();
});

// ─── Tests ────────────────────────────────────────────────────────────────

describe('runTurn — solo', () => {
  it('streams text parts and never runs the gate', async () => {
    await writeCorpus('paulg');
    const history: HistoryMessage[] = [{ role: 'user', text: 'How should I think about hiring?' }];
    const result = await runTurn({
      speaker: 'paulg',
      speakers: [{ username: 'paulg', displayName: 'Paul Graham' }],
      history,
      mode: 'solo',
    });
    const parts = await drainStream(result.stream);
    expect(parts).toEqual([
      { type: 'text', value: 'Hello ' },
      { type: 'text', value: 'world.' },
    ]);
    expect(mockGenerateText).not.toHaveBeenCalled();
    expect(mockStreamText).toHaveBeenCalledOnce();
    // System prompt should be the corpus's static prompt (no roundtable addendum).
    const args = mockStreamText.mock.calls[0][0];
    expect(args.system).not.toContain('ROUNDTABLE MODE');
  });

  it('runs the risk classifier in solo when there is a query', async () => {
    await writeCorpus('paulg');
    await runTurn({
      speaker: 'paulg',
      speakers: [{ username: 'paulg', displayName: 'Paul Graham' }],
      history: [{ role: 'user', text: 'Should I take this medication?' }],
      mode: 'solo',
    });
    expect(mockClassifyRisk).toHaveBeenCalledWith('Should I take this medication?');
  });

  it('skips the retrieval block for prior-only personas', async () => {
    await writeCorpus('marcus-aurelius', 'prior-only');
    await runTurn({
      speaker: 'marcus-aurelius',
      speakers: [{ username: 'marcus-aurelius', displayName: 'Marcus Aurelius' }],
      history: [{ role: 'user', text: 'How do I act with virtue today?' }],
      mode: 'solo',
    });
    const args = mockStreamText.mock.calls[0][0];
    const lastUserMessage = args.messages[args.messages.length - 1];
    const concatenated = Array.isArray(lastUserMessage.content)
      ? lastUserMessage.content.map((p: { text: string }) => p.text).join('')
      : lastUserMessage.content;
    expect(concatenated).not.toContain('Retrieved tweets');
  });
});

describe('runTurn — roundtable', () => {
  it('first speaker skips the gate and streams', async () => {
    await writeCorpus('paulg');
    const result = await runTurn({
      speaker: 'paulg',
      speakers: SPEAKERS,
      history: [{ role: 'user', text: 'What matters most in early-stage startups?' }],
      mode: 'roundtable',
    });
    const parts = await drainStream(result.stream);
    expect(parts.some((p) => p.type === 'text')).toBe(true);
    expect(mockGenerateText).not.toHaveBeenCalled();
    // Roundtable addendum lands in the prelude (last user message), not system.
    const args = mockStreamText.mock.calls[0][0];
    expect(args.system).not.toContain('ROUNDTABLE MODE');
    const lastUser = args.messages[args.messages.length - 1];
    const concatenated = Array.isArray(lastUser.content)
      ? lastUser.content.map((p: { text: string }) => p.text).join('')
      : lastUser.content;
    expect(concatenated).toContain('ROUNDTABLE MODE');
  });

  it('later speaker with a YES gate decision streams', async () => {
    await writeCorpus('naval');
    mockGenerateText.mockResolvedValue({ text: 'YES — I have a sharp take to add.' });
    const result = await runTurn({
      speaker: 'naval',
      speakers: SPEAKERS,
      history: [
        { role: 'user', text: 'What matters most?' },
        { role: 'assistant', speaker: 'paulg', text: 'Talk to users.' },
      ],
      mode: 'roundtable',
    });
    const parts = await drainStream(result.stream);
    expect(mockGenerateText).toHaveBeenCalledOnce();
    expect(parts.some((p) => p.type === 'text')).toBe(true);
    expect(parts.find((p) => p.type === 'gate-passed')).toBeUndefined();
  });

  it('later speaker with a NO gate decision emits only gate-passed', async () => {
    await writeCorpus('naval');
    mockGenerateText.mockResolvedValue({ text: 'NO: Paul already covered it.' });
    const result = await runTurn({
      speaker: 'naval',
      speakers: SPEAKERS,
      history: [
        { role: 'user', text: 'What matters most?' },
        { role: 'assistant', speaker: 'paulg', text: 'Talk to users.' },
      ],
      mode: 'roundtable',
    });
    const parts = await drainStream(result.stream);
    expect(mockStreamText).not.toHaveBeenCalled();
    expect(parts).toEqual([
      { type: 'gate-passed', reason: 'Paul already covered it.' },
    ]);
  });

  it('runs the risk classifier only for the first speaker each turn', async () => {
    await writeCorpus('paulg');
    await writeCorpus('naval');

    // First speaker: classifier runs.
    await runTurn({
      speaker: 'paulg',
      speakers: SPEAKERS,
      history: [{ role: 'user', text: 'Should I quit my job?' }],
      mode: 'roundtable',
    });
    expect(mockClassifyRisk).toHaveBeenCalledTimes(1);

    // Later speaker with gate YES: classifier should NOT run again.
    mockGenerateText.mockResolvedValue({ text: 'YES — adding a take.' });
    await runTurn({
      speaker: 'naval',
      speakers: SPEAKERS,
      history: [
        { role: 'user', text: 'Should I quit my job?' },
        { role: 'assistant', speaker: 'paulg', text: 'Depends on your runway.' },
      ],
      mode: 'roundtable',
    });
    expect(mockClassifyRisk).toHaveBeenCalledTimes(1);
  });
});

describe('runTurn — stream errors', () => {
  it('emits a typed error part when the LLM stream throws mid-flight', async () => {
    await writeCorpus('paulg');
    mockStreamText.mockReturnValue({
      textStream: fakeErrorStream('Your credit balance is too low.'),
    });
    const result = await runTurn({
      speaker: 'paulg',
      speakers: [{ username: 'paulg', displayName: 'Paul Graham' }],
      history: [{ role: 'user', text: 'Hi.' }],
      mode: 'solo',
    });
    const parts = await drainStream(result.stream);
    expect(parts).toContainEqual({
      type: 'error',
      message: 'Your credit balance is too low.',
      code: 'upstream',
    });
  });
});

describe('runTurn — query embedding cache', () => {
  beforeEach(async () => {
    // Turn ON embeddings for these tests only.
    process.env.OPENAI_API_KEY = 'sk-fake';
    mockEmbedQuery.mockResolvedValue(new Float32Array([0.1, 0.2, 0.3]));
    // Write a minimal embeddings file for each persona so tryLoadEmbeddings
    // returns non-null and the engine reaches embedQueryCached.
    for (const slug of ['paulg', 'naval', 'sama']) {
      await writeCorpus(slug);
      await writeFile(
        resolve(tmpDir, `${slug}.embeddings.json`),
        JSON.stringify({
          model: 'text-embedding-3-small',
          dimensions: 3,
          createdAt: '2026-01-01T00:00:00.000Z',
          items: [{ id: `${slug}-tweet-0`, embedding: [0.1, 0.2, 0.3] }],
        }),
        'utf8',
      );
    }
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it('embeds the user query once across multiple personas asking the same question', async () => {
    const history: HistoryMessage[] = [{ role: 'user', text: 'How do I know if I am working on the wrong thing?' }];
    for (const speaker of ['paulg', 'naval', 'sama']) {
      const result = await runTurn({
        speaker,
        speakers: SPEAKERS,
        history,
        mode: 'roundtable',
      });
      await drainStream(result.stream);
    }
    expect(mockEmbedQuery).toHaveBeenCalledTimes(1);
    expect(queryEmbedCacheSize()).toBe(1);
  });

  it('embeds again for a different query', async () => {
    await runTurn({
      speaker: 'paulg',
      speakers: SPEAKERS,
      history: [{ role: 'user', text: 'First question?' }],
      mode: 'roundtable',
    }).then((r) => drainStream(r.stream));
    await runTurn({
      speaker: 'paulg',
      speakers: SPEAKERS,
      history: [{ role: 'user', text: 'Second question?' }],
      mode: 'roundtable',
    }).then((r) => drainStream(r.stream));
    expect(mockEmbedQuery).toHaveBeenCalledTimes(2);
    expect(queryEmbedCacheSize()).toBe(2);
  });

  it('clearQueryEmbedCache empties the cache', async () => {
    await runTurn({
      speaker: 'paulg',
      speakers: SPEAKERS,
      history: [{ role: 'user', text: 'Hello?' }],
      mode: 'roundtable',
    }).then((r) => drainStream(r.stream));
    expect(queryEmbedCacheSize()).toBe(1);
    clearQueryEmbedCache();
    expect(queryEmbedCacheSize()).toBe(0);
  });
});

describe('runTurn — event log', () => {
  beforeEach(() => {
    // Solo conversations are 1:1 with personas, so repeated tests against
    // the same persona share a conversation. Wipe events between tests so
    // assertions see only their own.
    getDb().exec('DELETE FROM conversation_events');
  });

  it('writes no events when conversationId or ordinal is missing', async () => {
    await writeCorpus('paulg');
    const conv = getOrCreateSolo('paulg');
    // Run with NO tracing fields.
    await runTurn({
      speaker: 'paulg',
      speakers: [{ username: 'paulg', displayName: 'Paul Graham' }],
      history: [{ role: 'user', text: 'hi' }],
      mode: 'solo',
    }).then((r) => drainStream(r.stream));
    expect(loadEvents(conv.id)).toEqual([]);
  });

  it('emits the full sequence for a successful solo turn', async () => {
    await writeCorpus('paulg');
    const conv = getOrCreateSolo('paulg');
    const result = await runTurn({
      speaker: 'paulg',
      speakers: [{ username: 'paulg', displayName: 'Paul Graham' }],
      history: [{ role: 'user', text: 'How do I think about hiring?' }],
      mode: 'solo',
      conversationId: conv.id,
      ordinal: 1,
    });
    await drainStream(result.stream);

    const events = loadEvents(conv.id);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toEqual([
      'persona.started',
      'retrieval',
      'risk.classified',
      'persona.completed',
    ]);
    expect(events.every((e) => e.speaker === 'paulg')).toBe(true);
    expect(events.every((e) => e.ordinal === 1)).toBe(true);

    // Payloads carry useful diagnostic detail.
    const retrieval = events.find((e) => e.kind === 'retrieval')?.payload as {
      hits: number;
      query: string;
    };
    expect(retrieval.query).toBe('How do I think about hiring?');
    expect(typeof retrieval.hits).toBe('number');
    const completed = events.find((e) => e.kind === 'persona.completed')?.payload as {
      chars: number;
    };
    expect(completed.chars).toBe('Hello world.'.length);
  });

  it('emits gate.passed when the gate says NO and no persona.completed', async () => {
    await writeCorpus('naval');
    const conv = createRoundtable(['paulg', 'naval']);
    mockGenerateText.mockResolvedValue({ text: 'NO: paul covered it.' });
    const result = await runTurn({
      speaker: 'naval',
      speakers: SPEAKERS,
      history: [
        { role: 'user', text: 'What matters most?' },
        { role: 'assistant', speaker: 'paulg', text: 'Talk to users.' },
      ],
      mode: 'roundtable',
      conversationId: conv.id,
      ordinal: 3,
    });
    await drainStream(result.stream);

    const events = loadEvents(conv.id);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('gate.passed');
    expect(kinds).not.toContain('gate.spoke');
    expect(kinds).not.toContain('persona.completed');
    const gate = events.find((e) => e.kind === 'gate.passed')?.payload as { reason: string };
    expect(gate.reason).toBe('paul covered it.');
  });

  it('emits gate.spoke + persona.completed when the gate says YES', async () => {
    await writeCorpus('naval');
    const conv = createRoundtable(['paulg', 'naval']);
    mockGenerateText.mockResolvedValue({ text: 'YES — adding a take.' });
    const result = await runTurn({
      speaker: 'naval',
      speakers: SPEAKERS,
      history: [
        { role: 'user', text: 'What matters most?' },
        { role: 'assistant', speaker: 'paulg', text: 'Talk to users.' },
      ],
      mode: 'roundtable',
      conversationId: conv.id,
      ordinal: 3,
    });
    await drainStream(result.stream);

    const kinds = loadEvents(conv.id).map((e) => e.kind);
    expect(kinds).toContain('gate.spoke');
    expect(kinds).toContain('persona.completed');
    expect(kinds).not.toContain('gate.passed');
  });

  it('emits persona.errored with the provider message when the stream throws', async () => {
    await writeCorpus('paulg');
    const conv = getOrCreateSolo('paulg');
    mockStreamText.mockReturnValue({
      textStream: fakeErrorStream('Your credit balance is too low.'),
    });
    const result = await runTurn({
      speaker: 'paulg',
      speakers: [{ username: 'paulg', displayName: 'Paul Graham' }],
      history: [{ role: 'user', text: 'hi' }],
      mode: 'solo',
      conversationId: conv.id,
      ordinal: 1,
    });
    await drainStream(result.stream);

    const errored = loadEvents(conv.id).find((e) => e.kind === 'persona.errored');
    expect(errored).toBeDefined();
    const payload = errored?.payload as { message: string; code: string };
    expect(payload.message).toBe('Your credit balance is too low.');
    expect(payload.code).toBe('upstream');
  });

  it('skips risk.classified when there is no user query', async () => {
    await writeCorpus('paulg');
    const conv = getOrCreateSolo('paulg');
    await runTurn({
      speaker: 'paulg',
      speakers: [{ username: 'paulg', displayName: 'Paul Graham' }],
      history: [],
      mode: 'solo',
      conversationId: conv.id,
      ordinal: 0,
    }).then((r) => drainStream(r.stream));

    const kinds = loadEvents(conv.id).map((e) => e.kind);
    expect(kinds).not.toContain('risk.classified');
  });
});
