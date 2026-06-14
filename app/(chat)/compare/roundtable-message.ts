/**
 * Pure helpers for the roundtable's message wire format. Extracted from
 * roundtable.tsx so the conversion logic is independently testable and
 * doesn't need React to import.
 */

import type { StoredMessageWire } from '@/app/components/conversation-cache';
import type { RetrievedTweetMeta } from '@/app/components/sources-panel';

export type RoundtableMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  speaker?: string;
  retrievedTweets?: RetrievedTweetMeta[];
  passed?: boolean;
  passReason?: string;
};

/**
 * 8-12 char id. Good-enough collision resistance for messages within a
 * single client session; the server-side composite PK on (id,
 * conversation_id) absorbs the rare cross-session collision.
 */
export function uid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function rtToStored(m: RoundtableMessage): StoredMessageWire {
  const meta: Record<string, unknown> = {};
  if (m.retrievedTweets) meta.retrievedTweets = m.retrievedTweets;
  if (m.passed) {
    meta.passed = true;
    meta.passReason = m.passReason;
  }
  return {
    id: m.id,
    role: m.role,
    speaker: m.speaker ?? null,
    text: m.text,
    metadata: Object.keys(meta).length > 0 ? meta : null,
  };
}

export function storedToRt(s: StoredMessageWire): RoundtableMessage {
  const meta = (s.metadata ?? {}) as {
    retrievedTweets?: RetrievedTweetMeta[];
    passed?: boolean;
    passReason?: string;
  };
  return {
    id: s.id,
    role: s.role,
    text: s.text,
    speaker: s.speaker ?? undefined,
    retrievedTweets: meta.retrievedTweets,
    passed: meta.passed,
    passReason: meta.passReason,
  };
}
