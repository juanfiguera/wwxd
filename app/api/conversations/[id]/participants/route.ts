import { z } from 'zod';
import {
  addParticipant,
  getConversation,
  getParticipants,
  removeParticipant,
} from '@/lib/db';

const Body = z.object({
  username: z.string().min(1).max(40).regex(/^[a-zA-Z0-9_-]+$/),
});

/**
 * POST /api/conversations/[id]/participants
 *
 * Add a persona to a roundtable. Idempotent. Solo conversations reject.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const conv = getConversation(id);
  if (!conv) return Response.json({ error: 'Not found' }, { status: 404 });
  if (conv.kind !== 'roundtable') {
    return Response.json(
      { error: 'Solo conversations cannot gain participants.' },
      { status: 400 },
    );
  }
  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid body' },
      { status: 400 },
    );
  }
  addParticipant(id, parsed.data.username);
  return Response.json({ participants: getParticipants(id) });
}

/**
 * DELETE /api/conversations/[id]/participants?username=...
 *
 * Soft-remove a participant by stamping left_at. Past messages from them
 * stay in the conversation history. Idempotent.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const url = new URL(req.url);
  const username = url.searchParams.get('username');
  if (!username) {
    return Response.json({ error: 'Missing username' }, { status: 400 });
  }
  const conv = getConversation(id);
  if (!conv) return Response.json({ error: 'Not found' }, { status: 404 });
  removeParticipant(id, username);
  return Response.json({ participants: getParticipants(id) });
}
