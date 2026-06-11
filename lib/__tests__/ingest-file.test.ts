import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileIngester } from '../ingest/file';
import { loadCorpus } from '../persona';

const tmp = mkdtempSync(join(tmpdir(), 'wwxd-ingest-'));
const originalCwd = process.cwd();

beforeAll(() => {
  process.chdir(tmp);
});

afterAll(() => {
  process.chdir(originalCwd);
  rmSync(tmp, { recursive: true, force: true });
});

describe('fileIngester', () => {
  it('loads a bare array of tweets from a provided filePath', async () => {
    const importPath = resolve(tmp, 'input.json');
    await writeFile(
      importPath,
      JSON.stringify([
        {
          id: '1',
          text: 'first tweet',
          createdAt: '2025-01-01T00:00:00Z',
          author: { name: 'Test User' },
        },
        {
          id: '2',
          fullText: 'second tweet (uses fullText)',
          createdAt: '2025-02-01T00:00:00Z',
          isReply: true,
        },
      ]),
    );

    const result = await fileIngester(
      'alice',
      { filePath: importPath },
      () => {},
    );
    expect(result.total).toBe(2);
    expect(result.originals).toBe(1); // tweet 2 is a reply
    expect(result.displayName).toBe('Test User');

    const corpus = await loadCorpus('alice');
    expect(corpus.tweets).toHaveLength(2);
    // Sorted desc by createdAt.
    expect(corpus.tweets[0].id).toBe('2');
    expect(corpus.tweets[1].id).toBe('1');
    // fullText was lifted into `text`.
    expect(corpus.tweets[0].text).toBe('second tweet (uses fullText)');
  });

  it('also accepts a full Corpus shape (tweets + displayName)', async () => {
    const importPath = resolve(tmp, 'corpus-import.json');
    await writeFile(
      importPath,
      JSON.stringify({
        username: 'bob',
        displayName: 'Bob Robertson',
        fetchedAt: '2025-01-01T00:00:00Z',
        tweets: [
          { id: '10', text: 'hello', createdAt: '2025-03-01T00:00:00Z' },
        ],
      }),
    );

    const result = await fileIngester(
      'bob',
      { filePath: importPath },
      () => {},
    );
    expect(result.total).toBe(1);
    expect(result.displayName).toBe('Bob Robertson');
  });

  it('merges with an existing corpus rather than overwriting', async () => {
    const importPath1 = resolve(tmp, 'first.json');
    await writeFile(
      importPath1,
      JSON.stringify([
        { id: '100', text: 'A', createdAt: '2025-01-01T00:00:00Z' },
      ]),
    );
    await fileIngester('carol', { filePath: importPath1 }, () => {});

    const importPath2 = resolve(tmp, 'second.json');
    await writeFile(
      importPath2,
      JSON.stringify([
        { id: '101', text: 'B', createdAt: '2025-02-01T00:00:00Z' },
        // duplicate id 100 — shouldn't be double-counted
        { id: '100', text: 'A updated', createdAt: '2025-01-01T00:00:00Z' },
      ]),
    );
    const result = await fileIngester('carol', { filePath: importPath2 }, () => {});

    expect(result.total).toBe(2); // 100 + 101, no duplicates
    const corpus = await loadCorpus('carol');
    // The newer pass updates the existing id.
    expect(corpus.tweets.find((t) => t.id === '100')?.text).toBe('A updated');
  });

  it('throws a helpful error when the file is missing', async () => {
    await expect(
      fileIngester(
        'nobody',
        { filePath: resolve(tmp, 'does-not-exist.json') },
        () => {},
      ),
    ).rejects.toThrow(/could not read|TWEET_FILE_PATH/);
  });

  it('throws when the file is not valid JSON', async () => {
    const importPath = resolve(tmp, 'broken.json');
    await writeFile(importPath, 'not json at all');
    await expect(
      fileIngester('dave', { filePath: importPath }, () => {}),
    ).rejects.toThrow(/not valid JSON/);
  });
});
