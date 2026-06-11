import { describe, it, expect } from 'vitest';
import { PALETTE, personaStyle, tintHex } from '../persona-styling';
import { CROWNS } from '@/app/components/persona-avatar';

describe('personaStyle', () => {
  it('returns overrides for curated handles', () => {
    expect(personaStyle('garrytan')).toEqual({ color: '#f1592b', crown: 'bumps' });
    expect(personaStyle('naval')).toEqual({ color: '#0e9c8e', crown: 'flat' });
  });

  it('is case- and @-insensitive for overrides', () => {
    expect(personaStyle('@GarryTan')).toEqual(personaStyle('garrytan'));
  });

  it('produces deterministic output for unknown handles', () => {
    const a = personaStyle('some_random_handle');
    const b = personaStyle('some_random_handle');
    expect(a).toEqual(b);
  });

  it('produces different output for different handles (mostly)', () => {
    const samples = Array.from({ length: 20 }, (_, i) => personaStyle(`user${i}`));
    const uniqueColors = new Set(samples.map((s) => s.color));
    const uniqueCrowns = new Set(samples.map((s) => s.crown));
    expect(uniqueColors.size).toBeGreaterThan(1);
    expect(uniqueCrowns.size).toBeGreaterThan(1);
  });

  it('only ever returns palette colors', () => {
    for (let i = 0; i < 50; i += 1) {
      const s = personaStyle(`handle_${i}`);
      expect(PALETTE).toContain(s.color);
    }
  });

  it('only ever returns valid crowns', () => {
    for (let i = 0; i < 50; i += 1) {
      const s = personaStyle(`handle_${i}`);
      expect(CROWNS).toContain(s.crown);
    }
  });
});

describe('tintHex', () => {
  it('returns the original color at pct=1', () => {
    expect(tintHex('#000000', 1)).toBe('rgb(0, 0, 0)');
  });

  it('returns white at pct=0', () => {
    expect(tintHex('#000000', 0)).toBe('rgb(255, 255, 255)');
  });

  it('mixes toward white for fractional pct', () => {
    // 0.5 of black = 50% mix toward white
    expect(tintHex('#000000', 0.5)).toBe('rgb(128, 128, 128)');
  });

  it('accepts 3-char hex', () => {
    expect(tintHex('#f00', 1)).toBe('rgb(255, 0, 0)');
  });

  it('preserves bright colors at very high pct', () => {
    expect(tintHex('#2e6bf6', 1)).toBe('rgb(46, 107, 246)');
  });
});
