import { z } from 'zod';
import {
  createRoundtable,
  getOrCreateSolo,
  listConversations,
} from '@/lib/db';

const CreateBody = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('solo'),
    persona: z.string().min(1).max(40),
  }),
  z.object({
    kind: z.literal('roundtable'),
    participants: z
      .array(z.string().min(1).max(40))
      .min(1)
      .max(20),
    title: z.string().max(120).optional(),
  }),
]);

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const kindRaw = url.searchParams.get('kind');
  const limitRaw = url.searchParams.get('limit');
  let kind: 'solo' | 'roundtable' | undefined;
  if (kindRaw === 'solo' || kindRaw === 'roundtable') kind = kindRaw;
  const limit = limitRaw ? Math.max(1, Math.min(500, Number(limitRaw))) : undefined;
  const conversations = listConversations({ kind, limit });
  return Response.json({ conversations });
}

/**
 * POST /api/conversations
 *
 * For solo: resolves (creating if needed) the single solo conversation for
 * the persona. Idempotent — repeated calls return the same conversation.
 *
 * For roundtable: creates a brand-new conversation. Two POSTs with the same
 * participant list produce two distinct conversations.
 */
export async function POST(req: Request): Promise<Response> {
  const raw = await req.json().catch(() => null);
  const parsed = CreateBody.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
      { status: 400 },
    );
  }
  const body = parsed.data;
  if (body.kind === 'solo') {
    const conv = getOrCreateSolo(body.persona);
    return Response.json({ conversation: conv }, { status: 200 });
  }
  const conv = createRoundtable(body.participants, body.title);
  return Response.json({ conversation: conv }, { status: 201 });
}
