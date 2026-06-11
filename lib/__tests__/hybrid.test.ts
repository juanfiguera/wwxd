import { describe, it, expect } from 'vitest';
import { reciprocalRankFusion, hybridTopK, type LoadedEmbeddings } from '../retrieve';
import { buildBm25 } from '../bm25';

function buildEmbeddings(vectors: number[][], ids: string[]): LoadedEmbeddings {
  const dimensions = vectors[0]?.length ?? 0;
  const flat = new Float32Array(vectors.length * dimensions);
  vectors.forEach((v, i) => {
    v.forEach((x, j) => {
      flat[i * dimensions + j] = x;
    });
  });
  return { model: 'test', dimensions, ids, vectors: flat };
}

describe('reciprocalRankFusion', () => {
  it('combines two rankings by RRF scores', () => {
    // doc "a" is rank 0 in both rankings -> highest combined
    // doc "b" is rank 1 in both -> second
    // doc "c" is only in one -> third
    const result = reciprocalRankFusion([['a', 'b', 'c'], ['a', 'b']], 3);
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('prefers items appearing in multiple rankings even if not top in one', () => {
    // "x" is top of ranking 1 only
    // "y" is rank 2 in ranking 1 AND rank 1 in ranking 2
    const result = reciprocalRankFusion([['x', 'y'], ['y']], 2);
    expect(result[0]).toBe('y');
  });

  it('handles a single ranking by returning it', () => {
    const result = reciprocalRankFusion([['a', 'b', 'c']], 2);
    expect(result).toEqual(['a', 'b']);
  });

  it('handles empty rankings array', () => {
    expect(reciprocalRankFusion([], 5)).toEqual([]);
  });
});

describe('hybridTopK', () => {
  const docs = [
    { id: 'yc', text: 'YC founders build great startups' },
    { id: 'ai', text: 'AI agents are eating software' },
    { id: 'sf', text: 'San Francisco is back' },
  ];
  const bm25 = buildBm25(docs);

  it('falls back to BM25-only when embeddings missing', () => {
    const result = hybridTopK(null, null, bm25, 'YC startups', 3);
    expect(result).toContain('yc');
  });

  it('falls back to embeddings-only when bm25 missing', () => {
    const embeddings = buildEmbeddings(
      [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      ['yc', 'ai', 'sf'],
    );
    const query = Float32Array.from([0, 1, 0]);
    const result = hybridTopK(embeddings, query, null, 'unused', 3);
    expect(result[0]).toBe('ai');
  });

  it('fuses both signals — exact-term match still surfaces', () => {
    const embeddings = buildEmbeddings(
      [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      ['yc', 'ai', 'sf'],
    );
    // Query vec only points at "sf" but BM25 hits "yc"
    const queryVec = Float32Array.from([0, 0, 1]);
    const result = hybridTopK(embeddings, queryVec, bm25, 'YC', 2);
    expect(result).toContain('yc');
    expect(result).toContain('sf');
  });

  it('returns empty when both inputs are null', () => {
    expect(hybridTopK(null, null, null, 'q', 5)).toEqual([]);
  });
});
