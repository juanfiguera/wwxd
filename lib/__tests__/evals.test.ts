import { describe, it, expect } from 'vitest';
import {
  deterministicSample,
  parseDimensionalScores,
  parseDiscriminationGuess,
  parseJudgeOutput,
  summarizeScores,
} from '../evals';

describe('parseJudgeOutput', () => {
  it('parses well-formed output', () => {
    const out = parseJudgeOutput('SCORE: 8\nREASON: Nails the punchy cadence');
    expect(out).toEqual({ score: 8, reason: 'Nails the punchy cadence' });
  });

  it('clamps scores above 10', () => {
    const out = parseJudgeOutput('SCORE: 99\nREASON: too high');
    expect(out.score).toBe(10);
  });

  it('clamps negative scores to 0', () => {
    const out = parseJudgeOutput('SCORE: -3\nREASON: weird');
    expect(out.score).toBe(0);
  });

  it('handles floats', () => {
    const out = parseJudgeOutput('SCORE: 7.5\nREASON: close');
    expect(out.score).toBe(7.5);
  });

  it('returns 0 when score is missing', () => {
    expect(parseJudgeOutput('REASON: missing').score).toBe(0);
  });

  it('returns empty reason when missing', () => {
    expect(parseJudgeOutput('SCORE: 5').reason).toBe('');
  });

  it('is case-insensitive', () => {
    expect(parseJudgeOutput('score: 6\nreason: lowercase')).toEqual({
      score: 6,
      reason: 'lowercase',
    });
  });
});

describe('deterministicSample', () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ id: `t${i}` }));

  it('returns N items', () => {
    expect(deterministicSample(items, 10, 'seed')).toHaveLength(10);
  });

  it('is stable across runs for the same seed', () => {
    const a = deterministicSample(items, 10, 'seed-1');
    const b = deterministicSample(items, 10, 'seed-1');
    expect(a).toEqual(b);
  });

  it('produces different samples for different seeds', () => {
    const a = deterministicSample(items, 10, 'seed-1');
    const b = deterministicSample(items, 10, 'seed-2');
    expect(a).not.toEqual(b);
  });

  it('returns all items when count >= length', () => {
    const result = deterministicSample(items, 999, 'seed');
    expect(result).toHaveLength(items.length);
  });

  it('returns empty for empty input', () => {
    expect(deterministicSample([], 5, 'seed')).toEqual([]);
  });
});

describe('parseDimensionalScores', () => {
  it('parses three dimensions plus a note', () => {
    const raw = 'VOICE: 7\nSTANCE: 6\nTOPIC: 8\nNOTE: nails the cadence but stance is off';
    expect(parseDimensionalScores(raw)).toEqual({
      voice: 7,
      stance: 6,
      topic: 8,
      note: 'nails the cadence but stance is off',
    });
  });

  it('clamps scores to 0-10', () => {
    const raw = 'VOICE: 15\nSTANCE: -2\nTOPIC: 5.5\nNOTE: ok';
    expect(parseDimensionalScores(raw)).toMatchObject({ voice: 10, stance: 0, topic: 5.5 });
  });

  it('defaults missing dimensions to 0', () => {
    expect(parseDimensionalScores('VOICE: 7').voice).toBe(7);
    expect(parseDimensionalScores('VOICE: 7').stance).toBe(0);
    expect(parseDimensionalScores('VOICE: 7').note).toBe('');
  });

  it('is case-insensitive', () => {
    expect(parseDimensionalScores('voice: 8\nstance: 5\ntopic: 9\nnote: case')).toEqual({
      voice: 8,
      stance: 5,
      topic: 9,
      note: 'case',
    });
  });
});

describe('parseDiscriminationGuess', () => {
  it('parses persona handle and confidence', () => {
    const raw = 'PERSON: garrytan\nCONFIDENCE: 8\nNOTE: punchy YC voice';
    expect(parseDiscriminationGuess(raw)).toEqual({
      guessedUsername: 'garrytan',
      confidence: 8,
      note: 'punchy YC voice',
    });
  });

  it('strips leading @', () => {
    expect(parseDiscriminationGuess('PERSON: @paulg\nCONFIDENCE: 7').guessedUsername).toBe('paulg');
  });

  it('returns null persona when missing', () => {
    expect(parseDiscriminationGuess('CONFIDENCE: 5').guessedUsername).toBeNull();
  });
});

describe('summarizeScores', () => {
  it('computes basic stats', () => {
    const summary = summarizeScores([3, 7, 8, 9, 10]);
    expect(summary.count).toBe(5);
    expect(summary.avg).toBeCloseTo(7.4);
    expect(summary.median).toBe(8);
    expect(summary.min).toBe(3);
    expect(summary.max).toBe(10);
  });

  it('handles empty input', () => {
    expect(summarizeScores([])).toEqual({ count: 0, avg: 0, median: 0, min: 0, max: 0 });
  });

  it('computes median for even count', () => {
    expect(summarizeScores([1, 2, 3, 4]).median).toBe(2.5);
  });
});
