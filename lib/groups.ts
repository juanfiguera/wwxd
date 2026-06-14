/**
 * Phase 4.2: groups live in SQLite (groups + group_personas tables) instead
 * of data/groups.json. The schema is created in lib/db.ts initSchema.
 *
 * Backward compatibility: on first listGroups() call per process, if the
 * groups table is empty but a groups.json file exists at WWXD_GROUPS_PATH
 * (or data/groups.json), we import its rows into SQLite once. The JSON
 * file is left in place as a backup for one release; a future PR can
 * delete it once everyone has migrated.
 */

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getDb } from './db';

export type Group = {
  id: string;
  name: string;
  personas: string[];
  createdAt: string;
  updatedAt: string;
};

export class DuplicateGroupNameError extends Error {
  public readonly groupName: string;
  constructor(groupName: string) {
    super(`A group called "${groupName}" already exists. Pick a different name.`);
    this.name = 'DuplicateGroupNameError';
    this.groupName = groupName;
  }
}

function legacyGroupsPath(): string {
  if (process.env.WWXD_GROUPS_PATH) return process.env.WWXD_GROUPS_PATH;
  return resolve(process.cwd(), 'data', 'groups.json');
}

// Per-process flag: migration only runs once per database open.
let migrationChecked = false;

async function ensureLegacyJsonImported(): Promise<void> {
  if (migrationChecked) return;
  migrationChecked = true;
  const db = getDb();
  const count = db.prepare(`SELECT COUNT(*) AS n FROM groups`).get() as { n: number };
  if (count.n > 0) return;
  try {
    const raw = await readFile(legacyGroupsPath(), 'utf8');
    const parsed = JSON.parse(raw) as { groups?: Group[] };
    const rows = Array.isArray(parsed.groups) ? parsed.groups : [];
    if (rows.length === 0) return;
    const tx = db.transaction(() => {
      const insertGroup = db.prepare(
        `INSERT OR IGNORE INTO groups(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      );
      const insertPersona = db.prepare(
        `INSERT OR IGNORE INTO group_personas(group_id, persona_username, ordinal) VALUES (?, ?, ?)`,
      );
      for (const g of rows) {
        insertGroup.run(g.id, g.name, g.createdAt, g.updatedAt);
        g.personas.forEach((p, i) => insertPersona.run(g.id, p, i));
      }
    });
    tx();
  } catch {
    // No legacy file or unreadable — fine, fresh install.
  }
}

function loadGroupRow(id: string): Group | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT id, name, created_at, updated_at FROM groups WHERE id = ?`)
    .get(id) as
    | { id: string; name: string; created_at: string; updated_at: string }
    | undefined;
  if (!row) return null;
  const personas = (
    db
      .prepare(
        `SELECT persona_username FROM group_personas WHERE group_id = ? ORDER BY ordinal ASC`,
      )
      .all(id) as Array<{ persona_username: string }>
  ).map((r) => r.persona_username);
  return {
    id: row.id,
    name: row.name,
    personas,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listGroups(): Promise<Group[]> {
  await ensureLegacyJsonImported();
  const db = getDb();
  const rows = db
    .prepare(`SELECT id, name, created_at, updated_at FROM groups ORDER BY created_at ASC`)
    .all() as Array<{ id: string; name: string; created_at: string; updated_at: string }>;
  const personasStmt = db.prepare(
    `SELECT persona_username FROM group_personas WHERE group_id = ? ORDER BY ordinal ASC`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    personas: (personasStmt.all(r.id) as Array<{ persona_username: string }>).map(
      (p) => p.persona_username,
    ),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function getGroup(id: string): Promise<Group | null> {
  await ensureLegacyJsonImported();
  return loadGroupRow(id);
}

export async function createGroup(input: {
  name: string;
  personas: string[];
}): Promise<Group> {
  await ensureLegacyJsonImported();
  const db = getDb();
  const trimmedName = input.name.trim();
  const id = randomUUID();
  const now = new Date().toISOString();

  try {
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO groups(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      ).run(id, trimmedName, now, now);
      const insert = db.prepare(
        `INSERT INTO group_personas(group_id, persona_username, ordinal) VALUES (?, ?, ?)`,
      );
      input.personas.forEach((p, i) => insert.run(id, p, i));
    });
    tx();
  } catch (err) {
    if (err instanceof Error && /UNIQUE constraint failed: groups\.name/.test(err.message)) {
      throw new DuplicateGroupNameError(trimmedName);
    }
    throw err;
  }
  return {
    id,
    name: trimmedName,
    personas: [...input.personas],
    createdAt: now,
    updatedAt: now,
  };
}

export async function updateGroup(
  id: string,
  update: Partial<{ name: string; personas: string[] }>,
): Promise<Group | null> {
  await ensureLegacyJsonImported();
  const db = getDb();
  const current = loadGroupRow(id);
  if (!current) return null;
  const nextName = update.name?.trim() ?? current.name;
  const now = new Date().toISOString();

  try {
    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE groups SET name = ?, updated_at = ? WHERE id = ?`,
      ).run(nextName, now, id);
      if (update.personas) {
        db.prepare(`DELETE FROM group_personas WHERE group_id = ?`).run(id);
        const insert = db.prepare(
          `INSERT INTO group_personas(group_id, persona_username, ordinal) VALUES (?, ?, ?)`,
        );
        update.personas.forEach((p, i) => insert.run(id, p, i));
      }
    });
    tx();
  } catch (err) {
    if (err instanceof Error && /UNIQUE constraint failed: groups\.name/.test(err.message)) {
      throw new DuplicateGroupNameError(nextName);
    }
    throw err;
  }
  return loadGroupRow(id);
}

export async function deleteGroup(id: string): Promise<boolean> {
  await ensureLegacyJsonImported();
  const db = getDb();
  const result = db.prepare(`DELETE FROM groups WHERE id = ?`).run(id);
  return result.changes > 0;
}

/**
 * Strip `username` from every group's personas. Any group that ends up with
 * no members is dropped entirely. Returns the number of groups touched.
 */
export async function removePersonaFromAllGroups(username: string): Promise<number> {
  await ensureLegacyJsonImported();
  const db = getDb();
  const now = new Date().toISOString();
  let touched = 0;
  const tx = db.transaction(() => {
    // Find groups that include this persona.
    const affected = db
      .prepare(
        `SELECT DISTINCT group_id FROM group_personas WHERE persona_username = ?`,
      )
      .all(username) as Array<{ group_id: string }>;
    if (affected.length === 0) return;
    db.prepare(
      `DELETE FROM group_personas WHERE persona_username = ?`,
    ).run(username);
    const bump = db.prepare(`UPDATE groups SET updated_at = ? WHERE id = ?`);
    const remainingStmt = db.prepare(
      `SELECT COUNT(*) AS n FROM group_personas WHERE group_id = ?`,
    );
    const dropGroup = db.prepare(`DELETE FROM groups WHERE id = ?`);
    for (const { group_id } of affected) {
      touched += 1;
      const remaining = remainingStmt.get(group_id) as { n: number };
      if (remaining.n === 0) dropGroup.run(group_id);
      else bump.run(now, group_id);
    }
  });
  tx();
  return touched;
}

/**
 * Reset the per-process migration flag. Used by tests that swap databases
 * between assertions; not intended for production callers.
 */
export function __resetMigrationFlag(): void {
  migrationChecked = false;
}
