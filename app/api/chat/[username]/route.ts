import { streamText, type UIMessage } from 'ai';
import { randomUUID } from 'node:crypto';
import { upsertMessage } from '@/lib/db';
import { cacheableProviderOptions, modelFor } from '@/lib/llm';
import { prepareTurn, type HistoryMessage } from '@/lib/turn-engine';

export const maxDuration = 300;

/**
 * Solo persona chat endpoint. Thin shell over `prepareTurn` from
 * lib/turn-engine.ts. Engine does corpus load, retrieval (with query
 * embedding cache), risk classification, and prompt building. The route
 * keeps control of streamText() so AI SDK's `toUIMessageStreamResponse`
 * can serve the wire format that `useChat` on the client expects.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ username: string }> },
): Promise<Response> {
  const { username } = await params;
  const body: {
    messages: UIMessage[];
    conversationId?: string;
    assistantMessageId?: string;
  } = await req.json();
  const { messages, conversationId, assistantMessageId } = body;

  // Convert UIMessage[] → engine's HistoryMessage[]. The engine doesn't need
  // multimodal parts; flatten text parts and drop the rest.
  const history: HistoryMessage[] = messages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    text: m.parts.map((p) => (p.type === 'text' ? p.text : '')).join(''),
  }));
  // Ordinal = position of the assistant message about to be produced.
  const ordinal = history.length + 1;

  let prep;
  try {
    prep = await prepareTurn({
      speaker: username,
      speakers: [{ username, displayName: username }],
      history,
      mode: 'solo',
      conversationId,
      ordinal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      {
        error: `Could not load tweets for @${username}. Run "pnpm fetch-tweets ${username}" first. (${message})`,
      },
      { status: 500 },
    );
  }
  // Solo never hits the gate; type-narrow defensively.
  if (prep.kind !== 'speak') {
    return Response.json({ error: 'Unexpected gate path on solo turn' }, { status: 500 });
  }
  const { systemPrompt, messages: built, retrievedMeta, emit } = prep.inputs;

  // Phase 2.2 solo partial persistence.
  // The client (useChat) doesn't supply assistantMessageId today because
  // the AI SDK assigns its own ids internally. Generate one server-side
  // so the partial-save path has a stable target. On clean completion the
  // client's later PUT (saveMessages clears+reinserts) replaces this row
  // with the SDK-id row, so we don't accumulate duplicates. On disconnect
  // mid-stream the client's PUT never fires, so this row remains as the
  // partial-recovery artifact for the next page load.
  const persistAssistantId = assistantMessageId ?? randomUUID();
  let accumulated = '';
  let flushTimer: NodeJS.Timeout | null = null;
  const saveAssistant = (text: string, isPartial: boolean): void => {
    if (!conversationId) return;
    try {
      upsertMessage(conversationId, {
        id: persistAssistantId,
        role: 'assistant',
        speaker: username,
        text,
        metadata:
          retrievedMeta.length > 0 ? { retrievedTweets: retrievedMeta } : null,
        ordinal,
        isPartial,
      });
    } catch (err) {
      console.error('[chat] upsertMessage failed:', err);
    }
  };
  const schedulePartialSave = (): void => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      if (accumulated.length > 0) saveAssistant(accumulated, true);
    }, 500);
  };

  const result = streamText({
    model: modelFor('chat'),
    system: systemPrompt,
    messages: built,
    providerOptions: cacheableProviderOptions(),
    // onChunk + 500ms flush timer: catches text as it streams so a tab
    // close mid-reply leaves the user with what arrived, not nothing.
    onChunk: ({ chunk }) => {
      if (chunk.type === 'text-delta') {
        accumulated += chunk.text;
        schedulePartialSave();
      }
    },
    // Clean completion: cancel any pending partial flush and write the
    // final row with is_partial = 0. The `text` payload is authoritative.
    onFinish: ({ text }) => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      emit('persona.completed', { chars: text.length });
      saveAssistant(text, false);
    },
    onError: ({ error }) => {
      const msg = error instanceof Error ? error.message : String(error);
      emit('persona.errored', { message: msg, code: 'upstream' });
      // Whatever we got is worth keeping; mark partial so the trace and
      // the message row reflect "stream was cut short".
      if (accumulated.length > 0) saveAssistant(accumulated, true);
    },
  });

  return result.toUIMessageStreamResponse({
    messageMetadata: ({ part }) => {
      if (part.type === 'start') {
        return { retrievedTweets: retrievedMeta };
      }
    },
  });
}
