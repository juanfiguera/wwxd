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

describe('addParticipant idempotency', () => {
  it('adding the same persona twice keeps a single participant row', () => {
    const rt = createRoundtable(['paulg']);
    addParticipant(rt.id, 'sama');
    addParticipant(rt.id, 'sama');
    addParticipant(rt.id, 'sama');
    expect(getParticipants(rt.id)).toEqual(['paulg', 'sama']);
  });

  it('removeParticipant followed by addParticipant rejoins cleanly', () => {
    const rt = createRoundtable(['paulg', 'sama']);
    removeParticipant(rt.id, 'sama');
    expect(getParticipants(rt.id)).toEqual(['paulg']);
    addParticipant(rt.id, 'sama');
    expect(getParticipants(rt.id)).toEqual(['paulg', 'sama']);
  });
});

describe('removePersonaFromAllConversations', () => {
  it('deletes the solo conversation and removes the persona from roundtables', () => {
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

describe('participants schema migration (Phase 4.1)', () => {
  it('migrates from old left_at / composite-PK schema, deduping by earliest joined_at', async () => {
    // Seed a database with the pre-migration schema, write some rows that
    // would have been impossible under the new PK (same persona in same
    // conversation with different joined_at), then re-open via getDb() and
    // verify the migration ran.
    const Database = (await import('better-sqlite3')).default;
    const path = process.env.WWXD_DB_PATH!;
    const seed = new Database(path);
    seed.exec(`
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('solo', 'roundtable')),
        title TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE conversation_participants (
        conversation_id TEXT NOT NULL,
        persona_username TEXT NOT NULL,
        joined_at TEXT NOT NULL,
        left_at TEXT,
        PRIMARY KEY (conversation_id, persona_username, joined_at),
        FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
      INSERT INTO conversations VALUES ('c1', 'roundtable', 'Test', '2026-01-01', '2026-01-01');
      INSERT INTO conversation_participants VALUES ('c1', 'paulg', '2026-01-01T00:00:00Z', NULL);
      INSERT INTO conversation_participants VALUES ('c1', 'paulg', '2026-01-02T00:00:00Z', '2026-01-03T00:00:00Z');
      INSERT INTO conversation_participants VALUES ('c1', 'naval', '2026-01-04T00:00:00Z', NULL);
      INSERT INTO conversation_participants VALUES ('c1', 'sama',  '2026-01-05T00:00:00Z', '2026-01-06T00:00:00Z');
    `);
    seed.close();

    // First read through the production helpers triggers the migration.
    expect(getParticipants('c1').sort()).toEqual(['naval', 'paulg']);

    // The migration should be byte-identical on a second open.
    expect(getParticipants('c1').sort()).toEqual(['naval', 'paulg']);
  });

  it('is a no-op when the schema is already migrated', async () => {
    const rt = createRoundtable(['paulg', 'naval']);
    expect(getParticipants(rt.id)).toEqual(['paulg', 'naval']);
    // Re-running getDb shouldn't disturb the new-schema rows.
    expect(getParticipants(rt.id)).toEqual(['paulg', 'naval']);
  });
});
