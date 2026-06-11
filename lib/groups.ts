import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export type Group = {
  id: string;
  name: string;
  personas: string[];
  createdAt: string;
  updatedAt: string;
};

type GroupsFile = { groups: Group[] };

function groupsPath(): string {
  if (process.env.WWXD_GROUPS_PATH) return process.env.WWXD_GROUPS_PATH;
  return resolve(process.cwd(), 'data', 'groups.json');
}

export async function listGroups(): Promise<Group[]> {
  try {
    const raw = await readFile(groupsPath(), 'utf8');
    const data = JSON.parse(raw) as GroupsFile;
    return Array.isArray(data.groups) ? data.groups : [];
  } catch {
    return [];
  }
}

async function writeGroups(groups: Group[]): Promise<void> {
  const p = groupsPath();
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify({ groups }, null, 2), 'utf8');
}

export async function createGroup(input: {
  name: string;
  personas: string[];
}): Promise<Group> {
  const groups = await listGroups();
  const now = new Date().toISOString();
  const group: Group = {
    id: randomUUID(),
    name: input.name.trim(),
    personas: [...input.personas],
    createdAt: now,
    updatedAt: now,
  };
  groups.push(group);
  await writeGroups(groups);
  return group;
}

export async function deleteGroup(id: string): Promise<boolean> {
  const groups = await listGroups();
  const next = groups.filter((g) => g.id !== id);
  if (next.length === groups.length) return false;
  await writeGroups(next);
  return true;
}

export async function updateGroup(
  id: string,
  update: Partial<{ name: string; personas: string[] }>,
): Promise<Group | null> {
  const groups = await listGroups();
  const idx = groups.findIndex((g) => g.id === id);
  if (idx === -1) return null;
  const current = groups[idx];
  const updated: Group = {
    ...current,
    name: update.name?.trim() ?? current.name,
    personas: update.personas ? [...update.personas] : current.personas,
    updatedAt: new Date().toISOString(),
  };
  groups[idx] = updated;
  await writeGroups(groups);
  return updated;
}

export async function getGroup(id: string): Promise<Group | null> {
  const groups = await listGroups();
  return groups.find((g) => g.id === id) ?? null;
}

/**
 * Strip `username` from every group's personas array. Any group that ends up
 * with no members is removed entirely. Returns the number of groups touched
 * (modified or deleted).
 */
export async function removePersonaFromAllGroups(username: string): Promise<number> {
  const groups = await listGroups();
  let touched = 0;
  const next: Group[] = [];
  const now = new Date().toISOString();
  for (const g of groups) {
    if (!g.personas.includes(username)) {
      next.push(g);
      continue;
    }
    touched += 1;
    const remaining = g.personas.filter((p) => p !== username);
    if (remaining.length === 0) continue; // drop empty group
    next.push({ ...g, personas: remaining, updatedAt: now });
  }
  if (touched > 0) await writeGroups(next);
  return touched;
}
