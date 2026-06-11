import { z } from 'zod';
import {
  clearConversation,
  loadConversation,
  saveConversation,
  type ConversationKind,
  type StoredMessage,
} from '@/lib/db';

const Kind = z.enum(['solo', 'roundtable']);

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

function parseParams(req: Request): { kind: ConversationKind; key: string } | { error: string } {
  const url = new URL(req.url);
  const kindRaw = url.searchParams.get('kind');
  const key = url.searchParams.get('key');
  if (!kindRaw || !key) return { error: 'Missing kind or key' };
  const kindParsed = Kind.safeParse(kindRaw);
  if (!kindParsed.success) return { error: 'Invalid kind' };
  if (key.length === 0 || key.length > 500) return { error: 'Invalid key' };
  return { kind: kindParsed.data, key };
}

export async function GET(req: Request): Promise<Response> {
  const parsed = parseParams(req);
  if ('error' in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const messages = loadConversation(parsed.kind, parsed.key);
  return Response.json({ messages });
}

export async function PUT(req: Request): Promise<Response> {
  const parsed = parseParams(req);
  if ('error' in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const raw = await req.json().catch(() => null);
  const body = PutBody.safeParse(raw);
  if (!body.success) {
    return Response.json(
      { error: body.error.issues[0]?.message ?? 'Invalid body' },
      { status: 400 },
    );
  }
  const messages: StoredMessage[] = body.data.messages.map((m) => ({
    id: m.id,
    role: m.role,
    speaker: m.speaker,
    text: m.text,
    metadata: m.metadata,
  }));
  saveConversation(parsed.kind, parsed.key, messages);
  return new Response(null, { status: 204 });
}

export async function DELETE(req: Request): Promise<Response> {
  const parsed = parseParams(req);
  if ('error' in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  clearConversation(parsed.kind, parsed.key);
  return new Response(null, { status: 204 });
}
