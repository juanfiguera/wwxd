import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

// SWR is mocked to a stub we control per test.
const swrData = vi.fn();
const swrMutate = vi.fn();
vi.mock('swr', () => ({
  default: () => ({ data: swrData(), mutate: swrMutate }),
}));

import { useChatHistory } from '../use-chat-history';
import type { UIMessage } from 'ai';

type ConversationPayload = {
  conversation: { id: string; kind: 'solo' | 'roundtable'; title: null; createdAt: string; updatedAt: string };
  participants: string[];
  messages: { id: string; role: 'user' | 'assistant'; speaker: string | null; text: string; metadata: unknown }[];
};

function payload(messages: ConversationPayload['messages'], username = 'paulg'): ConversationPayload {
  return {
    conversation: { id: 'conv-uuid', kind: 'solo', title: null, createdAt: '', updatedAt: '' },
    participants: [username],
    messages,
  };
}

function makeUiMessage(role: 'user' | 'assistant', text: string, id = 'm-' + text): UIMessage {
  return {
    id,
    role,
    parts: [{ type: 'text', text }],
    metadata: null,
  } as unknown as UIMessage;
}

function Harness({
  username,
  messages,
  setMessages,
  expose,
}: {
  username: string;
  messages: UIMessage[];
  setMessages: (m: UIMessage[]) => void;
  expose?: (api: ReturnType<typeof useChatHistory>) => void;
}) {
  const api = useChatHistory({ username, messages, setMessages });
  expose?.(api);
  return null;
}

const savedFetch = globalThis.fetch;

beforeEach(() => {
  swrData.mockReturnValue(undefined);
  swrMutate.mockClear();
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
});
afterEach(() => {
  globalThis.fetch = savedFetch;
  vi.restoreAllMocks();
});

describe('useChatHistory hydration', () => {
  it('does nothing while SWR data is still loading', () => {
    const setMessages = vi.fn();
    render(<Harness username="paulg" messages={[]} setMessages={setMessages} />);
    expect(setMessages).not.toHaveBeenCalled();
  });

  it('hydrates useChat once when SWR returns saved messages', () => {
    swrData.mockReturnValue(
      payload([
        { id: '1', role: 'user', speaker: null, text: 'hi', metadata: null },
        { id: '2', role: 'assistant', speaker: 'paulg', text: 'hello.', metadata: null },
      ]),
    );
    const setMessages = vi.fn();
    render(<Harness username="paulg" messages={[]} setMessages={setMessages} />);
    expect(setMessages).toHaveBeenCalledOnce();
    const args = setMessages.mock.calls[0][0] as UIMessage[];
    expect(args).toHaveLength(2);
    expect(args[1].role).toBe('assistant');
  });

  it('resets to [] when the saved conversation is empty', () => {
    swrData.mockReturnValue(payload([]));
    const setMessages = vi.fn();
    render(<Harness username="paulg" messages={[]} setMessages={setMessages} />);
    expect(setMessages).toHaveBeenCalledOnce();
    expect(setMessages.mock.calls[0][0]).toEqual([]);
  });
});

describe('useChatHistory saveAfterFinish', () => {
  it('PUTs to /api/conversations/<uuid> and mutates the cache', async () => {
    swrData.mockReturnValue(payload([]));
    let api!: ReturnType<typeof useChatHistory>;
    const setMessages = vi.fn();
    render(
      <Harness
        username="paulg"
        messages={[]}
        setMessages={setMessages}
        expose={(a) => {
          api = a;
        }}
      />,
    );
    await act(async () => {
      api.saveAfterFinish([
        makeUiMessage('user', 'hi'),
        makeUiMessage('assistant', 'hello.'),
      ]);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/conversations/conv-uuid');
    expect((init as RequestInit).method).toBe('PUT');
    const body = JSON.parse((init as { body: string }).body) as {
      messages: { speaker: string | null; text: string }[];
    };
    expect(body.messages).toHaveLength(2);
    expect(body.messages[1].speaker).toBe('paulg');
    expect(swrMutate).toHaveBeenCalled();
  });

  it('is a no-op when the final message list is empty', () => {
    swrData.mockReturnValue(payload([]));
    let api!: ReturnType<typeof useChatHistory>;
    render(
      <Harness
        username="paulg"
        messages={[]}
        setMessages={() => {}}
        expose={(a) => {
          api = a;
        }}
      />,
    );
    api.saveAfterFinish([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(swrMutate).not.toHaveBeenCalled();
  });
});

describe('useChatHistory clear', () => {
  it('DELETEs /api/conversations/<uuid> and resets messages', async () => {
    swrData.mockReturnValue(payload([]));
    const setMessages = vi.fn();
    let api!: ReturnType<typeof useChatHistory>;
    render(
      <Harness
        username="paulg"
        messages={[makeUiMessage('user', 'hi')]}
        setMessages={setMessages}
        expose={(a) => {
          api = a;
        }}
      />,
    );

    await act(async () => {
      api.clear();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setMessages).toHaveBeenCalledWith([]);
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/conversations/conv-uuid');
    expect((init as RequestInit).method).toBe('DELETE');
    expect(swrMutate).toHaveBeenCalled();
  });
});

describe('useChatHistory hasHistory', () => {
  it('reflects whether messages array is non-empty', () => {
    swrData.mockReturnValue(payload([]));
    let api!: ReturnType<typeof useChatHistory>;
    const { rerender } = render(
      <Harness
        username="paulg"
        messages={[]}
        setMessages={() => {}}
        expose={(a) => {
          api = a;
        }}
      />,
    );
    expect(api.hasHistory).toBe(false);
    rerender(
      <Harness
        username="paulg"
        messages={[makeUiMessage('user', 'hi')]}
        setMessages={() => {}}
        expose={(a) => {
          api = a;
        }}
      />,
    );
    expect(api.hasHistory).toBe(true);
  });
});
