import { describe, it, expect } from 'vitest';
import { tokenize, buildBm25, bm25TopK, bm25Score } from '../bm25';

describe('tokenize', () => {
  it('lowercases and splits on whitespace', () => {
    expect(tokenize('Hello World Foo')).toEqual(['hello', 'world', 'foo']);
  });

  it('strips URLs', () => {
    expect(tokenize('check this https://example.com/foo out')).toEqual(['check', 'this', 'out']);
  });

  it('drops short single-char tokens', () => {
    expect(tokenize('I am a developer')).toEqual(['am', 'developer']);
  });

  it('keeps mentions and apostrophes', () => {
    expect(tokenize("@garrytan it's great")).toEqual(['@garrytan', "it's", 'great']);
  });
});

describe('BM25', () => {
  const docs = [
    { id: 'a', text: 'YC founders build great companies' },
    { id: 'b', text: 'AI agents will eat the world' },
    { id: 'c', text: 'great founders ship great products' },
    { id: 'd', text: 'random unrelated text about cats' },
  ];

  it('ranks documents by query term overlap', () => {
    const idx = buildBm25(docs);
    const result = bm25TopK('founders ship great', idx, 4);
    expect(result[0]).toBe('c');
    expect(result.slice(0, 2).sort()).toEqual(['a', 'c']);
  });

  it('returns empty when no terms overlap', () => {
    const idx = buildBm25(docs);
    expect(bm25TopK('elephants jazz quantum', idx, 4)).toEqual([]);
  });

  it('handles exact-term hits that embeddings often miss', () => {
    const idx = buildBm25([
      { id: 'a', text: 'thoughts on YC' },
      { id: 'b', text: 'thoughts on accelerators' },
    ]);
    const result = bm25TopK('YC', idx, 2);
    expect(result[0]).toBe('a');
  });

  it('produces no scores on empty index', () => {
    const idx = buildBm25([]);
    expect(bm25Score('anything', idx).size).toBe(0);
  });
});
