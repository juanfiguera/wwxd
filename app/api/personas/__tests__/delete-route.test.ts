import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DELETE } from '../[username]/route';
import { createGroup, listGroups } from '@/lib/groups';

const tmp = mkdtempSync(join(tmpdir(), 'wwxd-personas-delete-'));
const originalCwd = process.cwd();

beforeAll(async () => {
  process.chdir(tmp);
  process.env.WWXD_GROUPS_PATH = resolve(tmp, 'data', 'groups.json');
  process.env.WWXD_DB_PATH = resolve(tmp, 'data', 'wwxd.db');
  await mkdir(resolve(tmp, 'data'), { recursive: true });
});
afterAll(() => {
  process.chdir(originalCwd);
  delete process.env.WWXD_GROUPS_PATH;
  delete process.env.WWXD_DB_PATH;
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  // Reset groups file between tests.
  await writeFile(
    resolve(tmp, 'data', 'groups.json'),
    JSON.stringify({ groups: [] }),
  );
});
afterEach(async () => {
  // Reset corpus files between tests so each starts clean.
});

async function paramOf(username: string) {
  return Promise.resolve({ username });
}

async function writeCorpus(username: string) {
  await writeFile(
    resolve(tmp, 'data', `${username}.json`),
    JSON.stringify({ username, displayName: username, fetchedAt: '', tweets: [] }),
  );
}

describe('DELETE /api/personas/[username]', () => {
  it('rejects invalid usernames with 400', async () => {
    const res = await DELETE(new Request('http://t/api/personas/bad name'), {
      params: paramOf('bad name'),
    });
    expect(res.status).toBe(400);
  });

  it('returns ok even when nothing existed (idempotent)', async () => {
    const res = await DELETE(new Request('http://t/api/personas/never'), {
      params: paramOf('never'),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      summary: { corpusDeleted: boolean; embeddingsDeleted: boolean; groupsTouched: number };
    };
    expect(body.ok).toBe(true);
    expect(body.summary.corpusDeleted).toBe(false);
    expect(body.summary.embeddingsDeleted).toBe(false);
    expect(body.summary.groupsTouched).toBe(0);
  });

  it('deletes the corpus file when present', async () => {
    await writeCorpus('alice');
    const res = await DELETE(new Request('http://t/api/personas/alice'), {
      params: paramOf('alice'),
    });
    const body = (await res.json()) as { summary: { corpusDeleted: boolean } };
    expect(body.summary.corpusDeleted).toBe(true);
  });

  it('strips the persona from every saved group', async () => {
    await writeCorpus('bob');
    await createGroup({ name: 'A', personas: ['bob', 'carol'] });
    await createGroup({ name: 'B', personas: ['bob'] }); // dropping bob empties this group entirely

    const res = await DELETE(new Request('http://t/api/personas/bob'), {
      params: paramOf('bob'),
    });
    const body = (await res.json()) as { summary: { groupsTouched: number } };
    expect(body.summary.groupsTouched).toBe(2);

    const after = await listGroups();
    expect(after).toHaveLength(1);
    expect(after[0].name).toBe('A');
    expect(after[0].personas).toEqual(['carol']);
  });
});
