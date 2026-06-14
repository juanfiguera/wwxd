import { streamText, type UIMessage } from 'ai';
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
  const { messages }: { messages: UIMessage[] } = await req.json();

  // Convert UIMessage[] → engine's HistoryMessage[]. The engine doesn't need
  // multimodal parts; flatten text parts and drop the rest.
  const history: HistoryMessage[] = messages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    text: m.parts.map((p) => (p.type === 'text' ? p.text : '')).join(''),
  }));

  let prep;
  try {
    prep = await prepareTurn({
      speaker: username,
      speakers: [{ username, displayName: username }],
      history,
      mode: 'solo',
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

  const result = streamText({
    model: modelFor('chat'),
    system: systemPrompt,
    messages: built,
    providerOptions: cacheableProviderOptions(),
  });

  return result.toUIMessageStreamResponse({
    messageMetadata: ({ part }) => {
      if (part.type === 'start') {
        return { retrievedTweets: retrievedMeta };
      }
      if (part.type === 'finish') {
        emit('persona.completed', {});
      }
    },
  });
}
