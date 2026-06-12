import { z } from 'zod';
import {
  deleteGroup,
  DuplicateGroupNameError,
  getGroup,
  updateGroup,
} from '@/lib/groups';

const PatchBody = z.object({
  name: z.string().min(1).max(60).optional(),
  personas: z
    .array(z.string().min(1).max(40).regex(/^[a-zA-Z0-9_]+$/))
    .min(1)
    .max(20)
    .optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const group = await getGroup(id);
  if (!group) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ group });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const raw = await req.json().catch(() => null);
  const parsed = PatchBody.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
      { status: 400 },
    );
  }
  try {
    const group = await updateGroup(id, parsed.data);
    if (!group) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json({ group });
  } catch (err) {
    if (err instanceof DuplicateGroupNameError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const ok = await deleteGroup(id);
  if (!ok) return Response.json({ error: 'Not found' }, { status: 404 });
  return new Response(null, { status: 204 });
}
