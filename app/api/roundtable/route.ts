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
 * Wire format: Server-Sent Events on a single `text/event-stream` body.
 *
 *   event: meta
 *   data: {"retrievedTweets": [...]}
 *
 *   event: text
 *   data: {"value": "chunk"}
 *
 *   event: gate-passed
 *   data: {"reason": "..."}
 *
 *   event: error
 *   data: {"message": "...", "code": "upstream"}
 *
 *   event: done
 *
 * Every payload is JSON-encoded so newlines inside text chunks never
 * collide with SSE's line framing. Phase 2.1 replaces the old
 * `__WWXD_STREAM_ERROR__` sentinel that used to live in the text stream.
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

  const encoder = new TextEncoder();
  function sse(event: string, data: unknown): Uint8Array {
    const payload = data === undefined ? '' : `data: ${JSON.stringify(data)}\n`;
    return encoder.encode(`event: ${event}\n${payload}\n`);
  }

  const reader = turn.stream.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Always emit the meta event first so the client has the
        // retrieval metadata before any text starts flowing.
        controller.enqueue(sse('meta', { retrievedTweets: turn.retrievedMeta }));
        function emit(part: TurnStreamPart): void {
          if (part.type === 'text') {
            controller.enqueue(sse('text', { value: part.value }));
          } else if (part.type === 'gate-passed') {
            controller.enqueue(sse('gate-passed', { reason: part.reason }));
          } else if (part.type === 'error') {
            controller.enqueue(
              sse('error', { message: part.message, code: part.code ?? 'upstream' }),
            );
          }
        }
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) emit(value);
        }
        controller.enqueue(sse('done', undefined));
      } finally {
        controller.close();
        reader.releaseLock();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
