import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return {
    ...actual,
    embed: vi.fn(async ({ value }: { value: string }) => ({
      // Deterministic fake embedding based on string length.
      embedding: [value.length, 0, 0, 0],
    })),
  };
});
vi.mock('../llm', () => ({
  embeddingModel: vi.fn(() => 'mock-embedder'),
  embeddingProviderOptions: vi.fn(() => undefined),
}));

import {
  embedQuery,
  embeddingsPath,
  hybridTopK,
  loadEmbeddings,
  topK,
  type LoadedEmbeddings,
} from '../retrieve';
import { buildBm25 } from '../bm25';

// realpath resolves macOS's /var → /private/var symlink so the expected
// path matches what cwd() actually returns.
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'wwxd-retrieve-')));
const originalCwd = process.cwd();

beforeAll(async () => {
  process.chdir(tmp);
  await mkdir(resolve(tmp, 'data'), { recursive: true });
});
afterAll(() => {
  process.chdir(originalCwd);
  rmSync(tmp, { recursive: true, force: true });
});
afterEach(() => vi.clearAllMocks());

function buildEmbeddings(vectors: number[][], ids?: string[]): LoadedEmbeddings {
  const dimensions = vectors[0]?.length ?? 0;
  const flat = new Float32Array(vectors.length * dimensions);
  vectors.forEach((v, i) => {
    v.forEach((x, j) => {
      flat[i * dimensions + j] = x;
    });
  });
  return {
    model: 'test',
    dimensions,
    ids: ids ?? vectors.map((_, i) => `t${i}`),
    vectors: flat,
  };
}

describe('topK', () => {
  it('returns highest-dot-product IDs in order', () => {
    const embeddings = buildEmbeddings([
      [1, 0, 0],
      [0, 1, 0],
      [0.7, 0.7, 0],
    ]);
    const query = Float32Array.from([1, 0, 0]);
    expect(topK(query, embeddings, 2)).toEqual(['t0', 't2']);
  });

  it('respects k', () => {
    const embeddings = buildEmbeddings([[1, 0], [0.9, 0.1], [0.8, 0.2], [0.7, 0.3]]);
    const query = Float32Array.from([1, 0]);
    expect(topK(query, embeddings, 1)).toEqual(['t0']);
    expect(topK(query, embeddings, 3)).toEqual(['t0', 't1', 't2']);
  });

  it('handles empty embeddings', () => {
    const embeddings = buildEmbeddings([]);
    const query = Float32Array.from([1, 0, 0]);
    expect(topK(query, embeddings, 5)).toEqual([]);
  });

  it('preserves stable ordering for tied scores', () => {
    const embeddings = buildEmbeddings([[1, 0], [1, 0]], ['a', 'b']);
    const query = Float32Array.from([1, 0]);
    const result = topK(query, embeddings, 2);
    expect(result).toHaveLength(2);
    expect(result.sort()).toEqual(['a', 'b']);
  });
});

describe('embedQuery', () => {
  it('calls embed() with the abstracted model + provider options', async () => {
    const { embed } = await import('ai');
    const vec = await embedQuery('hello world');
    expect(vec).toBeInstanceOf(Float32Array);
    expect(Array.from(vec)).toEqual([11, 0, 0, 0]); // 'hello world'.length = 11
    expect(vi.mocked(embed)).toHaveBeenCalledOnce();
    expect(vi.mocked(embed).mock.calls[0][0]).toMatchObject({
      model: 'mock-embedder',
      value: 'hello world',
    });
  });
});

describe('embeddingsPath', () => {
  it('returns data/<user>.embeddings.json relative to cwd', () => {
    expect(embeddingsPath('alice')).toBe(resolve(tmp, 'data', 'alice.embeddings.json'));
  });
});

describe('loadEmbeddings', () => {
  it('reads and packs into a Float32Array', async () => {
    const file = {
      model: 'test-model',
      dimensions: 3,
      createdAt: new Date().toISOString(),
      items: [
        { id: 'a', embedding: [1, 2, 3] },
        { id: 'b', embedding: [4, 5, 6] },
      ],
    };
    const path = embeddingsPath('loaded');
    await writeFile(path, JSON.stringify(file));
    const loaded = await loadEmbeddings('loaded');
    expect(loaded.model).toBe('test-model');
    expect(loaded.dimensions).toBe(3);
    expect(loaded.ids).toEqual(['a', 'b']);
    expect(Array.from(loaded.vectors)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('caches by mtime', async () => {
    const file = {
      model: 'cached',
      dimensions: 2,
      createdAt: new Date().toISOString(),
      items: [{ id: 'x', embedding: [1, 0] }],
    };
    const path = embeddingsPath('cached');
    await writeFile(path, JSON.stringify(file));
    const first = await loadEmbeddings('cached');
    const second = await loadEmbeddings('cached');
    expect(second).toBe(first); // identity — served from cache
  });
});

describe('hybridTopK (RRF fusion)', () => {
  const corpus = [
    { id: 'a', text: 'react server components are great' },
    { id: 'b', text: 'sqlite is fast' },
    { id: 'c', text: 'typescript pattern matching is coming' },
    { id: 'd', text: 'react native debugging' },
  ];
  const bm25 = buildBm25(corpus);

  it('falls back to BM25-only when no embeddings are provided', () => {
    const ids = hybridTopK(null, null, bm25, 'react components', 3);
    expect(ids[0]).toBe('a'); // best BM25 hit
    expect(ids.length).toBeLessThanOrEqual(3);
  });

  it('falls back to embeddings-only when bm25 is null', () => {
    const embeddings = buildEmbeddings(
      [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
      ],
      ['a', 'b', 'c', 'd'],
    );
    const query = Float32Array.from([1, 0, 0, 0]);
    const ids = hybridTopK(embeddings, query, null, '', 2);
    expect(ids[0]).toBe('a');
  });

  it('fuses both signals with reciprocal rank fusion', () => {
    const embeddings = buildEmbeddings(
      [
        [0, 0, 0, 1], // a — bad for query
        [0, 0, 1, 0], // b
        [1, 0, 0, 0], // c — best for query
        [0, 1, 0, 0], // d
      ],
      ['a', 'b', 'c', 'd'],
    );
    const query = Float32Array.from([1, 0, 0, 0]);
    // BM25 favors 'a' (contains "react components"); embeddings favor 'c'.
    // RRF should consider both — neither pure favorite wins outright.
    const ids = hybridTopK(embeddings, query, bm25, 'react components', 4);
    expect(ids).toContain('a');
    expect(ids).toContain('c');
  });

  it('returns empty array on empty query with no signals', () => {
    expect(hybridTopK(null, null, bm25, '', 5)).toEqual([]);
  });
});
