import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET, POST } from '../route';
import {
  DELETE as DELETE_ID,
  GET as GET_ID,
  PUT as PUT_ID,
} from '../[id]/route';
import {
  POST as POST_PARTICIPANT,
  DELETE as DELETE_PARTICIPANT,
} from '../[id]/participants/route';

const tmpDir = mkdtempSync(join(tmpdir(), 'wwxd-convs-route-'));
const dbPath = resolve(tmpDir, 'wwxd.db');

beforeAll(() => {
  process.env.WWXD_DB_PATH = dbPath;
});

afterAll(() => {
  delete process.env.WWXD_DB_PATH;
  rmSync(tmpDir, { recursive: true, force: true });
});

async function paramOf(id: string) {
  return Promise.resolve({ id });
}

function makeMessages(prefix: string) {
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

function postReq(body: unknown): Request {
  return new Request('http://test/api/conversations', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/conversations — solo', () => {
  it('resolves the persona\'s solo conversation, creating one on first call', async () => {
    const res = await POST(postReq({ kind: 'solo', persona: 'paulg' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { conversation: { id: string; kind: string } };
    expect(body.conversation.kind).toBe('solo');
    expect(body.conversation.id).toMatch(/^[0-9a-f-]+$/);
  });

  it('is idempotent — same persona returns the same conversation', async () => {
    const a = await POST(postReq({ kind: 'solo', persona: 'sama' }));
    const b = await POST(postReq({ kind: 'solo', persona: 'sama' }));
    const aBody = (await a.json()) as { conversation: { id: string } };
    const bBody = (await b.json()) as { conversation: { id: string } };
    expect(bBody.conversation.id).toBe(aBody.conversation.id);
  });
});

describe('POST /api/conversations — roundtable', () => {
  it('creates a fresh roundtable with initial participants', async () => {
    const res = await POST(
      postReq({ kind: 'roundtable', participants: ['paulg', 'sama'] }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { conversation: { id: string; kind: string } };
    expect(body.conversation.kind).toBe('roundtable');
  });

  it('two calls produce two distinct conversations', async () => {
    const a = await POST(
      postReq({ kind: 'roundtable', participants: ['x', 'y'] }),
    );
    const b = await POST(
      postReq({ kind: 'roundtable', participants: ['x', 'y'] }),
    );
    const aBody = (await a.json()) as { conversation: { id: string } };
    const bBody = (await b.json()) as { conversation: { id: string } };
    expect(bBody.conversation.id).not.toBe(aBody.conversation.id);
  });

  it('returns 400 for empty participants', async () => {
    const res = await POST(postReq({ kind: 'roundtable', participants: [] }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/conversations/[id]', () => {
  it('loads a conversation with participants + messages', async () => {
    const created = await POST(
      postReq({ kind: 'roundtable', participants: ['paulg', 'sama'] }),
    );
    const { conversation } = (await created.json()) as { conversation: { id: string } };

    // Seed some messages
    await PUT_ID(
      new Request(`http://test/api/conversations/${conversation.id}`, {
        method: 'PUT',
        body: JSON.stringify({ messages: makeMessages('seed') }),
      }),
      { params: paramOf(conversation.id) },
    );

    const res = await GET_ID(
      new Request(`http://test/api/conversations/${conversation.id}`),
      { params: paramOf(conversation.id) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      conversation: { id: string };
      participants: string[];
      messages: { text: string }[];
    };
    expect(body.conversation.id).toBe(conversation.id);
    expect(body.participants).toEqual(['paulg', 'sama']);
    expect(body.messages).toHaveLength(2);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await GET_ID(
      new Request('http://test/api/conversations/nope'),
      { params: paramOf('nope') },
    );
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/conversations/[id]', () => {
  it('saves messages and overwrites on subsequent PUT', async () => {
    const created = await POST(
      postReq({ kind: 'roundtable', participants: ['paulg'] }),
    );
    const { conversation } = (await created.json()) as { conversation: { id: string } };

    await PUT_ID(
      new Request(`http://test/api/conversations/${conversation.id}`, {
        method: 'PUT',
        body: JSON.stringify({ messages: makeMessages('first') }),
      }),
      { params: paramOf(conversation.id) },
    );
    await PUT_ID(
      new Request(`http://test/api/conversations/${conversation.id}`, {
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
      { params: paramOf(conversation.id) },
    );
    const get = await GET_ID(
      new Request(`http://test/api/conversations/${conversation.id}`),
      { params: paramOf(conversation.id) },
    );
    const body = (await get.json()) as { messages: { text: string }[] };
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].text).toBe('replaced');
  });

  it('returns 404 for unknown id', async () => {
    const res = await PUT_ID(
      new Request('http://test/api/conversations/nope', {
        method: 'PUT',
        body: JSON.stringify({ messages: [] }),
      }),
      { params: paramOf('nope') },
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 for malformed body', async () => {
    const created = await POST(
      postReq({ kind: 'roundtable', participants: ['paulg'] }),
    );
    const { conversation } = (await created.json()) as { conversation: { id: string } };
    const res = await PUT_ID(
      new Request(`http://test/api/conversations/${conversation.id}`, {
        method: 'PUT',
        body: 'not json',
      }),
      { params: paramOf(conversation.id) },
    );
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/conversations/[id]', () => {
  it('clears messages but keeps the conversation', async () => {
    const created = await POST(
      postReq({ kind: 'roundtable', participants: ['paulg'] }),
    );
    const { conversation } = (await created.json()) as { conversation: { id: string } };
    await PUT_ID(
      new Request(`http://test/api/conversations/${conversation.id}`, {
        method: 'PUT',
        body: JSON.stringify({ messages: makeMessages('seed') }),
      }),
      { params: paramOf(conversation.id) },
    );
    const del = await DELETE_ID(
      new Request(`http://test/api/conversations/${conversation.id}`, {
        method: 'DELETE',
      }),
      { params: paramOf(conversation.id) },
    );
    expect(del.status).toBe(204);

    const get = await GET_ID(
      new Request(`http://test/api/conversations/${conversation.id}`),
      { params: paramOf(conversation.id) },
    );
    expect(get.status).toBe(200); // conversation still exists
    const body = (await get.json()) as { messages: unknown[] };
    expect(body.messages).toEqual([]);
  });

  it('returns 404 for unknown id', async () => {
    const res = await DELETE_ID(
      new Request('http://test/api/conversations/nope', { method: 'DELETE' }),
      { params: paramOf('nope') },
    );
    expect(res.status).toBe(404);
  });
});

describe('participants endpoint', () => {
  it('addParticipant: a new persona joins without forking the conversation', async () => {
    const created = await POST(
      postReq({ kind: 'roundtable', participants: ['paulg', 'sama'] }),
    );
    const { conversation } = (await created.json()) as { conversation: { id: string } };

    // Seed messages from the original lineup
    await PUT_ID(
      new Request(`http://test/api/conversations/${conversation.id}`, {
        method: 'PUT',
        body: JSON.stringify({ messages: makeMessages('initial') }),
      }),
      { params: paramOf(conversation.id) },
    );

    const res = await POST_PARTICIPANT(
      new Request(`http://test/api/conversations/${conversation.id}/participants`, {
        method: 'POST',
        body: JSON.stringify({ username: 'naval' }),
      }),
      { params: paramOf(conversation.id) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { participants: string[] };
    expect(body.participants).toEqual(['paulg', 'sama', 'naval']);

    // Crucial regression check: the conversation kept the original messages.
    // The old key-based model would have lost or duplicated these.
    const get = await GET_ID(
      new Request(`http://test/api/conversations/${conversation.id}`),
      { params: paramOf(conversation.id) },
    );
    const getBody = (await get.json()) as { messages: unknown[] };
    expect(getBody.messages).toHaveLength(2);
  });

  it('addParticipant on a solo conversation returns 400', async () => {
    const solo = await POST(postReq({ kind: 'solo', persona: 'paulg' }));
    const { conversation } = (await solo.json()) as { conversation: { id: string } };
    const res = await POST_PARTICIPANT(
      new Request(`http://test/api/conversations/${conversation.id}/participants`, {
        method: 'POST',
        body: JSON.stringify({ username: 'sama' }),
      }),
      { params: paramOf(conversation.id) },
    );
    expect(res.status).toBe(400);
  });

  it('removeParticipant marks left_at without dropping history', async () => {
    const created = await POST(
      postReq({ kind: 'roundtable', participants: ['paulg', 'sama'] }),
    );
    const { conversation } = (await created.json()) as { conversation: { id: string } };
    await PUT_ID(
      new Request(`http://test/api/conversations/${conversation.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          messages: [
            {
              id: 'sam-said',
              role: 'assistant' as const,
              speaker: 'sama',
              text: 'leaving soon',
              metadata: null,
            },
          ],
        }),
      }),
      { params: paramOf(conversation.id) },
    );

    const res = await DELETE_PARTICIPANT(
      new Request(
        `http://test/api/conversations/${conversation.id}/participants?username=sama`,
        { method: 'DELETE' },
      ),
      { params: paramOf(conversation.id) },
    );
    expect(res.status).toBe(200);

    const get = await GET_ID(
      new Request(`http://test/api/conversations/${conversation.id}`),
      { params: paramOf(conversation.id) },
    );
    const body = (await get.json()) as {
      participants: string[];
      messages: { text: string }[];
    };
    expect(body.participants).toEqual(['paulg']);
    expect(body.messages).toHaveLength(1); // sam's past message kept
  });
});
