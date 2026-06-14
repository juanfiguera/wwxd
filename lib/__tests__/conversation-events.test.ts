import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  appendEvent,
  createRoundtable,
  deleteConversation,
  getOrCreateSolo,
  loadEvents,
} from '../db';

let tmpDir: string;
let originalEnv: string | undefined;

beforeEach(async () => {
  tmpDir = await mkdtemp(resolve(tmpdir(), 'wwxd-events-'));
  originalEnv = process.env.WWXD_DB_PATH;
  process.env.WWXD_DB_PATH = resolve(tmpDir, 'wwxd.db');
});

afterEach(async () => {
  if (originalEnv === undefined) delete process.env.WWXD_DB_PATH;
  else process.env.WWXD_DB_PATH = originalEnv;
  await rm(tmpDir, { recursive: true, force: true });
});

describe('appendEvent', () => {
  it('persists the row and returns it with id + createdAt populated', () => {
    const conv = getOrCreateSolo('paulg');
    const event = appendEvent({
      conversationId: conv.id,
      ordinal: 0,
      kind: 'retrieval',
      speaker: 'paulg',
      payload: { top_k: 20, hits: 12 },
    });
    expect(event.id).toBeGreaterThan(0);
    expect(event.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(event.conversationId).toBe(conv.id);
    expect(event.speaker).toBe('paulg');
    expect(event.payload).toEqual({ top_k: 20, hits: 12 });
  });

  it('treats missing speaker + payload as null', () => {
    const conv = getOrCreateSolo('naval');
    const event = appendEvent({
      conversationId: conv.id,
      ordinal: 0,
      kind: 'persona.started',
    });
    expect(event.speaker).toBeNull();
    expect(event.payload).toBeNull();
  });

  it('round-trips structured JSON payloads', () => {
    const conv = getOrCreateSolo('paulg');
    const payload = {
      decision: 'NO' as const,
      reason: 'Nothing to add right now.',
      tokensUsed: 42,
      nested: { a: 1, b: [true, false, null] },
    };
    const written = appendEvent({
      conversationId: conv.id,
      ordinal: 1,
      kind: 'gate.passed',
      speaker: 'paulg',
      payload,
    });
    const [read] = loadEvents(conv.id);
    expect(read.payload).toEqual(payload);
    expect(read.id).toBe(written.id);
  });
});

describe('loadEvents', () => {
  it('returns events ordered by (ordinal ASC, id ASC)', () => {
    const conv = createRoundtable(['paulg', 'naval', 'sama']);
    appendEvent({ conversationId: conv.id, ordinal: 1, kind: 'retrieval', speaker: 'naval' });
    appendEvent({ conversationId: conv.id, ordinal: 0, kind: 'retrieval', speaker: 'paulg' });
    appendEvent({ conversationId: conv.id, ordinal: 1, kind: 'persona.started', speaker: 'naval' });
    appendEvent({ conversationId: conv.id, ordinal: 0, kind: 'persona.started', speaker: 'paulg' });

    const events = loadEvents(conv.id);
    expect(events.map((e) => `${e.ordinal}:${e.kind}:${e.speaker}`)).toEqual([
      '0:retrieval:paulg',
      '0:persona.started:paulg',
      '1:retrieval:naval',
      '1:persona.started:naval',
    ]);
  });

  it('returns an empty array for a conversation with no events', () => {
    const conv = getOrCreateSolo('paulg');
    expect(loadEvents(conv.id)).toEqual([]);
  });

  it('filters by kind when requested', () => {
    const conv = createRoundtable(['paulg', 'naval']);
    appendEvent({ conversationId: conv.id, ordinal: 0, kind: 'retrieval', speaker: 'paulg' });
    appendEvent({ conversationId: conv.id, ordinal: 0, kind: 'persona.started', speaker: 'paulg' });
    appendEvent({ conversationId: conv.id, ordinal: 0, kind: 'persona.completed', speaker: 'paulg' });
    appendEvent({ conversationId: conv.id, ordinal: 1, kind: 'gate.passed', speaker: 'naval' });

    const gates = loadEvents(conv.id, { kind: 'gate.passed' });
    expect(gates).toHaveLength(1);
    expect(gates[0].speaker).toBe('naval');

    const completions = loadEvents(conv.id, { kind: 'persona.completed' });
    expect(completions).toHaveLength(1);
    expect(completions[0].speaker).toBe('paulg');
  });

  it('scopes results to the requested conversation', () => {
    const a = getOrCreateSolo('paulg');
    const b = getOrCreateSolo('naval');
    appendEvent({ conversationId: a.id, ordinal: 0, kind: 'retrieval', speaker: 'paulg' });
    appendEvent({ conversationId: b.id, ordinal: 0, kind: 'retrieval', speaker: 'naval' });

    const ofA = loadEvents(a.id);
    expect(ofA).toHaveLength(1);
    expect(ofA[0].speaker).toBe('paulg');
  });
});

describe('cascading delete', () => {
  it('drops events when the parent conversation is deleted', () => {
    const conv = createRoundtable(['paulg', 'naval']);
    appendEvent({ conversationId: conv.id, ordinal: 0, kind: 'retrieval' });
    appendEvent({ conversationId: conv.id, ordinal: 1, kind: 'gate.passed', speaker: 'naval' });
    expect(loadEvents(conv.id)).toHaveLength(2);

    deleteConversation(conv.id);

    expect(loadEvents(conv.id)).toEqual([]);
  });
});
