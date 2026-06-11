import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { youtubeFileIngester } from '../ingest/youtube-file';
import { loadCorpus } from '../persona';

const tmp = mkdtempSync(join(tmpdir(), 'wwxd-youtube-'));
const originalCwd = process.cwd();

beforeAll(() => process.chdir(tmp));
afterAll(() => {
  process.chdir(originalCwd);
  rmSync(tmp, { recursive: true, force: true });
});

describe('youtubeFileIngester', () => {
  it('loads a bare array of transcripts from a JSON path', async () => {
    const path = resolve(tmp, 'yt-bare.json');
    await writeFile(
      path,
      JSON.stringify([
        { videoId: 'abc12345678', title: 'Talk 1', text: 't'.repeat(300) },
        { videoId: 'xyz98765432', title: 'Talk 2', text: 'u'.repeat(300) },
      ]),
    );
    const result = await youtubeFileIngester('lex', [path], () => {});
    expect(result.total).toBe(2);
    const corpus = await loadCorpus('lex');
    expect(corpus.tweets.every((t) => t.source === 'transcript')).toBe(true);
    expect(corpus.tweets.every((t) => t.id.startsWith('yt-'))).toBe(true);
  });

  it('accepts a manifest with displayName and videos', async () => {
    const path = resolve(tmp, 'yt-manifest.json');
    await writeFile(
      path,
      JSON.stringify({
        displayName: 'Lex Fridman',
        videos: [
          { videoId: 'abcdefghijk', title: 'Episode 1', text: 'v'.repeat(400) },
        ],
      }),
    );
    await youtubeFileIngester('lex2', [path], () => {});
    const corpus = await loadCorpus('lex2');
    expect(corpus.displayName).toBe('Lex Fridman');
    expect(corpus.tweets[0].url).toBe('https://youtu.be/abcdefghijk');
  });

  it('flags transcripts that are too short', async () => {
    const path = resolve(tmp, 'yt-short.json');
    await writeFile(
      path,
      JSON.stringify([{ videoId: 'shrt0000000', title: 'tiny', text: 'hello' }]),
    );
    const events: string[] = [];
    const result = await youtubeFileIngester('bob', [path], (e) => events.push(e.type));
    expect(result.added).toBe(0);
    expect(events).toContain('failed');
  });

  it('throws when the file is missing', async () => {
    await expect(
      youtubeFileIngester(
        'nobody',
        [resolve(tmp, 'nope.json')],
        () => {},
      ),
    ).rejects.toThrow(/could not read|YOUTUBE_FILE_PATH/);
  });

  it('throws on invalid manifest shape', async () => {
    const path = resolve(tmp, 'yt-bad.json');
    await writeFile(path, JSON.stringify({ random: 'object' }));
    await expect(youtubeFileIngester('eve', [path], () => {})).rejects.toThrow(
      /doesn't match the expected shape/,
    );
  });
});
