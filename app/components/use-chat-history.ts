'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';
import useSWR from 'swr';
import type { UIMessage } from 'ai';
import {
  conversationFetcher,
  soloKey,
  type StoredMessageWire,
} from './conversation-cache';
import { fetchJson } from './fetch-utils';

function uiToStored(m: UIMessage, defaultSpeaker: string): StoredMessageWire {
  const text = m.parts
    .map((p) => (p.type === 'text' ? p.text : ''))
    .join('');
  const meta = (m as { metadata?: unknown }).metadata;
  return {
    id: m.id,
    role: m.role as 'user' | 'assistant',
    speaker: m.role === 'assistant' ? defaultSpeaker : null,
    text,
    metadata: meta ?? null,
  };
}

function storedToUi(s: StoredMessageWire): UIMessage {
  return {
    id: s.id,
    role: s.role,
    parts: [{ type: 'text', text: s.text }],
    metadata: s.metadata ?? undefined,
  } as unknown as UIMessage;
}

/**
 * Solo-chat history. SWR owns the load + cache; saves happen explicitly
 * from useChat's `onFinish` (call `saveAfterFinish` from there).
 */
export function useChatHistory({
  username,
  messages,
  setMessages,
}: {
  username: string;
  messages: UIMessage[];
  setMessages: (m: UIMessage[]) => void;
}): {
  clear: () => void;
  hasHistory: boolean;
  saveAfterFinish: (finalMessages: UIMessage[]) => void;
} {
  const router = useRouter();
  const key = soloKey(username);
  const { data, mutate } = useSWR(key, conversationFetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  // Hydrate useChat's internal state from the fetched conversation. We do
  // this once per username — after that, useChat owns the message stream
  // (streaming chunks, new turns) and we sync back out via saveAfterFinish.
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!data) return;
    if (hydratedFor.current === username) return;
    hydratedFor.current = username;
    setMessages(data.length > 0 ? data.map(storedToUi) : []);
  }, [data, username, setMessages]);

  // Reset hydration when the user switches personas, so the next data arrival
  // re-hydrates instead of holding the previous persona's transcript.
  useEffect(() => {
    return () => {
      if (hydratedFor.current !== username) hydratedFor.current = null;
    };
  }, [username]);

  const saveAfterFinish = useCallback(
    (finalMessages: UIMessage[]) => {
      if (finalMessages.length === 0) return;
      const wire = finalMessages.map((m) => uiToStored(m, username));
      fetchJson(key, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: wire }),
        onErrorMessage: "Couldn't save this conversation. Your next message may not persist.",
      })
        .then(() => {
          mutate(wire, { revalidate: false });
          router.refresh();
        })
        .catch(() => {});
    },
    [username, key, mutate, router],
  );

  const clear = useCallback(() => {
    setMessages([]);
    fetchJson(key, {
      method: 'DELETE',
      onErrorMessage: "Couldn't clear the conversation on the server.",
    })
      .then(() => {
        mutate([], { revalidate: false });
        router.refresh();
      })
      .catch(() => {});
  }, [key, setMessages, mutate, router]);

  return { clear, hasHistory: messages.length > 0, saveAfterFinish };
}
