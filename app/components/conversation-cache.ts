'use client';

/**
 * Centralized SWR keys + fetcher for conversation history.
 *
 * Conversations have stable UUIDs. Solo conversations are 1:1 with personas,
 * so callers use a virtual `solo:<username>` SWR key that the fetcher
 * resolves to the persona's conversation (creating one on first access).
 * Roundtables are addressed by UUID directly via `roundtable:<id>`.
 */

export type StoredMessageWire = {
  id: string;
  role: 'user' | 'assistant';
  speaker: string | null;
  text: string;
  metadata: unknown;
};

export type Conversation = {
  id: string;
  kind: 'solo' | 'roundtable';
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ConversationPayload = {
  conversation: Conversation;
  participants: string[];
  messages: StoredMessageWire[];
};

export function soloKey(username: string): string {
  return `solo:${username}`;
}

export function roundtableKey(conversationId: string): string {
  return `roundtable:${conversationId}`;
}

/** REST URL for saving / deleting messages on a known conversation. */
export function conversationMessagesUrl(conversationId: string): string {
  return `/api/conversations/${encodeURIComponent(conversationId)}`;
}

/** REST URL for adding a participant. */
export function conversationParticipantsUrl(conversationId: string): string {
  return `/api/conversations/${encodeURIComponent(conversationId)}/participants`;
}

/**
 * SWR fetcher. Reads the key prefix and dispatches to the right endpoint.
 * Returns a `ConversationPayload` with the resolved conversation + current
 * participants + messages.
 */
export async function conversationFetcher(
  key: string,
): Promise<ConversationPayload> {
  if (key.startsWith('solo:')) {
    const username = key.slice('solo:'.length);
    const createRes = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'solo', persona: username }),
    });
    if (!createRes.ok) {
      throw new Error(`Could not resolve solo conversation for ${username}`);
    }
    const { conversation } = (await createRes.json()) as {
      conversation: Conversation;
    };
    return fetchConversation(conversation.id);
  }
  if (key.startsWith('roundtable:')) {
    return fetchConversation(key.slice('roundtable:'.length));
  }
  throw new Error(`Unknown conversation key: ${key}`);
}

async function fetchConversation(id: string): Promise<ConversationPayload> {
  const res = await fetch(conversationMessagesUrl(id));
  if (!res.ok) throw new Error(`Conversation ${id} not found`);
  return (await res.json()) as ConversationPayload;
}
