import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  clearConversation,
  listConversations,
  loadConversation,
  saveConversation,
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

describe('conversation persistence', () => {
  it('returns empty for unknown conversation', () => {
    expect(loadConversation('solo', 'garrytan')).toEqual([]);
  });

  it('saves and loads a conversation', () => {
    const messages = [
      msg({ id: '1', role: 'user', text: 'hi' }),
      msg({ id: '2', role: 'assistant', speaker: 'garrytan', text: 'sup' }),
    ];
    saveConversation('solo', 'garrytan', messages);
    const loaded = loadConversation('solo', 'garrytan');
    expect(loaded).toHaveLength(2);
    expect(loaded[0].text).toBe('hi');
    expect(loaded[1].speaker).toBe('garrytan');
  });

  it('replaces messages on save (idempotent for the same key)', () => {
    saveConversation('solo', 'garrytan', [msg({ id: '1', text: 'first' })]);
    saveConversation('solo', 'garrytan', [msg({ id: '2', text: 'second' })]);
    const loaded = loadConversation('solo', 'garrytan');
    expect(loaded).toHaveLength(1);
    expect(loaded[0].text).toBe('second');
  });

  it('preserves ordering', () => {
    const messages = ['a', 'b', 'c'].map((t, i) => msg({ id: `m${i}`, text: t }));
    saveConversation('solo', 'garrytan', messages);
    const loaded = loadConversation('solo', 'garrytan');
    expect(loaded.map((m) => m.text)).toEqual(['a', 'b', 'c']);
  });

  it('serializes and restores metadata', () => {
    saveConversation('solo', 'garrytan', [
      msg({
        id: '1',
        role: 'assistant',
        speaker: 'garrytan',
        text: 'hi',
        metadata: { retrievedTweets: [{ id: '999', text: 'old tweet' }] },
      }),
    ]);
    const loaded = loadConversation('solo', 'garrytan');
    expect(loaded[0].metadata).toEqual({ retrievedTweets: [{ id: '999', text: 'old tweet' }] });
  });

  it('isolates conversations by kind and key', () => {
    saveConversation('solo', 'garrytan', [msg({ id: 'a', text: 'solo' })]);
    saveConversation('roundtable', 'garrytan,paulg', [msg({ id: 'b', text: 'rt' })]);
    saveConversation('solo', 'paulg', [msg({ id: 'c', text: 'paul solo' })]);
    expect(loadConversation('solo', 'garrytan')[0].text).toBe('solo');
    expect(loadConversation('roundtable', 'garrytan,paulg')[0].text).toBe('rt');
    expect(loadConversation('solo', 'paulg')[0].text).toBe('paul solo');
  });

  it('clears a conversation', () => {
    saveConversation('solo', 'garrytan', [msg({ id: '1' })]);
    expect(clearConversation('solo', 'garrytan')).toBe(true);
    expect(loadConversation('solo', 'garrytan')).toEqual([]);
  });

  it('returns false when clearing unknown', () => {
    expect(clearConversation('solo', 'nope')).toBe(false);
  });

  it('handles empty message array (clears)', () => {
    saveConversation('solo', 'garrytan', [msg({ id: '1' })]);
    saveConversation('solo', 'garrytan', []);
    expect(loadConversation('solo', 'garrytan')).toEqual([]);
  });

  it('lists conversations sorted by updated_at desc', async () => {
    saveConversation('solo', 'a', [msg({ id: '1' })]);
    await new Promise((r) => setTimeout(r, 5));
    saveConversation('solo', 'b', [msg({ id: '2' })]);
    const all = listConversations('solo');
    expect(all.map((c) => c.key)).toEqual(['b', 'a']);
    expect(all[0].messageCount).toBe(1);
  });
});
