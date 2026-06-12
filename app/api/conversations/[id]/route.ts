import { z } from 'zod';
import {
  clearMessages,
  deleteConversation,
  getConversation,
  getParticipants,
  loadMessages,
  saveMessages,
  type StoredMessage,
} from '@/lib/db';

const Message = z.object({
  id: z.string().min(1),
  role: z.enum(['user', 'assistant']),
  speaker: z.string().nullable(),
  text: z.string(),
  metadata: z.unknown().nullable(),
});

const PutBody = z.object({
  messages: z.array(Message).max(2000),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const conv = getConversation(id);
  if (!conv) return Response.json({ error: 'Not found' }, { status: 404 });
  const participants = getParticipants(id);
  const messages = loadMessages(id);
  return Response.json({ conversation: conv, participants, messages });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const conv = getConversation(id);
  if (!conv) return Response.json({ error: 'Not found' }, { status: 404 });
  const raw = await req.json().catch(() => null);
  const parsed = PutBody.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid body' },
      { status: 400 },
    );
  }
  const messages: StoredMessage[] = parsed.data.messages.map((m) => ({
    id: m.id,
    role: m.role,
    speaker: m.speaker,
    text: m.text,
    metadata: m.metadata,
  }));
  saveMessages(id, messages);
  return new Response(null, { status: 204 });
}

/**
 * DELETE clears messages but keeps the conversation row + participants.
 * The "delete the whole conversation" path runs through DELETE on the
 * participants endpoint or persona deletion. Keeping the conversation alive
 * lets the user re-engage the same lineup without losing the participant
 * history.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const conv = getConversation(id);
  if (!conv) return Response.json({ error: 'Not found' }, { status: 404 });
  // If there were no messages to begin with, drop the conversation entirely
  // so a "clear" on an empty chat doesn't leave orphan rows behind.
  const cleared = clearMessages(id);
  if (!cleared) deleteConversation(id);
  return new Response(null, { status: 204 });
}
