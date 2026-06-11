import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DELETE, GET, PUT } from '../route';

const tmpDir = mkdtempSync(join(tmpdir(), 'wwxd-convs-route-'));
const dbPath = resolve(tmpDir, 'wwxd.db');

beforeAll(() => {
  process.env.WWXD_DB_PATH = dbPath;
});

afterAll(() => {
  delete process.env.WWXD_DB_PATH;
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeUrl(params: { kind?: string; key?: string } = {}): string {
  const u = new URL('http://test.local/api/conversations');
  if (params.kind !== undefined) u.searchParams.set('kind', params.kind);
  if (params.key !== undefined) u.searchParams.set('key', params.key);
  return u.toString();
}

function makeMessages(prefix: string) {
  // Each conversation needs unique message IDs because the messages table
  // has a global primary key on `id`.
  return [
    { id: `${prefix}-u`, role: 'user' as const, speaker: null, text: 'hi', metadata: null },
    {
      id: `${prefix}-a`,
      role: 'assistant' as const,
      speaker: 'paulg',
      text: 'hello.',
      metadata: null,
    },
  ];
}

describe('GET', () => {
  it('returns 400 when kind/key are missing', async () => {
    const res = await GET(new Request(makeUrl({})));
    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid kind', async () => {
    const res = await GET(new Request(makeUrl({ kind: 'bogus', key: 'k' })));
    expect(res.status).toBe(400);
  });

  it('returns empty messages array for an unknown conversation', async () => {
    const res = await GET(new Request(makeUrl({ kind: 'solo', key: 'never-existed' })));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: unknown[] };
    expect(body.messages).toEqual([]);
  });
});

describe('PUT', () => {
  it('saves a conversation and is retrievable via GET', async () => {
    const putRes = await PUT(
      new Request(makeUrl({ kind: 'solo', key: 'paulg' }), {
        method: 'PUT',
        body: JSON.stringify({ messages: makeMessages(Math.random().toString(36).slice(2)) }),
      }),
    );
    expect(putRes.status).toBe(204);

    const getRes = await GET(new Request(makeUrl({ kind: 'solo', key: 'paulg' })));
    const body = (await getRes.json()) as {
      messages: { id: string; role: string; speaker: string | null; text: string }[];
    };
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].text).toBe('hi');
    expect(body.messages[1].speaker).toBe('paulg');
  });

  it('overwrites existing messages on subsequent PUT', async () => {
    await PUT(
      new Request(makeUrl({ kind: 'solo', key: 'overwrite-test' }), {
        method: 'PUT',
        body: JSON.stringify({ messages: makeMessages(Math.random().toString(36).slice(2)) }),
      }),
    );
    await PUT(
      new Request(makeUrl({ kind: 'solo', key: 'overwrite-test' }), {
        method: 'PUT',
        body: JSON.stringify({
          messages: [
            {
              id: 'only',
              role: 'user' as const,
              speaker: null,
              text: 'replaced',
              metadata: null,
            },
          ],
        }),
      }),
    );
    const res = await GET(new Request(makeUrl({ kind: 'solo', key: 'overwrite-test' })));
    const body = (await res.json()) as { messages: { text: string }[] };
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].text).toBe('replaced');
  });

  it('returns 400 for missing kind/key', async () => {
    const res = await PUT(
      new Request(makeUrl({}), {
        method: 'PUT',
        body: JSON.stringify({ messages: [] }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for malformed JSON body', async () => {
    const res = await PUT(
      new Request(makeUrl({ kind: 'solo', key: 'bad-body' }), {
        method: 'PUT',
        body: 'not json',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when the messages array is too large', async () => {
    const huge = Array.from({ length: 2001 }, (_, i) => ({
      id: `m${i}`,
      role: 'user' as const,
      speaker: null,
      text: 'x',
      metadata: null,
    }));
    const res = await PUT(
      new Request(makeUrl({ kind: 'solo', key: 'too-big' }), {
        method: 'PUT',
        body: JSON.stringify({ messages: huge }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('DELETE', () => {
  it('removes a conversation', async () => {
    await PUT(
      new Request(makeUrl({ kind: 'solo', key: 'doomed' }), {
        method: 'PUT',
        body: JSON.stringify({ messages: makeMessages(Math.random().toString(36).slice(2)) }),
      }),
    );
    const delRes = await DELETE(
      new Request(makeUrl({ kind: 'solo', key: 'doomed' }), { method: 'DELETE' }),
    );
    expect(delRes.status).toBe(204);
    const getRes = await GET(new Request(makeUrl({ kind: 'solo', key: 'doomed' })));
    const body = (await getRes.json()) as { messages: unknown[] };
    expect(body.messages).toEqual([]);
  });

  it('returns 204 even if nothing was there to delete', async () => {
    const res = await DELETE(
      new Request(makeUrl({ kind: 'solo', key: 'never-there' }), { method: 'DELETE' }),
    );
    expect(res.status).toBe(204);
  });

  it('returns 400 for missing params', async () => {
    const res = await DELETE(new Request(makeUrl({}), { method: 'DELETE' }));
    expect(res.status).toBe(400);
  });
});
