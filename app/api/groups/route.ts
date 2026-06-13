import { z } from 'zod';
import { createGroup, DuplicateGroupNameError, listGroups } from '@/lib/groups';

const CreateBody = z.object({
  name: z.string().min(1).max(60),
  personas: z.array(z.string().min(1).max(40).regex(/^[a-zA-Z0-9_-]+$/)).min(1).max(20),
});

export async function GET(): Promise<Response> {
  const groups = await listGroups();
  return Response.json({ groups });
}

export async function POST(req: Request): Promise<Response> {
  const raw = await req.json().catch(() => null);
  const parsed = CreateBody.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
      { status: 400 },
    );
  }
  try {
    const group = await createGroup(parsed.data);
    return Response.json({ group }, { status: 201 });
  } catch (err) {
    if (err instanceof DuplicateGroupNameError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
