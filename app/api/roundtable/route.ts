import { z } from 'zod';
import { runTurn, type TurnStreamPart } from '@/lib/turn-engine';

export const maxDuration = 300;

const Body = z.object({
  speaker: z.string().min(1),
  speakers: z
    .array(z.object({ username: z.string().min(1), displayName: z.string().min(1) }))
    .min(1),
  history: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      text: z.string(),
      speaker: z.string().optional(),
    }),
  ),
  /**
   * Optional. When present, the engine writes structured rows to
   * conversation_events tagged with `(conversationId, ordinal)` for
   * downstream debugging and evals. `ordinal` defaults to the position of
   * the assistant message about to be produced (history length + 1).
   */
  conversationId: z.string().min(1).optional(),
});

/**
 * Roundtable endpoint. Thin shell over `runTurn` from lib/turn-engine.ts.
 *
 * Wire format (preserved for client compatibility):
 *   - Gate said NO → JSON  `{ passed: true, reason, speaker }`
 *   - Otherwise → streamed text, with `__WWXD_STREAM_ERROR__<message>` as a
 *     sentinel on upstream provider errors. Phase 2 of the refactor plan
 *     replaces the sentinel with a proper SSE protocol.
 *   - X-Retrieved-Tweets header on both.
 */
export async function POST(req: Request): Promise<Response> {
  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
      { status: 400 },
    );
  }
  const { speaker, speakers, history, conversationId } = parsed.data;
  const ordinal = history.length + 1;

  let turn;
  try {
    turn = await runTurn({
      speaker,
      speakers,
      history,
      mode: 'roundtable',
      conversationId,
      ordinal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `Could not load tweets for @${speaker}. (${message})` },
      { status: 500 },
    );
  }

  const retrievedHeader = encodeURIComponent(JSON.stringify(turn.retrievedMeta));
  const reader = turn.stream.getReader();
  const first = await reader.read();

  // Empty stream: shouldn't happen for a real run; respond with no body.
  if (first.done) {
    reader.releaseLock();
    return new Response('', {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Retrieved-Tweets': retrievedHeader,
      },
    });
  }

  // Gate said NO: single-shot JSON, no streaming body.
  if (first.value?.type === 'gate-passed') {
    reader.releaseLock();
    return Response.json(
      { passed: true, reason: first.value.reason, speaker },
      {
        status: 200,
        headers: { 'X-Retrieved-Tweets': retrievedHeader },
      },
    );
  }

  // Text (or error) path: stream the parts as plain text with the legacy
  // sentinel on errors. The first part is already in hand, so include it.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function emit(part: TurnStreamPart): void {
        if (part.type === 'text') {
          controller.enqueue(encoder.encode(part.value));
        } else if (part.type === 'error') {
          controller.enqueue(encoder.encode(`__WWXD_STREAM_ERROR__${part.message}`));
        }
      }
      if (first.value) emit(first.value);
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          if (next.value) emit(next.value);
        }
      } finally {
        controller.close();
        reader.releaseLock();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Retrieved-Tweets': retrievedHeader,
    },
  });
}
