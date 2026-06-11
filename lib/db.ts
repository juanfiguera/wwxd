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

let dbInstance: Database.Database | null = null;
let dbInstancePath: string | null = null;

function dbPath(): string {
  if (process.env.WWXD_DB_PATH) return process.env.WWXD_DB_PATH;
  return resolve(process.cwd(), 'data', 'wwxd.db');
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
  dbInstance = db;
  dbInstancePath = path;
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      conv_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(kind, conv_key)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      speaker TEXT,
      text TEXT NOT NULL,
      metadata TEXT,
      ordinal INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, ordinal);
    CREATE INDEX IF NOT EXISTS idx_conversations_key ON conversations(kind, conv_key);

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
  results: { username?: string | null; result: unknown }[],
): string {
  const db = getDb();
  const runId = randomUUID();
  const ranAt = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(
      'INSERT INTO eval_runs(id, kind, ran_at, summary_json) VALUES (?, ?, ?, ?)',
    ).run(runId, kind, ranAt, JSON.stringify(summary));
    const insert = db.prepare(
      'INSERT INTO eval_results(id, run_id, username, result_json, ordinal) VALUES (?, ?, ?, ?, ?)',
    );
    results.forEach((r, i) => {
      insert.run(randomUUID(), runId, r.username ?? null, JSON.stringify(r.result), i);
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
          'SELECT id, kind, ran_at, summary_json FROM eval_runs WHERE kind = ? ORDER BY ran_at DESC LIMIT ?',
        )
        .all(kind, limit) as {
        id: string;
        kind: EvalRunKind;
        ran_at: string;
        summary_json: string;
      }[])
    : (db
        .prepare(
          'SELECT id, kind, ran_at, summary_json FROM eval_runs ORDER BY ran_at DESC LIMIT ?',
        )
        .all(limit) as {
        id: string;
        kind: EvalRunKind;
        ran_at: string;
        summary_json: string;
      }[]);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    ranAt: r.ran_at,
    summary: JSON.parse(r.summary_json),
  }));
}

export function getEvalRun(id: string): { run: EvalRun; results: EvalResult[] } | null {
  const db = getDb();
  const runRow = db
    .prepare('SELECT id, kind, ran_at, summary_json FROM eval_runs WHERE id = ?')
    .get(id) as { id: string; kind: EvalRunKind; ran_at: string; summary_json: string } | undefined;
  if (!runRow) return null;
  const resultRows = db
    .prepare(
      'SELECT id, run_id, username, result_json FROM eval_results WHERE run_id = ? ORDER BY ordinal ASC',
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
      kind: runRow.kind,
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

export function loadConversation(kind: ConversationKind, key: string): StoredMessage[] {
  const db = getDb();
  const conv = db
    .prepare('SELECT id FROM conversations WHERE kind = ? AND conv_key = ?')
    .get(kind, key) as { id: string } | undefined;
  if (!conv) return [];
  const rows = db
    .prepare(
      'SELECT id, role, speaker, text, metadata FROM messages WHERE conversation_id = ? ORDER BY ordinal ASC',
    )
    .all(conv.id) as {
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

export function saveConversation(
  kind: ConversationKind,
  key: string,
  messages: StoredMessage[],
): void {
  const db = getDb();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    let conv = db
      .prepare('SELECT id FROM conversations WHERE kind = ? AND conv_key = ?')
      .get(kind, key) as { id: string } | undefined;
    if (!conv) {
      const id = randomUUID();
      db.prepare(
        'INSERT INTO conversations(id, kind, conv_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).run(id, kind, key, now, now);
      conv = { id };
    } else {
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conv.id);
      db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conv.id);
    }
    const insert = db.prepare(
      'INSERT INTO messages(id, conversation_id, role, speaker, text, metadata, ordinal, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    messages.forEach((m, i) => {
      insert.run(
        m.id,
        conv!.id,
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

export function clearConversation(kind: ConversationKind, key: string): boolean {
  const db = getDb();
  const result = db
    .prepare('DELETE FROM conversations WHERE kind = ? AND conv_key = ?')
    .run(kind, key);
  return result.changes > 0;
}

export function listConversations(kind?: ConversationKind): {
  kind: ConversationKind;
  key: string;
  updatedAt: string;
  messageCount: number;
}[] {
  const db = getDb();
  const rows = kind
    ? (db
        .prepare(
          `SELECT c.kind, c.conv_key as conv_key, c.updated_at,
                  (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as message_count
           FROM conversations c WHERE c.kind = ? ORDER BY c.updated_at DESC`,
        )
        .all(kind) as {
        kind: ConversationKind;
        conv_key: string;
        updated_at: string;
        message_count: number;
      }[])
    : (db
        .prepare(
          `SELECT c.kind, c.conv_key as conv_key, c.updated_at,
                  (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as message_count
           FROM conversations c ORDER BY c.updated_at DESC`,
        )
        .all() as {
        kind: ConversationKind;
        conv_key: string;
        updated_at: string;
        message_count: number;
      }[]);
  return rows.map((r) => ({
    kind: r.kind,
    key: r.conv_key,
    updatedAt: r.updated_at,
    messageCount: r.message_count,
  }));
}
