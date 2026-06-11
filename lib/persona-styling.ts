import type { Crown } from '@/app/components/persona-avatar';

export type PersonaStyle = {
  color: string;
  crown: Crown;
};

/**
 * Curated overrides for handles we recognize. Matches the design handoff's
 * CHAR mapping so seed personas look like the reference mascots.
 */
const OVERRIDES: Record<string, PersonaStyle> = {
  elonmusk: { color: '#2e6bf6', crown: 'antenna' },
  sama: { color: '#17a44e', crown: 'flat' },
  steve_jobs: { color: '#16140d', crown: 'tuft' },
  warrenbuffett: { color: '#e0451b', crown: 'bumps' },
  trevornoah: { color: '#7b5bff', crown: 'horns' },
  jonstewart: { color: '#f1592b', crown: 'spikes' },
  davechappelle: { color: '#c2410c', crown: 'flat' },
  naval: { color: '#0e9c8e', crown: 'flat' },
  mariekondo: { color: '#ff5c8a', crown: 'sprout' },
  // additional well-known handles. Choices spread across the palette so two
  // seed personas on screen at once stay visually distinct.
  garrytan: { color: '#f1592b', crown: 'bumps' },
  paulg: { color: '#b45309', crown: 'tuft' }, // deep amber — readable on light bg, distinct from Naval
  pmarca: { color: '#4f46e5', crown: 'spikes' }, // indigo — distinguishes from Elon (blue)
  karpathy: { color: '#06b6d4', crown: 'antenna' }, // cyan — distinguishes from Trevor (purple)
  patrickc: { color: '#d946ef', crown: 'horns' }, // magenta
  gregisenberg: { color: '#84cc16', crown: 'sprout' }, // lime
  leopoldasch: { color: '#ef4444', crown: 'spikes' }, // red
  aakashgupta: { color: '#ec4899', crown: 'ears' }, // hot pink
};

/**
 * The full character palette. Hash-based defaults pull from this list, so
 * unseen handles still get a deterministic color. Twelve hues, evenly spread,
 * so adjacent rows in the rail don't collide visually.
 */
export const PALETTE: readonly string[] = [
  '#ef4444', // red
  '#f1592b', // orange
  '#b45309', // deep amber (pure amber was 1.6:1 contrast — unreadable)
  '#65a30d', // olive (deeper lime — readable on cream)
  '#17a44e', // green
  '#0e9c8e', // teal
  '#0891b2', // deep cyan (deeper than #06b6d4 for contrast)
  '#2e6bf6', // blue
  '#4f46e5', // indigo
  '#7b5bff', // purple
  '#c026d3', // deep magenta (deeper than #d946ef for contrast)
  '#ec4899', // pink
] as const;

const CROWNS: readonly Crown[] = [
  'bumps',
  'sprout',
  'spikes',
  'antenna',
  'ears',
  'horns',
  'tuft',
  'flat',
] as const;

function hashString(s: string): number {
  // 32-bit FNV-1a. Tiny, deterministic, no dependencies.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function personaStyle(username: string): PersonaStyle {
  const key = username.toLowerCase().replace(/^@/, '');
  const override = OVERRIDES[key];
  if (override) return override;
  const h = hashString(key);
  return {
    color: PALETTE[h % PALETTE.length],
    crown: CROWNS[(h >>> 8) % CROWNS.length],
  };
}

/**
 * Soft tint of a color toward white. Used for avatar backgrounds and
 * accent-soft surfaces. Mirrors the `tint(hex, pct)` helper in the handoff.
 * pct = 0.16 produces the typical avatar backplate; 0.14 produces accent-soft.
 */
export function tintHex(hex: string, pct: number): string {
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const m = (v: number) => Math.round(v + (255 - v) * (1 - pct));
  return `rgb(${m(r)}, ${m(g)}, ${m(b)})`;
}
