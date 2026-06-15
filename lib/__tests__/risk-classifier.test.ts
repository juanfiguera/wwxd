import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the AI SDK so we never touch a real model in unit tests.
let mockResponse: { text: string } | Error = { text: 'none' };
vi.mock('ai', () => ({
  generateText: vi.fn(async () => {
    if (mockResponse instanceof Error) throw mockResponse;
    return mockResponse;
  }),
}));
// And shortcut the LLM provider factory so it doesn't error trying to read
// env we don't care about in these tests.
vi.mock('../llm', () => ({
  modelFor: vi.fn(() => 'mocked-model'),
  cacheableProviderOptions: vi.fn(() => undefined),
}));

import {
  classifyRisk,
  riskPreambleFor,
  riskSystemAddendumFor,
  tierFor,
} from '../risk-classifier';

beforeEach(() => {
  mockResponse = { text: 'none' };
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('riskPreambleFor', () => {
  it('returns null for null/none', () => {
    expect(riskPreambleFor(null)).toBeNull();
  });

  it('returns a persona-voice disclaimer for each category', () => {
    for (const cat of [
      'medical',
      'financial',
      'legal',
      'safety',
      'crisis',
    ] as const) {
      const text = riskPreambleFor(cat);
      expect(text).toBeTruthy();
      expect(text!.toLowerCase()).toMatch(/\bi['’]?m\b/); // first-person
      expect(text!.toLowerCase()).toMatch(/\bai\b/);
    }
  });

  it('medical disclaimer mentions doctor / licensed', () => {
    expect(riskPreambleFor('medical')!.toLowerCase()).toMatch(/doctor|licensed/);
  });
  it('financial disclaimer mentions financial / money', () => {
    expect(riskPreambleFor('financial')!.toLowerCase()).toMatch(/financial|money/);
  });
  it('legal disclaimer mentions lawyer / legal', () => {
    expect(riskPreambleFor('legal')!.toLowerCase()).toMatch(/lawyer|legal/);
  });
  it('safety disclaimer mentions safety / help', () => {
    expect(riskPreambleFor('safety')!.toLowerCase()).toMatch(/safety|help/);
  });
  it('crisis message surfaces a help line (988)', () => {
    expect(riskPreambleFor('crisis')).toContain('988');
  });
});

describe('tierFor', () => {
  it('maps categories to the right pullback tier', () => {
    expect(tierFor('financial')).toBe('disclaimer');
    expect(tierFor('legal')).toBe('disclaimer');
    expect(tierFor('medical')).toBe('deflect');
    expect(tierFor('safety')).toBe('deflect');
    expect(tierFor('crisis')).toBe('crisis');
    expect(tierFor(null)).toBeNull();
  });
});

describe('riskSystemAddendumFor', () => {
  it('returns null when category is null', () => {
    expect(riskSystemAddendumFor(null)).toBeNull();
  });

  it('returns a system-channel directive that wraps the preamble in **bold**', () => {
    const out = riskSystemAddendumFor('financial')!;
    expect(out).toContain('OPERATOR DIRECTIVE');
    expect(out).toContain('financial');
    expect(out).toContain('**'); // markdown bold for the preamble
    expect(out).toContain(riskPreambleFor('financial')!);
  });

  it('explicitly tells the model not to refuse the directive', () => {
    const out = riskSystemAddendumFor('safety')!;
    expect(out.toLowerCase()).toMatch(/do not refuse|don't refuse/);
  });

  it('deflect tier tells the persona to withhold actionable specifics', () => {
    for (const cat of ['medical', 'safety'] as const) {
      const out = riskSystemAddendumFor(cat)!;
      expect(out.toLowerCase()).toContain('do not provide actionable specifics');
      // Still leads with the bold disclaimer, still stays in character.
      expect(out).toContain(riskPreambleFor(cat)!);
      expect(out.toLowerCase()).toMatch(/stay in character/);
    }
  });

  it('crisis tier replaces the reply and drops character', () => {
    const out = riskSystemAddendumFor('crisis')!;
    expect(out.toLowerCase()).toMatch(/do not stay in character/);
    expect(out.toLowerCase()).toMatch(/reply with only/);
    expect(out).toContain('988');
    // No "continue normally" — the persona must not answer the question.
    expect(out.toLowerCase()).not.toContain('continue normally');
  });
});

describe('classifyRisk', () => {
  it('short-circuits to null for very short prompts (no LLM call)', async () => {
    const { generateText } = await import('ai');
    await expect(classifyRisk('hi')).resolves.toBeNull();
    expect(vi.mocked(generateText)).not.toHaveBeenCalled();
  });

  it('returns null for "none" classification', async () => {
    mockResponse = { text: 'none' };
    await expect(
      classifyRisk('What do you think about VC vs bootstrapping?'),
    ).resolves.toBeNull();
  });

  it('maps each category response to the right enum value', async () => {
    for (const cat of [
      'medical',
      'financial',
      'legal',
      'safety',
      'crisis',
    ] as const) {
      mockResponse = { text: cat };
      await expect(classifyRisk('actionable question')).resolves.toBe(cat);
    }
  });

  it('tolerates trailing punctuation and extra words from the model', async () => {
    mockResponse = { text: 'financial.\n' };
    await expect(classifyRisk('actionable question')).resolves.toBe('financial');
    mockResponse = { text: 'Medical, definitely.' };
    await expect(classifyRisk('actionable question')).resolves.toBe('medical');
  });

  it('treats unrecognized model output as null', async () => {
    mockResponse = { text: 'something weird' };
    await expect(classifyRisk('actionable question')).resolves.toBeNull();
  });

  it('fails open (returns null) on a model/network error', async () => {
    mockResponse = new Error('boom');
    await expect(classifyRisk('actionable question')).resolves.toBeNull();
  });
});
