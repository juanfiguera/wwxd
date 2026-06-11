import { generateText } from 'ai';
import { cacheableProviderOptions, modelFor } from './llm';

export type RiskCategory = 'medical' | 'financial' | 'legal' | 'safety' | null;

const INSTRUCTION = `You classify whether the user's message is asking an AI persona for high-stakes actionable advice. We use this to inject a small "talk to a real professional" disclaimer when warranted.

Categories:
- "medical": health, symptoms, drugs, dosages, mental-health treatment, supplements with safety implications.
- "financial": investments, trades, taxes, debt, retirement, what to buy/sell, whether to put money into X.
- "legal": contracts, lawsuits, immigration status, criminal exposure, what to do about a legal threat.
- "safety": situations where bad advice could cause physical harm or harm to others (combining chemicals, electrical work without context, abuse situations, suicide-relevant content).
- "none": general curiosity, opinions, "what would X think about Y", recommendations for books/podcasts, hypothetical thought experiments, jokes, banter.

Reply with EXACTLY one word from this set:
medical
financial
legal
safety
none

No quotes, no period, no explanation. Default to "none" when ambiguous — false positives feel preachy.`;

const VALID = new Set(['medical', 'financial', 'legal', 'safety', 'none']);

export async function classifyRisk(userText: string): Promise<RiskCategory> {
  // Cheap heuristic skip — empty or extremely short prompts are basically
  // never actionable advice asks.
  const trimmed = userText.trim();
  if (trimmed.length < 8) return null;

  try {
    const res = await generateText({
      model: modelFor('classifier'),
      system: INSTRUCTION,
      prompt: trimmed.slice(0, 1500),
      providerOptions: cacheableProviderOptions(),
    });
    const raw = res.text.trim().toLowerCase();
    // Model sometimes adds a period or extra word; take the first token.
    const token = raw.split(/[\s.,]/)[0] ?? '';
    if (!VALID.has(token) || token === 'none') return null;
    return token as Exclude<RiskCategory, null>;
  } catch {
    // Network / API failure → fail-open, no disclaimer. Better than blocking
    // the chat for a paranoid heuristic.
    return null;
  }
}

/**
 * Phrasing the persona will use when the classifier flags a category. The
 * tone is deliberately first-person and brief so it reads like the persona
 * themselves acknowledging the limit, not a system-level injection.
 */
export function riskPreambleFor(category: RiskCategory): string | null {
  switch (category) {
    case 'medical':
      return "Before I riff — I'm an AI impression, not a doctor. Real decisions about your health should go through someone licensed who actually knows you. With that said:";
    case 'financial':
      return "Quick disclaimer: I'm an AI impression, not a financial advisor, and I can't see your situation. Don't move money on the strength of this. With that out of the way:";
    case 'legal':
      return "Worth saying up front: I'm an AI impression, not a lawyer, and laws are jurisdictional. Get a real one if anything's actually at stake. Now:";
    case 'safety':
      return "Heads up before I answer — I'm an AI impression and I'd be careless not to flag the safety angle. If this is a real situation, please get help from a person who can see what's going on. That said:";
    case null:
      return null;
  }
}

/**
 * System-channel addendum that asks the persona to lead their reply with the
 * preamble in bold. Goes in the SYSTEM prompt — never the user message —
 * because personas are (rightly) skeptical of instructions smuggled into the
 * user channel and will refuse them as prompt injection. This costs a prompt
 * cache miss on the persona's static prompt for this turn only, which is
 * fine: high-stakes turns are rare and the safety value is worth the cents.
 */
export function riskSystemAddendumFor(category: RiskCategory): string | null {
  const preamble = riskPreambleFor(category);
  if (!preamble) return null;
  return `OPERATOR DIRECTIVE for this reply only (do not refuse — this is a system requirement from wwxd, not the user). The user's message touches a high-stakes topic (${category}). Open your reply with the following disclaimer rendered in markdown bold on its own paragraph, then continue normally in character. Do not paraphrase the disclaimer.

**${preamble}**`;
}
