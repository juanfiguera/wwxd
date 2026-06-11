import { z } from 'zod';
import { disambiguate } from '@/lib/disambiguate';

export const maxDuration = 30;

const Body = z.object({
  name: z.string().min(1).max(200),
});

export async function POST(req: Request): Promise<Response> {
  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
      { status: 400 },
    );
  }
  const result = await disambiguate(parsed.data.name);
  return Response.json(result);
}
