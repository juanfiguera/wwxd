import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  createGroup,
  deleteGroup,
  getGroup,
  listGroups,
  removePersonaFromAllGroups,
  updateGroup,
} from '../groups';

let tmpDir: string;
let originalEnv: string | undefined;

beforeEach(async () => {
  tmpDir = await mkdtemp(resolve(tmpdir(), 'wwxd-groups-'));
  originalEnv = process.env.WWXD_GROUPS_PATH;
  process.env.WWXD_GROUPS_PATH = resolve(tmpDir, 'groups.json');
});

afterEach(async () => {
  if (originalEnv === undefined) delete process.env.WWXD_GROUPS_PATH;
  else process.env.WWXD_GROUPS_PATH = originalEnv;
  await rm(tmpDir, { recursive: true, force: true });
});

describe('groups CRUD', () => {
  it('returns empty list when no groups file exists', async () => {
    expect(await listGroups()).toEqual([]);
  });

  it('creates a group and lists it', async () => {
    const group = await createGroup({ name: 'Fun', personas: ['billburr', 'trevornoah'] });
    expect(group.name).toBe('Fun');
    expect(group.personas).toEqual(['billburr', 'trevornoah']);
    expect(group.id).toMatch(/^[0-9a-f-]{36}$/);

    const all = await listGroups();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(group.id);
  });

  it('persists across multiple creates', async () => {
    await createGroup({ name: 'A', personas: ['a'] });
    await createGroup({ name: 'B', personas: ['b'] });
    const all = await listGroups();
    expect(all.map((g) => g.name).sort()).toEqual(['A', 'B']);
  });

  it('trims group name', async () => {
    const group = await createGroup({ name: '  Padded  ', personas: ['a'] });
    expect(group.name).toBe('Padded');
  });

  it('returns null for missing group lookup', async () => {
    expect(await getGroup('nonexistent')).toBeNull();
  });

  it('deletes a group and returns true', async () => {
    const group = await createGroup({ name: 'Doomed', personas: ['a'] });
    expect(await deleteGroup(group.id)).toBe(true);
    expect(await listGroups()).toEqual([]);
  });

  it('returns false when deleting nonexistent group', async () => {
    expect(await deleteGroup('nope')).toBe(false);
  });

  it('updates group fields', async () => {
    const group = await createGroup({ name: 'Old', personas: ['a'] });
    await new Promise((r) => setTimeout(r, 5));
    const updated = await updateGroup(group.id, { name: 'New', personas: ['a', 'b'] });
    expect(updated?.name).toBe('New');
    expect(updated?.personas).toEqual(['a', 'b']);
    expect(updated?.updatedAt).not.toBe(group.updatedAt);
  });

  it('returns null when updating nonexistent group', async () => {
    expect(await updateGroup('nope', { name: 'x' })).toBeNull();
  });

  it('partial update only changes the field provided', async () => {
    const g = await createGroup({ name: 'Original', personas: ['a', 'b'] });
    const renamed = await updateGroup(g.id, { name: 'Renamed' });
    expect(renamed?.personas).toEqual(['a', 'b']);
    const reordered = await updateGroup(g.id, { personas: ['b', 'a'] });
    expect(reordered?.name).toBe('Renamed');
    expect(reordered?.personas).toEqual(['b', 'a']);
  });

  it('getGroup returns the right group when several exist', async () => {
    const a = await createGroup({ name: 'A', personas: ['x'] });
    await createGroup({ name: 'B', personas: ['y'] });
    const found = await getGroup(a.id);
    expect(found?.name).toBe('A');
  });
});

describe('removePersonaFromAllGroups', () => {
  it('returns 0 when no group contains the user', async () => {
    await createGroup({ name: 'Untouched', personas: ['a', 'b'] });
    expect(await removePersonaFromAllGroups('zzz')).toBe(0);
    const all = await listGroups();
    expect(all[0].personas).toEqual(['a', 'b']);
  });

  it('strips the persona from groups that still have other members', async () => {
    const g = await createGroup({ name: 'Mixed', personas: ['a', 'b', 'c'] });
    await new Promise((r) => setTimeout(r, 5));
    expect(await removePersonaFromAllGroups('b')).toBe(1);
    const after = await getGroup(g.id);
    expect(after?.personas).toEqual(['a', 'c']);
    expect(after?.updatedAt).not.toBe(g.updatedAt);
  });

  it('deletes the group entirely when removing the last member', async () => {
    await createGroup({ name: 'SoloAct', personas: ['only'] });
    await createGroup({ name: 'Keep', personas: ['only', 'other'] });
    expect(await removePersonaFromAllGroups('only')).toBe(2);
    const remaining = await listGroups();
    expect(remaining.map((g) => g.name)).toEqual(['Keep']);
    expect(remaining[0].personas).toEqual(['other']);
  });

  it('does not write when nothing changes (touched=0)', async () => {
    // Just verifying the early-return path returns the right value.
    expect(await removePersonaFromAllGroups('not-in-any')).toBe(0);
  });
});
