import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { essayFileIngester } from '../ingest/essay-file';
import { loadCorpus } from '../persona';

const tmp = mkdtempSync(join(tmpdir(), 'wwxd-essays-'));
const originalCwd = process.cwd();

beforeAll(() => process.chdir(tmp));
afterAll(() => {
  process.chdir(originalCwd);
  rmSync(tmp, { recursive: true, force: true });
});

describe('essayFileIngester', () => {
  it('loads a bare array of essays from a JSON path passed as input', async () => {
    const path = resolve(tmp, 'essays-bare.json');
    await writeFile(
      path,
      JSON.stringify([
        {
          url: 'https://example.com/a',
          title: 'First',
          text: 'a'.repeat(300),
        },
        {
          url: 'https://example.com/b',
          title: 'Second',
          text: 'b'.repeat(300),
          createdAt: '2025-01-01',
        },
      ]),
    );
    const result = await essayFileIngester('alice', [path], () => {});
    expect(result.added).toBe(2);
    expect(result.total).toBe(2);
    const corpus = await loadCorpus('alice');
    expect(corpus.tweets.every((t) => t.source === 'essay')).toBe(true);
    expect(corpus.tweets.map((t) => t.title).sort()).toEqual(['First', 'Second']);
  });

  it('accepts a manifest with displayName and uses it when no prior corpus', async () => {
    const path = resolve(tmp, 'essays-manifest.json');
    await writeFile(
      path,
      JSON.stringify({
        displayName: 'Paul Graham',
        essays: [
          { url: 'https://pg.com/founders', title: 'Founders', text: 'x'.repeat(400) },
        ],
      }),
    );
    await essayFileIngester('paulg-test', [path], () => {});
    const corpus = await loadCorpus('paulg-test');
    expect(corpus.displayName).toBe('Paul Graham');
  });

  it('rejects items with short text', async () => {
    const path = resolve(tmp, 'essays-short.json');
    await writeFile(
      path,
      JSON.stringify([{ url: 'https://x.com', title: 'tiny', text: 'hi' }]),
    );
    const events: string[] = [];
    const result = await essayFileIngester('bob', [path], (e) => events.push(e.type));
    expect(result.added).toBe(0);
    expect(events).toContain('failed');
  });

  it('throws when the file is missing', async () => {
    await expect(
      essayFileIngester(
        'nobody',
        [resolve(tmp, 'nope.json')],
        () => {},
      ),
    ).rejects.toThrow(/could not read|ESSAY_FILE_PATH/);
  });

  it('throws on invalid manifest shape', async () => {
    const path = resolve(tmp, 'essays-bad.json');
    await writeFile(path, JSON.stringify({ random: 'object' }));
    await expect(essayFileIngester('eve', [path], () => {})).rejects.toThrow(
      /doesn't match the expected shape/,
    );
  });
});
