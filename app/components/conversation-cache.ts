'use client';

/**
 * Centralized SWR keys + fetcher for conversation history.
 *
 * Previously the load logic lived in useEffect with refs (hydrated, lastKey,
 * loadCompleteKey, messagesRef) and a `cancelled` flag — that combo caused
 * several subtle bugs (StrictMode race blocking setMessages, save guards
 * preventing PUTs from firing). SWR owns the cache, dedupes, and handles
 * key-change refetching for us, so callers can just read `data` and react.
 */

export type StoredMessageWire = {
  id: string;
  role: 'user' | 'assistant';
  speaker: string | null;
  text: string;
  metadata: unknown;
};

export function soloKey(username: string): string {
  return `/api/conversations?kind=solo&key=${encodeURIComponent(username)}`;
}

export function roundtableKey(usernamesSortedJoined: string): string {
  return `/api/conversations?kind=roundtable&key=${encodeURIComponent(
    usernamesSortedJoined,
  )}`;
}

/** SWR fetcher. Returns the parsed messages array (possibly empty). */
export async function conversationFetcher(
  url: string,
): Promise<StoredMessageWire[]> {
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as { messages?: StoredMessageWire[] };
  return Array.isArray(data.messages) ? data.messages : [];
}
