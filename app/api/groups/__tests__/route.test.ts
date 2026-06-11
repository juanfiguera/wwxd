import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from '../route';
import {
  DELETE as DELETE_ID,
  GET as GET_ID,
  PATCH as PATCH_ID,
} from '../[id]/route';

const tmpDir = mkdtempSync(join(tmpdir(), 'wwxd-groups-route-'));

beforeAll(() => {
  process.env.WWXD_GROUPS_PATH = resolve(tmpDir, 'groups.json');
});
afterAll(() => {
  delete process.env.WWXD_GROUPS_PATH;
  rmSync(tmpDir, { recursive: true, force: true });
});
beforeEach(() => {
  // Clear the file between tests by writing an empty groups payload.
  // We can't import the lib helper to do this without a public reset, but
  // rewriting via fs is fine.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('node:fs').writeFileSync(
    resolve(tmpDir, 'groups.json'),
    JSON.stringify({ groups: [] }),
  );
});

function postReq(body: unknown): Request {
  return new Request('http://test.local/api/groups', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function paramOf(id: string) {
  return Promise.resolve({ id });
}

describe('GET /api/groups', () => {
  it('returns an empty array when no groups exist', async () => {
    const res = await GET();
    const body = (await res.json()) as { groups: unknown[] };
    expect(body.groups).toEqual([]);
  });

  it('returns created groups', async () => {
    await POST(postReq({ name: 'Founders', personas: ['paulg', 'sama'] }));
    const res = await GET();
    const body = (await res.json()) as { groups: { name: string }[] };
    expect(body.groups[0].name).toBe('Founders');
  });
});

describe('POST /api/groups', () => {
  it('creates a group and returns 201', async () => {
    const res = await POST(postReq({ name: 'Board', personas: ['paulg', 'sama'] }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { group: { id: string; name: string } };
    expect(body.group.id).toMatch(/^[0-9a-f-]+$/);
    expect(body.group.name).toBe('Board');
  });

  it('returns 400 for an empty name', async () => {
    const res = await POST(postReq({ name: '', personas: ['paulg'] }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when personas is empty', async () => {
    const res = await POST(postReq({ name: 'Empty', personas: [] }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for usernames with disallowed characters', async () => {
    const res = await POST(postReq({ name: 'OK', personas: ['has space'] }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await POST(
      new Request('http://test.local/api/groups', { method: 'POST', body: 'not json' }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects too many personas in one group', async () => {
    const personas = Array.from({ length: 21 }, (_, i) => `user${i}`);
    const res = await POST(postReq({ name: 'Huge', personas }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/groups/[id]', () => {
  it('returns the group', async () => {
    const created = await POST(postReq({ name: 'Solo', personas: ['x'] }));
    const { group } = (await created.json()) as { group: { id: string } };
    const res = await GET_ID(new Request('http://test/api/groups/x'), {
      params: paramOf(group.id),
    });
    const body = (await res.json()) as { group: { name: string } };
    expect(body.group.name).toBe('Solo');
  });

  it('returns 404 for an unknown id', async () => {
    const res = await GET_ID(new Request('http://test/api/groups/nope'), {
      params: paramOf('does-not-exist'),
    });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/groups/[id]', () => {
  it('renames a group', async () => {
    const created = await POST(postReq({ name: 'Old', personas: ['x'] }));
    const { group } = (await created.json()) as { group: { id: string } };

    const res = await PATCH_ID(
      new Request('http://test/api/groups/' + group.id, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'New' }),
      }),
      { params: paramOf(group.id) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { group: { name: string; personas: string[] } };
    expect(body.group.name).toBe('New');
    expect(body.group.personas).toEqual(['x']); // unchanged
  });

  it('updates personas independently of name', async () => {
    const created = await POST(postReq({ name: 'P', personas: ['a'] }));
    const { group } = (await created.json()) as { group: { id: string } };

    const res = await PATCH_ID(
      new Request('http://test/api/groups/' + group.id, {
        method: 'PATCH',
        body: JSON.stringify({ personas: ['a', 'b', 'c'] }),
      }),
      { params: paramOf(group.id) },
    );
    const body = (await res.json()) as { group: { personas: string[] } };
    expect(body.group.personas).toEqual(['a', 'b', 'c']);
  });

  it('returns 404 for unknown id', async () => {
    const res = await PATCH_ID(
      new Request('http://test/api/groups/nope', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'x' }),
      }),
      { params: paramOf('nope') },
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid body', async () => {
    const res = await PATCH_ID(
      new Request('http://test/api/groups/x', {
        method: 'PATCH',
        body: JSON.stringify({ name: '' }),
      }),
      { params: paramOf('x') },
    );
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/groups/[id]', () => {
  it('removes a group', async () => {
    const created = await POST(postReq({ name: 'Doomed', personas: ['x'] }));
    const { group } = (await created.json()) as { group: { id: string } };

    const del = await DELETE_ID(
      new Request('http://test/api/groups/' + group.id, { method: 'DELETE' }),
      { params: paramOf(group.id) },
    );
    expect(del.status).toBe(204);

    const after = await GET_ID(new Request('http://test/api/groups/' + group.id), {
      params: paramOf(group.id),
    });
    expect(after.status).toBe(404);
  });

  it('returns 404 when deleting an unknown id', async () => {
    const res = await DELETE_ID(
      new Request('http://test/api/groups/nope', { method: 'DELETE' }),
      { params: paramOf('nope') },
    );
    expect(res.status).toBe(404);
  });
});
