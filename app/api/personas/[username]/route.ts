import { unlink } from 'node:fs/promises';
import { z } from 'zod';
import { clearConversation } from '@/lib/db';
import { removePersonaFromAllGroups } from '@/lib/groups';
import { corpusPath } from '@/lib/persona';
import { embeddingsPath } from '@/lib/retrieve';

const UsernameParam = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-zA-Z0-9_]+$/, 'Invalid username');

async function tryUnlink(path: string): Promise<boolean> {
  try {
    await unlink(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ username: string }> },
): Promise<Response> {
  const { username } = await params;
  const parsed = UsernameParam.safeParse(username);
  if (!parsed.success) {
    return Response.json({ error: 'Invalid username' }, { status: 400 });
  }

  const summary: Record<string, unknown> = {};
  try {
    summary.corpusDeleted = await tryUnlink(corpusPath(username));
    summary.embeddingsDeleted = await tryUnlink(embeddingsPath(username));
    // Best-effort: also clear the embeddings cache for this username so a
    // follow-up request doesn't try to read deleted data. The SQLite-backed
    // conversation row is removed via clearConversation; we don't touch
    // roundtable conversations the persona participated in — those are kept
    // as historical record, just without the persona's mascot data.
    summary.soloConversationCleared = clearConversation('solo', username);
    summary.groupsTouched = await removePersonaFromAllGroups(username);

    return Response.json({ ok: true, summary });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
