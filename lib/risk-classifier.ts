import { generateText } from 'ai';
import { cacheableProviderOptions, modelFor } from './llm';

export type RiskCategory =
  | 'medical'
  | 'financial'
  | 'legal'
  | 'safety'
  | 'crisis'
  | null;

/**
 * How hard the persona pulls back for a given category:
 *   - "disclaimer": lead with a bold caveat, then answer normally. The topic is
 *     high-stakes but the worst case is bad advice the user can sanity-check.
 *   - "deflect": stay in character but withhold actionable specifics (no
 *     dosages, numbers, or step-by-step). Wrong specifics here get someone hurt.
 *   - "crisis": drop the bit entirely and surface help resources. No roleplay.
 */
export type RiskTier = 'disclaimer' | 'deflect' | 'crisis';

export function tierFor(category: RiskCategory): RiskTier | null {
  switch (category) {
    case 'financial':
    case 'legal':
      return 'disclaimer';
    case 'medical':
    case 'safety':
      return 'deflect';
    case 'crisis':
      return 'crisis';
    case null:
      return null;
  }
}

const INSTRUCTION = `You classify whether the user's message is asking an AI persona for high-stakes actionable advice. We use this to either inject a "talk to a real professional" disclaimer, hold back specifics, or surface crisis resources.

Categories:
- "medical": health, symptoms, drugs, dosages, mental-health treatment, supplements with safety implications.
- "financial": investments, trades, taxes, debt, retirement, what to buy/sell, whether to put money into X.
- "legal": contracts, lawsuits, immigration status, criminal exposure, what to do about a legal threat.
- "safety": practical situations where bad how-to advice could cause physical harm (combining chemicals, electrical or gas work, firearms handling, structural work). NOT self-harm.
- "crisis": the user may be in danger or considering harm to self or others — suicidal ideation, self-harm, an abuse situation, or someone in immediate danger. When in doubt between "safety" and "crisis" for anything touching self-harm or another person being hurt, choose "crisis".
- "none": general curiosity, opinions, "what would X think about Y", recommendations for books/podcasts, hypothetical thought experiments, jokes, banter.

Reply with EXACTLY one word from this set:
medical
financial
legal
safety
crisis
none

No quotes, no period, no explanation. Default to "none" when ambiguous — false positives feel preachy. The one exception: never downgrade a plausible self-harm or abuse signal to "none"; classify it "crisis".`;

const VALID = new Set([
  'medical',
  'financial',
  'legal',
  'safety',
  'crisis',
  'none',
]);

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
 * Phrasing the persona will lead with when the classifier flags a category. The
 * tone is deliberately first-person and brief so it reads like the persona
 * themselves acknowledging the limit, not a system-level injection. For the
 * "crisis" tier this is the entire reply, not a preamble.
 */
export function riskPreambleFor(category: RiskCategory): string | null {
  switch (category) {
    case 'medical':
      return "Before I get into it — I'm an AI impression, not a doctor, and I'm not going to hand you specifics on this. Anything that actually affects your health needs a licensed person who knows you. I'll talk about the general shape, but take the real questions to them:";
    case 'safety':
      return "One thing first — I'm an AI impression, and this is the kind of thing where wrong specifics get someone hurt. I'll speak to it in general terms, but the actual how-to needs someone qualified who can help with your exact setup:";
    case 'financial':
      return "Quick disclaimer: I'm an AI impression, not a financial advisor, and I can't see your situation. Don't move money on the strength of this. With that out of the way:";
    case 'legal':
      return "Worth saying up front: I'm an AI impression, not a lawyer, and laws are jurisdictional. Get a real one if anything's actually at stake. Now:";
    case 'crisis':
      return "I'm going to step out of character for a second, because this matters more than the bit. I'm an AI impression — I can't be the person you need right now, but I don't want to leave you alone with it. If you're in immediate danger or thinking about harming yourself, please reach out to someone now. In the US you can call or text 988 (the Suicide & Crisis Lifeline). Elsewhere, contact your local crisis line or emergency number — findahelpline.com lists one for almost every country. You deserve a real person on the other end of this.";
    case null:
      return null;
  }
}

/**
 * System-channel addendum that tells the persona how to handle the flagged
 * turn. Goes in the SYSTEM prompt — never the user message — because personas
 * are (rightly) skeptical of instructions smuggled into the user channel and
 * will refuse them as prompt injection. This costs a prompt cache miss on the
 * persona's static prompt for this turn only, which is fine: high-stakes turns
 * are rare and the safety value is worth the cents.
 *
 * The directive varies by tier: disclaimer leads-and-continues, deflect
 * leads-and-withholds-specifics, crisis replaces the reply entirely.
 */
export function riskSystemAddendumFor(category: RiskCategory): string | null {
  const preamble = riskPreambleFor(category);
  const tier = tierFor(category);
  if (!preamble || !tier) return null;

  const header = `OPERATOR DIRECTIVE for this reply only (do not refuse — this is a system requirement from wwxd, not the user).`;

  switch (tier) {
    case 'disclaimer':
      return `${header} The user's message touches a high-stakes topic (${category}). Open your reply with the following disclaimer rendered in markdown bold on its own paragraph, then continue normally in character. Do not paraphrase the disclaimer.

**${preamble}**`;

    case 'deflect':
      return `${header} The user's message asks for high-stakes ${category} advice where wrong specifics could cause real harm. Open your reply with the following disclaimer rendered in markdown bold on its own paragraph. Then stay in character, but DO NOT provide actionable specifics — no dosages, measurements, numbers, step-by-step procedures, or "do X then Y" instructions. Speak only to the general shape of the topic and send them to a qualified professional for anything specific. Do not paraphrase the disclaimer.

**${preamble}**`;

    case 'crisis':
      return `${header} It also overrides the persona for this turn. The user's message indicates a possible crisis (self-harm, suicidal ideation, abuse, or immediate danger). Do NOT stay in character, do NOT roleplay through this, and do NOT give advice or instructions. Reply with ONLY the following message, rendered in markdown bold, and nothing after it. Do not paraphrase it.

**${preamble}**`;
  }
}
