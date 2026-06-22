export const GATE_INSTRUCTION = `You're in a roundtable. The user wants a range of DISTINCT perspectives — not the same point echoed by everyone.

Others may have already spoken this turn (their words appear as "[Name]: ..."). Decide whether YOU add something they haven't. Reply with EXACTLY one of:

"YES" — you have a genuinely distinct contribution: a different angle, a real disagreement, a concrete example, or a sharper framing that's actually in your voice.
"NO: <one-line reason>" — if your take would substantially overlap with what someone already said (the same core point, even in different words), if you'd mostly be agreeing or endorsing without adding a new angle, or if the topic is genuinely outside what you'd speak to.

When the room has already made your point, PASS — a tight panel of distinct voices beats a chorus repeating itself. But don't pass merely to "hear the experts first" or defer: if you have a real, different take, speak.`;

export type GateDecision = { speak: true } | { speak: false; reason: string };

export function parseGateDecision(raw: string): GateDecision {
  const trimmed = raw.trim();
  if (!trimmed) return { speak: true };

  const upper = trimmed.toUpperCase();
  if (upper.startsWith('NO')) {
    const fullReason = trimmed
      .replace(/^NO[:.]?\s*/i, '')
      .replace(/^["']|["']$/g, '')
      .trim();
    // Keep only the first sentence — long "pass" rationales tend to BE the take in disguise
    const firstSentence = fullReason.split(/(?<=[.!?])\s+/)[0] ?? fullReason;
    return { speak: false, reason: firstSentence.trim() || 'no comment' };
  }
  if (upper.startsWith('YES')) {
    return { speak: true };
  }
  return { speak: true };
}

export function shouldRunGate(speakerCount: number, hasUserQuery: boolean): boolean {
  return speakerCount >= 2 && hasUserQuery;
}

/**
 * Returns true if at least one persona has substantively spoken since the latest
 * user message. If false, the next speaker should bypass the gate and contribute,
 * to avoid cascading passes where everyone waits for someone else.
 */
export function someoneHasSpokenSinceLastUser(
  history: { role: 'user' | 'assistant'; text: string }[],
): boolean {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const m = history[i];
    if (m.role === 'user') return false;
    if (m.role === 'assistant' && m.text.trim().length > 0) {
      return true;
    }
  }
  return false;
}
