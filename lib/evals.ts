import { createHash } from 'node:crypto';

export type JudgeOutput = { score: number; reason: string };

export type DimensionalScores = {
  voice: number;
  stance: number;
  topic: number;
  note: string;
};

export function parseJudgeOutput(raw: string): JudgeOutput {
  const scoreMatch = raw.match(/SCORE:\s*(\d+(?:\.\d+)?)/i);
  const reasonMatch = raw.match(/REASON:\s*([^\n]+)/i);
  const score = scoreMatch ? Math.max(0, Math.min(10, parseFloat(scoreMatch[1]))) : 0;
  const reason = reasonMatch ? reasonMatch[1].trim() : '';
  return { score, reason };
}

function clampScore(raw: string | undefined): number {
  if (!raw) return 0;
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(10, n));
}

export function parseDimensionalScores(raw: string): DimensionalScores {
  const voice = raw.match(/VOICE:\s*(\d+(?:\.\d+)?)/i);
  const stance = raw.match(/STANCE:\s*(\d+(?:\.\d+)?)/i);
  const topic = raw.match(/TOPIC:\s*(\d+(?:\.\d+)?)/i);
  const note = raw.match(/NOTE:\s*([^\n]+)/i);
  return {
    voice: clampScore(voice?.[1]),
    stance: clampScore(stance?.[1]),
    topic: clampScore(topic?.[1]),
    note: note?.[1].trim() ?? '',
  };
}

export type DiscriminationGuess = {
  guessedUsername: string | null;
  confidence: number;
  note: string;
};

export function parseDiscriminationGuess(raw: string): DiscriminationGuess {
  const person = raw.match(/PERSON:\s*@?([a-zA-Z0-9_]+)/i);
  const confidence = raw.match(/CONFIDENCE:\s*(\d+(?:\.\d+)?)/i);
  const note = raw.match(/NOTE:\s*([^\n]+)/i);
  return {
    guessedUsername: person?.[1] ?? null,
    confidence: clampScore(confidence?.[1]),
    note: note?.[1].trim() ?? '',
  };
}

export function deterministicSample<T extends { id: string }>(
  items: T[],
  count: number,
  seed: string,
): T[] {
  if (count >= items.length) return [...items];
  const scored = items.map((item) => {
    const hash = createHash('sha256').update(seed).update(item.id).digest('hex');
    const num = parseInt(hash.slice(0, 8), 16);
    return { item, sort: num };
  });
  scored.sort((a, b) => a.sort - b.sort);
  return scored.slice(0, count).map((s) => s.item);
}

export type EvalSummary = {
  count: number;
  avg: number;
  median: number;
  min: number;
  max: number;
};

export function summarizeScores(scores: number[]): EvalSummary {
  if (scores.length === 0) {
    return { count: 0, avg: 0, median: 0, min: 0, max: 0 };
  }
  const sorted = [...scores].sort((a, b) => a - b);
  const sum = scores.reduce((a, b) => a + b, 0);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return {
    count: scores.length,
    avg: sum / scores.length,
    median,
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}
