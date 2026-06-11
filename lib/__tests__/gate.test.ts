import { describe, it, expect } from 'vitest';
import { parseGateDecision, shouldRunGate, someoneHasSpokenSinceLastUser } from '../gate';

describe('parseGateDecision', () => {
  it('parses NO with a reason', () => {
    expect(parseGateDecision('NO: Marc said it already')).toEqual({
      speak: false,
      reason: 'Marc said it already',
    });
  });

  it('parses NO without colon', () => {
    expect(parseGateDecision('NO nothing to add')).toEqual({
      speak: false,
      reason: 'nothing to add',
    });
  });

  it('parses YES as speak', () => {
    expect(parseGateDecision('YES')).toEqual({ speak: true });
  });

  it('parses YES with reason as speak (reason discarded for affirmative)', () => {
    expect(parseGateDecision('YES: I have a real take here')).toEqual({ speak: true });
  });

  it('strips wrapping quotes from reason', () => {
    expect(parseGateDecision('NO: "redundant with what Paul said"')).toEqual({
      speak: false,
      reason: 'redundant with what Paul said',
    });
  });

  it('defaults to speak on unclear text', () => {
    expect(parseGateDecision('hmm I think maybe')).toEqual({ speak: true });
  });

  it('defaults to speak on empty input', () => {
    expect(parseGateDecision('   ')).toEqual({ speak: true });
  });

  it('handles NO with no reason as no comment', () => {
    expect(parseGateDecision('NO')).toEqual({ speak: false, reason: 'no comment' });
  });

  it('is case-insensitive', () => {
    expect(parseGateDecision('no: pass')).toEqual({ speak: false, reason: 'pass' });
    expect(parseGateDecision('yes')).toEqual({ speak: true });
  });
});

describe('shouldRunGate', () => {
  it('runs when 2+ speakers and a user query', () => {
    expect(shouldRunGate(2, true)).toBe(true);
    expect(shouldRunGate(5, true)).toBe(true);
  });

  it('does not run for single-speaker roundtable', () => {
    expect(shouldRunGate(1, true)).toBe(false);
  });

  it('does not run without a user query', () => {
    expect(shouldRunGate(3, false)).toBe(false);
  });
});

describe('someoneHasSpokenSinceLastUser', () => {
  it('returns false when last entry is a user message', () => {
    const history = [{ role: 'user' as const, text: 'hello' }];
    expect(someoneHasSpokenSinceLastUser(history)).toBe(false);
  });

  it('returns false when no one has spoken after the latest user message', () => {
    const history = [
      { role: 'user' as const, text: 'first question' },
      { role: 'assistant' as const, text: 'first answer' },
      { role: 'user' as const, text: 'follow up' },
    ];
    expect(someoneHasSpokenSinceLastUser(history)).toBe(false);
  });

  it('returns true when at least one substantive assistant message after the latest user message', () => {
    const history = [
      { role: 'user' as const, text: 'question' },
      { role: 'assistant' as const, text: "here's my take" },
    ];
    expect(someoneHasSpokenSinceLastUser(history)).toBe(true);
  });

  it('ignores empty assistant messages (passes) when looking for first speaker', () => {
    const history = [
      { role: 'user' as const, text: 'question' },
      { role: 'assistant' as const, text: '' },
      { role: 'assistant' as const, text: '' },
    ];
    expect(someoneHasSpokenSinceLastUser(history)).toBe(false);
  });

  it('counts a substantive message even if surrounded by passes', () => {
    const history = [
      { role: 'user' as const, text: 'q' },
      { role: 'assistant' as const, text: '' },
      { role: 'assistant' as const, text: 'real take' },
      { role: 'assistant' as const, text: '' },
    ];
    expect(someoneHasSpokenSinceLastUser(history)).toBe(true);
  });

  it('returns false for empty history', () => {
    expect(someoneHasSpokenSinceLastUser([])).toBe(false);
  });
});

describe('parseGateDecision long-pass handling', () => {
  it('truncates multi-sentence pass reasons to first sentence', () => {
    const raw = 'NO: I would just be repeating Marc. He already nailed the point. Nothing to add.';
    const decision = parseGateDecision(raw);
    expect(decision).toEqual({ speak: false, reason: 'I would just be repeating Marc.' });
  });
});
