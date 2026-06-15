import { z } from 'zod';
import { runGate } from '@/lib/turn-engine';

export const maxDuration = 60;

const Body = z.object({
  speakers: z
    .array(
      z.object({
        username: z.string().min(1),
        displayName: z.string().min(1),
      }),
    )
    .min(1),
  history: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      text: z.string(),
      speaker: z.string().optional(),
    }),
  ),
  conversationId: z.string().min(1).optional(),
});

/**
 * Phase 1.4 parallel gate endpoint. Takes the full speaker list and runs
 * every persona's gate decision concurrently. Used by the roundtable client
 * to resolve "who actually has something to add" up front, then sequentially
 * stream replies only for those who passed.
 *
 * Response shape:
 *   { decisions: [{ speaker, shouldSpeak, reason }, ...] }
 *
 * Same order as the input `speakers`. `reason` is empty when shouldSpeak is
 * true; it's the model's justification when shouldSpeak is false.
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
  const { speakers, history, conversationId } = parsed.data;

  // ordinal per persona = position of the assistant message we're deciding
  // about. First non-first-speaker would land at history.length + 1, etc.
  // Matching the inline gate's bookkeeping keeps trace ordinals coherent.
  const decisions = await Promise.all(
    speakers.map((s, idx) =>
      runGate({
        speaker: s.username,
        speakers,
        history,
        isFirstSpeaker: idx === 0,
        conversationId,
        ordinal: history.length + 1 + idx,
      }).catch((err) => {
        console.error(`[gates] @${s.username} failed:`, err);
        // Fail open: persona gets to speak.
        return {
          speaker: s.username,
          shouldSpeak: true,
          reason: '',
        };
      }),
    ),
  );

  return Response.json({ decisions });
}
