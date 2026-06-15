import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type ConversationKind = 'solo' | 'roundtable';

export type StoredMessage = {
  id: string;
  role: 'user' | 'assistant';
  speaker: string | null;
  text: string;
  metadata: unknown;
};

export type Conversation = {
  id: string;
  kind: ConversationKind;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ConversationWithDetails = Conversation & {
  participants: string[];
  messageCount: number;
};

/**
 * Structured events the engine emits during a turn. Append-only, never
 * mutated. Used for debugging ("why did persona X pass?"), audit trails,
 * and as the raw substrate the eval system can replay against.
 */
export type ConversationEventKind =
  | 'gate.passed'
  | 'gate.spoke'
  | 'retrieval'
  | 'risk.classified'
  | 'persona.started'
  | 'persona.completed'
  | 'persona.errored';

export type ConversationEventInput = {
  conversationId: string;
  ordinal: number;
  kind: ConversationEventKind;
  speaker?: string | null;
  payload?: unknown;
};

export type ConversationEvent = {
  id: number;
  conversationId: string;
  ordinal: number;
  kind: ConversationEventKind;
  speaker: string | null;
  payload: unknown;
  createdAt: string;
};

let dbInstance: Database.Database | null = null;
let dbInstancePath: string | null = null;

function dbPath(): string {
  if (process.env.WWXD_DB_PATH) return process.env.WWXD_DB_PATH;
  return resolve(process.cwd(), 'data', 'wwxd.db');
}

/**
 * Drop the cached connection. Used by tests that delete and recreate the
 * underlying file between assertions; not intended for production callers.
 */
export function __resetDb(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      /* fine */
    }
  }
  dbInstance = null;
  dbInstancePath = null;
}

export function getDb(): Database.Database {
  const path = dbPath();
  if (dbInstance && dbInstancePath === path) return dbInstance;
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  migrateParticipantsTable(db);
  dbInstance = db;
  dbInstancePath = path;
  return db;
}

/**
 * Phase 4.1 migration. Earlier versions had `conversation_participants` with
 * a `left_at TEXT NULL` column and a composite PK including `joined_at`,
 * speculatively supporting a "leave and rejoin" flow that never shipped.
 *
 * Drop both: only the earliest `joined_at` survives per (conversation_id,
 * persona_username) pair, and `left_at` goes away entirely. Idempotent —
 * no-op on databases that were created post-migration.
 */
function migrateParticipantsTable(db: Database.Database): void {
  const cols = db.prepare(`PRAGMA table_info(conversation_participants)`).all() as Array<{
    name: string;
  }>;
  const hasLeftAt = cols.some((c) => c.name === 'left_at');
  if (!hasLeftAt) return;

  db.exec(`
    CREATE TABLE conversation_participants_new (
      conversation_id TEXT NOT NULL,
      persona_username TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (conversation_id, persona_username),
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    INSERT INTO conversation_participants_new (conversation_id, persona_username, joined_at)
      SELECT conversation_id, persona_username, MIN(joined_at)
      FROM conversation_participants
      WHERE left_at IS NULL
      GROUP BY conversation_id, persona_username;
    DROP TABLE conversation_participants;
    ALTER TABLE conversation_participants_new RENAME TO conversation_participants;
    CREATE INDEX idx_participants_conv ON conversation_participants(conversation_id);
    CREATE INDEX idx_participants_persona ON conversation_participants(persona_username);
  `);
}

/**
 * Conversations carry a stable UUID identity. Participants are a separate
 * many-to-many relation keyed on (conversation_id, persona_username); the
 * `joined_at` column is kept purely for ordering. Removing a participant
 * is a DELETE — there's no "leave and rejoin with history" semantics.
 *
 * Messages are keyed on (id, conversation_id) so the same client-generated
 * id can in principle exist in two different conversations. This rules out
 * the class of bugs where carrying messages across conversations hits a
 * UNIQUE constraint at insert time.
 */
function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('solo', 'roundtable')),
      title TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversation_participants (
      conversation_id TEXT NOT NULL,
      persona_username TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (conversation_id, persona_username),
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_participants_conv ON conversation_participants(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_participants_persona ON conversation_participants(persona_username);
    -- We don't enforce "one solo conversation per persona" at the schema
    -- level (SQLite disallows subqueries in partial indexes). getOrCreateSolo
    -- does a find-then-insert under a transaction, which is sufficient given
    -- that there's no high-concurrency path creating solo conversations.

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      speaker TEXT,
      text TEXT NOT NULL,
      metadata TEXT,
      ordinal INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (id, conversation_id),
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, ordinal);

    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS group_personas (
      group_id TEXT NOT NULL,
      persona_username TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      PRIMARY KEY (group_id, persona_username),
      FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_group_personas_group ON group_personas(group_id, ordinal);

    CREATE TABLE IF NOT EXISTS conversation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      kind TEXT NOT NULL,
      speaker TEXT,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_events_conv ON conversation_events(conversation_id, ordinal);

    CREATE TABLE IF NOT EXISTS eval_runs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      ran_at TEXT NOT NULL,
      summary_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS eval_results (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      username TEXT,
      result_json TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      FOREIGN KEY(run_id) REFERENCES eval_runs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_eval_runs_kind_ranat ON eval_runs(kind, ran_at);
    CREATE INDEX IF NOT EXISTS idx_eval_results_run ON eval_results(run_id, ordinal);
  `);
}

function rowToConversation(r: {
  id: string;
  kind: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}): Conversation {
  return {
    id: r.id,
    kind: r.kind as ConversationKind,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ─── Conversation lifecycle ────────────────────────────────────────────────

/**
 * Resolve (or create) the single solo conversation for a persona.
 * Solo conversations are 1:1 with personas — they accumulate history over
 * time but never gain/lose participants.
 */
export function getOrCreateSolo(username: string): Conversation {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db
    .prepare(
      `SELECT c.id, c.kind, c.title, c.created_at, c.updated_at
       FROM conversations c
       JOIN conversation_participants p ON c.id = p.conversation_id
       WHERE c.kind = 'solo' AND p.persona_username = ?
       LIMIT 1`,
    )
    .get(username) as
    | { id: string; kind: string; title: string | null; created_at: string; updated_at: string }
    | undefined;
  if (existing) return rowToConversation(existing);

  const id = randomUUID();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO conversations(id, kind, title, created_at, updated_at)
       VALUES (?, 'solo', NULL, ?, ?)`,
    ).run(id, now, now);
    db.prepare(
      `INSERT INTO conversation_participants(conversation_id, persona_username, joined_at)
       VALUES (?, ?, ?)`,
    ).run(id, username, now);
  });
  tx();
  return {
    id,
    kind: 'solo',
    title: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Create a brand-new roundtable conversation with an initial set of
 * participants. Every call returns a fresh UUID — two roundtables with the
 * same lineup at different times coexist as separate conversations.
 */
export function createRoundtable(
  participants: string[],
  title?: string,
): Conversation {
  if (participants.length === 0) {
    throw new Error('Roundtable needs at least one participant.');
  }
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO conversations(id, kind, title, created_at, updated_at)
       VALUES (?, 'roundtable', ?, ?, ?)`,
    ).run(id, title ?? null, now, now);
    const insert = db.prepare(
      `INSERT INTO conversation_participants(conversation_id, persona_username, joined_at)
       VALUES (?, ?, ?)`,
    );
    // Dedupe in case the caller passed the same persona twice.
    for (const username of Array.from(new Set(participants))) {
      insert.run(id, username, now);
    }
  });
  tx();
  return {
    id,
    kind: 'roundtable',
    title: title ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

export function getConversation(id: string): Conversation | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, kind, title, created_at, updated_at FROM conversations WHERE id = ?`,
    )
    .get(id) as
    | { id: string; kind: string; title: string | null; created_at: string; updated_at: string }
    | undefined;
  return row ? rowToConversation(row) : null;
}

/** Participants of a conversation, in join order. */
export function getParticipants(conversationId: string): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT persona_username FROM conversation_participants
       WHERE conversation_id = ?
       ORDER BY joined_at ASC`,
    )
    .all(conversationId) as { persona_username: string }[];
  return rows.map((r) => r.persona_username);
}

/**
 * Add a participant to a roundtable. Idempotent — re-adding the same
 * username is a no-op (the PK collision is silently absorbed).
 */
export function addParticipant(conversationId: string, username: string): void {
  const db = getDb();
  const conv = getConversation(conversationId);
  if (!conv) throw new Error(`Conversation ${conversationId} not found`);
  if (conv.kind !== 'roundtable') {
    throw new Error('Solo conversations cannot gain participants.');
  }
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT OR IGNORE INTO conversation_participants(conversation_id, persona_username, joined_at)
         VALUES (?, ?, ?)`,
      )
      .run(conversationId, username, now);
    if (result.changes > 0) {
      db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(now, conversationId);
    }
  });
  tx();
}

/**
 * Remove a participant from a roundtable. Past messages from them stay in
 * the conversation history (those live in `messages`, not here). Idempotent.
 */
export function removeParticipant(conversationId: string, username: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const result = db
      .prepare(
        `DELETE FROM conversation_participants
         WHERE conversation_id = ? AND persona_username = ?`,
      )
      .run(conversationId, username);
    if (result.changes > 0) {
      db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(now, conversationId);
    }
  });
  tx();
}

// ─── Messages ──────────────────────────────────────────────────────────────

export function loadMessages(conversationId: string): StoredMessage[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, role, speaker, text, metadata FROM messages
       WHERE conversation_id = ? ORDER BY ordinal ASC`,
    )
    .all(conversationId) as {
    id: string;
    role: string;
    speaker: string | null;
    text: string;
    metadata: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    role: r.role as 'user' | 'assistant',
    speaker: r.speaker,
    text: r.text,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
  }));
}

/**
 * Replace all messages for a conversation. Bumps updated_at. The message
 * table's composite PK (id, conversation_id) means the same client-generated
 * id can also exist in a different conversation without collision.
 */
export function saveMessages(
  conversationId: string,
  messages: StoredMessage[],
): void {
  const db = getDb();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const found = db
      .prepare(`SELECT 1 FROM conversations WHERE id = ?`)
      .get(conversationId);
    if (!found) throw new Error(`Conversation ${conversationId} not found`);
    db.prepare(`DELETE FROM messages WHERE conversation_id = ?`).run(conversationId);
    db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(now, conversationId);
    const insert = db.prepare(
      `INSERT INTO messages(id, conversation_id, role, speaker, text, metadata, ordinal, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    messages.forEach((m, i) => {
      insert.run(
        m.id,
        conversationId,
        m.role,
        m.speaker,
        m.text,
        m.metadata != null ? JSON.stringify(m.metadata) : null,
        i,
        now,
      );
    });
  });
  tx();
}

/** Drop all messages but keep the conversation row + participants intact. */
export function clearMessages(conversationId: string): boolean {
  const db = getDb();
  const result = db
    .prepare(`DELETE FROM messages WHERE conversation_id = ?`)
    .run(conversationId);
  if (result.changes > 0) {
    const now = new Date().toISOString();
    db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(now, conversationId);
  }
  return result.changes > 0;
}

/** Delete the conversation row entirely. FK CASCADE removes participants + messages. */
export function deleteConversation(conversationId: string): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM conversations WHERE id = ?`).run(conversationId);
  return result.changes > 0;
}

// ─── Listing + persona removal ─────────────────────────────────────────────

export function listConversations(opts?: {
  kind?: ConversationKind;
  limit?: number;
}): ConversationWithDetails[] {
  const db = getDb();
  const limit = opts?.limit ?? 200;
  const baseQuery = `
    SELECT c.id, c.kind, c.title, c.created_at, c.updated_at,
           (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
    FROM conversations c
    ${opts?.kind ? 'WHERE c.kind = ?' : ''}
    ORDER BY c.updated_at DESC
    LIMIT ?
  `;
  const params = opts?.kind ? [opts.kind, limit] : [limit];
  const rows = db.prepare(baseQuery).all(...params) as {
    id: string;
    kind: string;
    title: string | null;
    created_at: string;
    updated_at: string;
    message_count: number;
  }[];

  const partsStmt = db.prepare(
    `SELECT persona_username FROM conversation_participants
     WHERE conversation_id = ?
     ORDER BY joined_at ASC`,
  );
  return rows.map((r) => {
    const participants = (
      partsStmt.all(r.id) as { persona_username: string }[]
    ).map((p) => p.persona_username);
    return {
      ...rowToConversation(r),
      participants,
      messageCount: r.message_count,
    };
  });
}

/**
 * When a persona is deleted, remove them from every conversation. Solo
 * conversations for that persona get deleted outright; roundtables keep
 * their message history (those rows live in `messages`, not here) but the
 * participant row is removed. Does NOT touch the conversations' updated_at
 * timestamps — persona deletion is a system-initiated action and shouldn't
 * promote affected conversations to the top of the "recent" rail.
 */
export function removePersonaFromAllConversations(username: string): {
  soloDeleted: boolean;
  roundtablesUpdated: number;
} {
  const db = getDb();
  let soloDeleted = false;
  let roundtablesUpdated = 0;
  const tx = db.transaction(() => {
    const solo = db
      .prepare(
        `SELECT c.id FROM conversations c
         JOIN conversation_participants p ON c.id = p.conversation_id
         WHERE c.kind = 'solo' AND p.persona_username = ?`,
      )
      .get(username) as { id: string } | undefined;
    if (solo) {
      db.prepare(`DELETE FROM conversations WHERE id = ?`).run(solo.id);
      soloDeleted = true;
    }
    const result = db
      .prepare(
        `DELETE FROM conversation_participants
         WHERE persona_username = ?
           AND conversation_id IN (SELECT id FROM conversations WHERE kind = 'roundtable')`,
      )
      .run(username);
    roundtablesUpdated = result.changes;
  });
  tx();
  return { soloDeleted, roundtablesUpdated };
}

// ─── Conversation events ───────────────────────────────────────────────────

/**
 * Append a structured event tied to a conversation turn. Caller passes the
 * `ordinal` of the message the event relates to (typically the assistant
 * message currently being produced, or the user message that triggered the
 * turn). Payload is serialized as JSON.
 *
 * Returns the row as stored, including the autoincremented `id` and the
 * `createdAt` timestamp the DB assigned.
 */
export function appendEvent(input: ConversationEventInput): ConversationEvent {
  const db = getDb();
  const createdAt = new Date().toISOString();
  const payload = JSON.stringify(input.payload ?? null);
  const result = db
    .prepare(
      `INSERT INTO conversation_events
       (conversation_id, ordinal, kind, speaker, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.conversationId,
      input.ordinal,
      input.kind,
      input.speaker ?? null,
      payload,
      createdAt,
    );
  return {
    id: Number(result.lastInsertRowid),
    conversationId: input.conversationId,
    ordinal: input.ordinal,
    kind: input.kind,
    speaker: input.speaker ?? null,
    payload: input.payload ?? null,
    createdAt,
  };
}

/**
 * Count events per conversation across the whole database. Used by the
 * trace index page to show "N events" alongside each row without firing
 * one COUNT query per row.
 */
export function countEventsByConversation(): Map<string, number> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT conversation_id AS id, COUNT(*) AS n
       FROM conversation_events
       GROUP BY conversation_id`,
    )
    .all() as Array<{ id: string; n: number }>;
  return new Map(rows.map((r) => [r.id, r.n]));
}

/**
 * Load events for a conversation. Ordered by `(ordinal ASC, id ASC)` so the
 * stream reads as a faithful replay. Optionally filtered by kind.
 */
export function loadEvents(
  conversationId: string,
  opts?: { kind?: ConversationEventKind },
): ConversationEvent[] {
  const db = getDb();
  const rows = opts?.kind
    ? db
        .prepare(
          `SELECT id, conversation_id, ordinal, kind, speaker, payload, created_at
           FROM conversation_events
           WHERE conversation_id = ? AND kind = ?
           ORDER BY ordinal ASC, id ASC`,
        )
        .all(conversationId, opts.kind)
    : db
        .prepare(
          `SELECT id, conversation_id, ordinal, kind, speaker, payload, created_at
           FROM conversation_events
           WHERE conversation_id = ?
           ORDER BY ordinal ASC, id ASC`,
        )
        .all(conversationId);
  return (rows as Array<{
    id: number;
    conversation_id: string;
    ordinal: number;
    kind: string;
    speaker: string | null;
    payload: string;
    created_at: string;
  }>).map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    ordinal: r.ordinal,
    kind: r.kind as ConversationEventKind,
    speaker: r.speaker,
    payload: JSON.parse(r.payload) as unknown,
    createdAt: r.created_at,
  }));
}

// ─── Evals (unchanged) ─────────────────────────────────────────────────────

export type EvalRunKind = 'voice' | 'discrimination';

export type EvalRun = {
  id: string;
  kind: EvalRunKind;
  ranAt: string;
  summary: unknown;
};

export type EvalResult = {
  id: string;
  runId: string;
  username: string | null;
  result: unknown;
};

export function saveEvalRun(
  kind: EvalRunKind,
  summary: unknown,
  results: { username: string | null; result: unknown }[],
): string {
  const db = getDb();
  const runId = randomUUID();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO eval_runs(id, kind, ran_at, summary_json) VALUES (?, ?, ?, ?)`,
    ).run(runId, kind, now, JSON.stringify(summary));
    const insert = db.prepare(
      `INSERT INTO eval_results(id, run_id, username, result_json, ordinal) VALUES (?, ?, ?, ?, ?)`,
    );
    results.forEach((r, i) => {
      insert.run(randomUUID(), runId, r.username, JSON.stringify(r.result), i);
    });
  });
  tx();
  return runId;
}

export function listEvalRuns(kind?: EvalRunKind, limit = 50): EvalRun[] {
  const db = getDb();
  const rows = kind
    ? (db
        .prepare(
          `SELECT id, kind, ran_at, summary_json FROM eval_runs WHERE kind = ?
           ORDER BY ran_at DESC LIMIT ?`,
        )
        .all(kind, limit) as {
        id: string;
        kind: string;
        ran_at: string;
        summary_json: string;
      }[])
    : (db
        .prepare(
          `SELECT id, kind, ran_at, summary_json FROM eval_runs
           ORDER BY ran_at DESC LIMIT ?`,
        )
        .all(limit) as {
        id: string;
        kind: string;
        ran_at: string;
        summary_json: string;
      }[]);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as EvalRunKind,
    ranAt: r.ran_at,
    summary: JSON.parse(r.summary_json),
  }));
}

export function getEvalRun(
  id: string,
): { run: EvalRun; results: EvalResult[] } | null {
  const db = getDb();
  const runRow = db
    .prepare(`SELECT id, kind, ran_at, summary_json FROM eval_runs WHERE id = ?`)
    .get(id) as
    | { id: string; kind: string; ran_at: string; summary_json: string }
    | undefined;
  if (!runRow) return null;
  const resultRows = db
    .prepare(
      `SELECT id, run_id, username, result_json FROM eval_results WHERE run_id = ?
       ORDER BY ordinal ASC`,
    )
    .all(id) as {
    id: string;
    run_id: string;
    username: string | null;
    result_json: string;
  }[];
  return {
    run: {
      id: runRow.id,
      kind: runRow.kind as EvalRunKind,
      ranAt: runRow.ran_at,
      summary: JSON.parse(runRow.summary_json),
    },
    results: resultRows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      username: r.username,
      result: JSON.parse(r.result_json),
    })),
  };
}
