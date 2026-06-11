import { generateText } from 'ai';
import { cacheableProviderOptions, modelFor } from './llm';

export type DisambiguationConfidence = 'high' | 'low' | 'unknown';

export type Disambiguation = {
  canonical: string;
  who: string;
  confidence: DisambiguationConfidence;
};

const INSTRUCTION = `You disambiguate a name the user typed into a "create persona" form into a specific public figure.

Return strict JSON with three fields and nothing else:
{
  "canonical": "<canonical full name in its proper form (with diacritics if any), or empty string if no plausible figure>",
  "who": "<one short clause describing them, e.g. 'Apple co-founder (1955-2011)'>",
  "confidence": "high" | "low" | "unknown"
}

Confidence rules:
- "high": unambiguous well-known public figure, including after spell-correcting typos.
- "low": ambiguous (multiple people share the name with no obvious default), or a lesser-known figure where the canonical form is uncertain.
- "unknown": no plausible public figure matches even after considering typos. Return canonical: "", who: "".

Be GENEROUS about spell-correction. The user typed quickly, often on a phone. Aggressively map typos and phonetic mis-spellings to the canonical figure, including:
- Single-letter substitutions ("Elon Mosk" -> "Elon Musk").
- Consonant swaps common in Spanish ("Salbador Dali" -> "Salvador Dalí").
- Missing or extra letters ("Aretha Frankling" -> "Aretha Franklin"; "Trever Noah" -> "Trevor Noah").
- Missing diacritics ("Frida Kahlo", "Garcia Marquez" -> "Gabriel García Márquez").
- Transposed letters ("Steeve Jobs" -> "Steve Jobs").

Only return "unknown" when there is genuinely no public figure that the input plausibly refers to. Do not invent fake people. Do not include any prose outside the JSON. No code fences.`;

const FIRST_JSON_OBJECT = /\{[\s\S]*\}/;

function safeParse(raw: string): Disambiguation | null {
  // Models sometimes wrap the JSON in code fences or add a one-line preamble
  // even when told not to. Pull the first {...} substring to be defensive.
  const match = raw.match(FIRST_JSON_OBJECT);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const canonical = typeof obj.canonical === 'string' ? obj.canonical.trim() : '';
  const who = typeof obj.who === 'string' ? obj.who.trim() : '';
  const conf = typeof obj.confidence === 'string' ? obj.confidence.trim().toLowerCase() : '';
  const confidence: DisambiguationConfidence =
    conf === 'high' || conf === 'low' ? conf : 'unknown';
  if (confidence === 'unknown') {
    return { canonical: '', who: '', confidence };
  }
  if (!canonical) return { canonical: '', who: '', confidence: 'unknown' };
  return { canonical, who, confidence };
}

export async function disambiguate(name: string): Promise<Disambiguation> {
  const trimmed = name.trim();
  if (!trimmed) return { canonical: '', who: '', confidence: 'unknown' };
  try {
    const res = await generateText({
      model: modelFor('classifier'),
      system: INSTRUCTION,
      prompt: trimmed.slice(0, 200),
      providerOptions: cacheableProviderOptions(),
    });
    return safeParse(res.text) ?? { canonical: '', who: '', confidence: 'unknown' };
  } catch {
    // Network / provider failure → return unknown so the UI can still let
    // the user proceed with their typed name as the displayName.
    return { canonical: '', who: '', confidence: 'unknown' };
  }
}

// Exported for tests.
export const __test__ = { safeParse };
