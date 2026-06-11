import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the AI SDK so we never touch a real model in unit tests.
let mockResponse: { text: string } | Error = { text: '{}' };
vi.mock('ai', () => ({
  generateText: vi.fn(async () => {
    if (mockResponse instanceof Error) throw mockResponse;
    return mockResponse;
  }),
}));
vi.mock('../llm', () => ({
  modelFor: vi.fn(() => 'mocked-model'),
  cacheableProviderOptions: vi.fn(() => undefined),
}));

import { disambiguate, __test__ } from '../disambiguate';

const { safeParse } = __test__;

beforeEach(() => {
  mockResponse = { text: '{}' };
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('safeParse', () => {
  it('parses a clean response', () => {
    const out = safeParse(
      '{"canonical":"Steve Jobs","who":"Apple co-founder (1955-2011)","confidence":"high"}',
    );
    expect(out).toEqual({
      canonical: 'Steve Jobs',
      who: 'Apple co-founder (1955-2011)',
      confidence: 'high',
    });
  });

  it('extracts JSON from a code-fenced response', () => {
    const out = safeParse(
      '```json\n{"canonical":"Marie Kondo","who":"organizing consultant","confidence":"high"}\n```',
    );
    expect(out?.canonical).toBe('Marie Kondo');
    expect(out?.confidence).toBe('high');
  });

  it('coerces unknown confidence values to "unknown" and blanks the canonical', () => {
    const out = safeParse('{"canonical":"Foo","who":"bar","confidence":"maybe"}');
    expect(out).toEqual({ canonical: '', who: '', confidence: 'unknown' });
  });

  it('returns unknown when canonical is missing despite high confidence', () => {
    const out = safeParse('{"canonical":"","who":"","confidence":"high"}');
    expect(out).toEqual({ canonical: '', who: '', confidence: 'unknown' });
  });

  it('returns null for non-JSON gibberish', () => {
    expect(safeParse('totally not json')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(safeParse('{not really json}')).toBeNull();
  });
});

describe('disambiguate', () => {
  it('returns unknown for an empty name without calling the model', async () => {
    const res = await disambiguate('   ');
    expect(res).toEqual({ canonical: '', who: '', confidence: 'unknown' });
  });

  it('returns the model result on a well-formed reply', async () => {
    mockResponse = {
      text: '{"canonical":"Trevor Noah","who":"comedian","confidence":"high"}',
    };
    const res = await disambiguate('Trevor Noah');
    expect(res.canonical).toBe('Trevor Noah');
    expect(res.confidence).toBe('high');
  });

  it('spell-corrects via the model when the input is a typo', async () => {
    mockResponse = {
      text: '{"canonical":"Elon Musk","who":"Tesla/SpaceX CEO","confidence":"high"}',
    };
    const res = await disambiguate('Elon Mosk');
    expect(res.canonical).toBe('Elon Musk');
  });

  it('falls back to unknown when the model throws', async () => {
    mockResponse = new Error('network');
    const res = await disambiguate('Anyone');
    expect(res).toEqual({ canonical: '', who: '', confidence: 'unknown' });
  });

  it('falls back to unknown when the model returns gibberish', async () => {
    mockResponse = { text: 'no idea what this person is' };
    const res = await disambiguate('Some Name');
    expect(res.confidence).toBe('unknown');
  });
});
