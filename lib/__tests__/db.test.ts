import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  addParticipant,
  clearMessages,
  createRoundtable,
  deleteConversation,
  getConversation,
  getOrCreateSolo,
  getParticipants,
  listConversations,
  loadMessages,
  removeParticipant,
  removePersonaFromAllConversations,
  saveMessages,
  type StoredMessage,
} from '../db';

let tmpDir: string;
let originalEnv: string | undefined;

beforeEach(async () => {
  tmpDir = await mkdtemp(resolve(tmpdir(), 'wwxd-db-'));
  originalEnv = process.env.WWXD_DB_PATH;
  process.env.WWXD_DB_PATH = resolve(tmpDir, 'wwxd.db');
});

afterEach(async () => {
  if (originalEnv === undefined) delete process.env.WWXD_DB_PATH;
  else process.env.WWXD_DB_PATH = originalEnv;
  await rm(tmpDir, { recursive: true, force: true });
});

function msg(overrides: Partial<StoredMessage>): StoredMessage {
  return {
    id: 'm1',
    role: 'user',
    speaker: null,
    text: 'hello',
    metadata: null,
    ...overrides,
  };
}

describe('solo conversations', () => {
  it('creates a solo conversation on first access', () => {
    const conv = getOrCreateSolo('garrytan');
    expect(conv.kind).toBe('solo');
    expect(conv.id).toMatch(/^[0-9a-f-]+$/);
  });

  it('is idempotent — repeated calls return the same conversation', () => {
    const first = getOrCreateSolo('garrytan');
    const second = getOrCreateSolo('garrytan');
    expect(second.id).toBe(first.id);
  });

  it('has exactly one active participant', () => {
    const conv = getOrCreateSolo('garrytan');
    expect(getParticipants(conv.id)).toEqual(['garrytan']);
  });
});

describe('roundtable conversations', () => {
  it('creates a roundtable with initial participants', () => {
    const conv = createRoundtable(['paulg', 'sama']);
    expect(conv.kind).toBe('roundtable');
    expect(getParticipants(conv.id)).toEqual(['paulg', 'sama']);
  });

  it('two roundtables with the same lineup are distinct conversations', () => {
    const a = createRoundtable(['paulg', 'sama']);
    const b = createRoundtable(['paulg', 'sama']);
    expect(a.id).not.toBe(b.id);
  });

  it('rejects empty participant list', () => {
    expect(() => createRoundtable([])).toThrow();
  });

  it('dedupes participants at creation', () => {
    const conv = createRoundtable(['paulg', 'paulg', 'sama']);
    expect(getParticipants(conv.id)).toEqual(['paulg', 'sama']);
  });

  it('addParticipant appends without forking', () => {
    const conv = createRoundtable(['paulg', 'sama']);
    addParticipant(conv.id, 'naval');
    expect(getParticipants(conv.id)).toEqual(['paulg', 'sama', 'naval']);
    // Still the same conversation
    expect(getConversation(conv.id)?.id).toBe(conv.id);
  });

  it('addParticipant is idempotent for active participants', () => {
    const conv = createRoundtable(['paulg', 'sama']);
    addParticipant(conv.id, 'paulg');
    expect(getParticipants(conv.id)).toEqual(['paulg', 'sama']);
  });

  it('removeParticipant marks left_at but keeps history', () => {
    const conv = createRoundtable(['paulg', 'sama']);
    saveMessages(conv.id, [
      msg({ id: '1', role: 'assistant', speaker: 'sama', text: 'leaving soon' }),
    ]);
    removeParticipant(conv.id, 'sama');
    expect(getParticipants(conv.id)).toEqual(['paulg']);
    // Sam's past message stays
    expect(loadMessages(conv.id)).toHaveLength(1);
  });

  it('rejects addParticipant on a solo conversation', () => {
    const conv = getOrCreateSolo('paulg');
    expect(() => addParticipant(conv.id, 'sama')).toThrow();
  });
});

describe('messages — composite primary key', () => {
  it('the same client-side id can exist in two conversations', () => {
    // This is the regression test for the carry-over bug: adding a member
    // shouldn't fork the conversation, but if a caller does manage to
    // duplicate a message id across conversations, the schema permits it.
    const a = createRoundtable(['paulg']);
    const b = createRoundtable(['sama']);
    saveMessages(a.id, [msg({ id: 'same-id', text: 'in A' })]);
    saveMessages(b.id, [msg({ id: 'same-id', text: 'in B' })]);
    expect(loadMessages(a.id)[0].text).toBe('in A');
    expect(loadMessages(b.id)[0].text).toBe('in B');
  });

  it('saveMessages replaces the existing message set', () => {
    const conv = createRoundtable(['paulg']);
    saveMessages(conv.id, [msg({ id: '1', text: 'first' })]);
    saveMessages(conv.id, [msg({ id: '2', text: 'second' })]);
    expect(loadMessages(conv.id)).toHaveLength(1);
    expect(loadMessages(conv.id)[0].text).toBe('second');
  });

  it('preserves message order', () => {
    const conv = createRoundtable(['paulg']);
    saveMessages(
      conv.id,
      ['a', 'b', 'c'].map((t, i) => msg({ id: `m${i}`, text: t })),
    );
    expect(loadMessages(conv.id).map((m) => m.text)).toEqual(['a', 'b', 'c']);
  });

  it('serializes and restores metadata', () => {
    const conv = createRoundtable(['paulg']);
    saveMessages(conv.id, [
      msg({
        id: '1',
        role: 'assistant',
        speaker: 'paulg',
        text: 'hi',
        metadata: { retrievedTweets: [{ id: '999', text: 'old tweet' }] },
      }),
    ]);
    expect(loadMessages(conv.id)[0].metadata).toEqual({
      retrievedTweets: [{ id: '999', text: 'old tweet' }],
    });
  });

  it('clearMessages empties the conversation but keeps the row', () => {
    const conv = createRoundtable(['paulg']);
    saveMessages(conv.id, [msg({ id: '1' })]);
    expect(clearMessages(conv.id)).toBe(true);
    expect(loadMessages(conv.id)).toEqual([]);
    expect(getConversation(conv.id)?.id).toBe(conv.id);
  });

  it('deleteConversation removes the conversation, participants, and messages', () => {
    const conv = createRoundtable(['paulg', 'sama']);
    saveMessages(conv.id, [msg({ id: '1' })]);
    expect(deleteConversation(conv.id)).toBe(true);
    expect(getConversation(conv.id)).toBeNull();
    expect(getParticipants(conv.id)).toEqual([]);
  });
});

describe('listConversations', () => {
  it('lists conversations sorted by updated_at desc', async () => {
    const a = createRoundtable(['x']);
    saveMessages(a.id, [msg({ id: '1' })]);
    await new Promise((r) => setTimeout(r, 5));
    const b = createRoundtable(['y']);
    saveMessages(b.id, [msg({ id: '2' })]);
    const all = listConversations({ kind: 'roundtable' });
    expect(all.map((c) => c.id)).toEqual([b.id, a.id]);
    expect(all[0].messageCount).toBe(1);
  });

  it('returns current participants for each conversation', () => {
    const conv = createRoundtable(['paulg', 'sama']);
    saveMessages(conv.id, [msg({ id: '1' })]);
    addParticipant(conv.id, 'naval');
    removeParticipant(conv.id, 'sama');
    const all = listConversations({ kind: 'roundtable' });
    expect(all[0].participants).toEqual(['paulg', 'naval']);
  });

  it('filters by kind when requested', () => {
    getOrCreateSolo('paulg');
    createRoundtable(['x', 'y']);
    const solos = listConversations({ kind: 'solo' });
    const rounds = listConversations({ kind: 'roundtable' });
    expect(solos).toHaveLength(1);
    expect(rounds).toHaveLength(1);
  });
});

describe('removePersonaFromAllConversations', () => {
  it('deletes the solo conversation and stamps left_at on roundtables', () => {
    const solo = getOrCreateSolo('paulg');
    saveMessages(solo.id, [msg({ id: '1' })]);
    const rt = createRoundtable(['paulg', 'sama']);
    saveMessages(rt.id, [
      msg({ id: '2', role: 'assistant', speaker: 'paulg', text: 'hey' }),
    ]);
    const summary = removePersonaFromAllConversations('paulg');
    expect(summary.soloDeleted).toBe(true);
    expect(summary.roundtablesUpdated).toBe(1);
    expect(getConversation(solo.id)).toBeNull();
    // Roundtable conversation persists with sam as active participant only
    expect(getParticipants(rt.id)).toEqual(['sama']);
    // paulg's past message is kept (history)
    expect(loadMessages(rt.id)).toHaveLength(1);
  });
});
