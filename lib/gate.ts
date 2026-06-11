export const GATE_INSTRUCTION = `You're in a roundtable. The user wants to hear what each of you actually thinks.

Decide if you have a contribution worth making right now. Reply with EXACTLY one of:

"YES" — if you have a take on this topic in your voice, even a quick sharp one
"NO: <one-line reason>" — only if (a) your take would literally repeat what someone else JUST said, or (b) the topic is genuinely outside everything you've ever spoken about publicly

Default to YES. Wanting to "hear what others say first" or "let the experts go" is NOT a reason to pass — the user is asking the group, and your voice matters. Don't defer.`;

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
