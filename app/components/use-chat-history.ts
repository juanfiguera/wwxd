'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';
import useSWR from 'swr';
import type { UIMessage } from 'ai';
import {
  conversationFetcher,
  conversationMessagesUrl,
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
 * Solo-chat history. SWR resolves the persona's solo conversation (creating
 * one on first access) and loads its messages. Saves happen explicitly from
 * useChat's `onFinish` via `saveAfterFinish`.
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
  // and we sync back out via saveAfterFinish.
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!data) return;
    if (hydratedFor.current === username) return;
    hydratedFor.current = username;
    setMessages(data.messages.length > 0 ? data.messages.map(storedToUi) : []);
  }, [data, username, setMessages]);

  useEffect(() => {
    return () => {
      if (hydratedFor.current !== username) hydratedFor.current = null;
    };
  }, [username]);

  const saveAfterFinish = useCallback(
    (finalMessages: UIMessage[]) => {
      if (finalMessages.length === 0) return;
      if (!data) return; // conversation not resolved yet
      const wire = finalMessages.map((m) => uiToStored(m, username));
      fetchJson(conversationMessagesUrl(data.conversation.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: wire }),
        onErrorMessage: "Couldn't save this conversation. Your next message may not persist.",
      })
        .then(() => {
          mutate({ ...data, messages: wire }, { revalidate: false });
          router.refresh();
        })
        .catch(() => {});
    },
    [username, data, mutate, router],
  );

  const clear = useCallback(() => {
    setMessages([]);
    if (!data) return;
    fetchJson(conversationMessagesUrl(data.conversation.id), {
      method: 'DELETE',
      onErrorMessage: "Couldn't clear the conversation on the server.",
    })
      .then(() => {
        mutate({ ...data, messages: [] }, { revalidate: false });
        router.refresh();
      })
      .catch(() => {});
  }, [data, setMessages, mutate, router]);

  return { clear, hasHistory: messages.length > 0, saveAfterFinish };
}
