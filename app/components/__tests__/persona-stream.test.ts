import { describe, expect, it } from 'vitest';
import { describe as describeEvent, readNdjson, type ProgressEvent } from '../persona-stream';

function bodyFromString(s: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(s));
      controller.close();
    },
  });
  return new Response(stream);
}

function bodyFromChunks(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i++]));
    },
  });
  return new Response(stream);
}

async function collect(res: Response): Promise<ProgressEvent[]> {
  const out: ProgressEvent[] = [];
  for await (const e of readNdjson(res)) out.push(e);
  return out;
}

describe('readNdjson', () => {
  it('yields each newline-delimited JSON object', async () => {
    const res = bodyFromString(
      JSON.stringify({ stage: 'fetch-start', username: 'paulg' }) +
        '\n' +
        JSON.stringify({ stage: 'done', username: 'paulg' }) +
        '\n',
    );
    const events = await collect(res);
    expect(events).toEqual([
      { stage: 'fetch-start', username: 'paulg' },
      { stage: 'done', username: 'paulg' },
    ]);
  });

  it('handles a final line without trailing newline', async () => {
    const res = bodyFromString(
      JSON.stringify({ stage: 'one' }) + '\n' + JSON.stringify({ stage: 'two' }),
    );
    const events = await collect(res);
    expect(events.map((e) => e.stage)).toEqual(['one', 'two']);
  });

  it('skips malformed lines instead of throwing', async () => {
    const res = bodyFromString(
      JSON.stringify({ stage: 'good' }) +
        '\n' +
        'this is not json\n' +
        JSON.stringify({ stage: 'also-good' }) +
        '\n',
    );
    const events = await collect(res);
    expect(events.map((e) => e.stage)).toEqual(['good', 'also-good']);
  });

  it('handles JSON split across multiple stream chunks', async () => {
    const evt = JSON.stringify({ stage: 'embed', type: 'batch', done: 5, total: 10 });
    const res = bodyFromChunks([evt.slice(0, 10), evt.slice(10) + '\n']);
    const events = await collect(res);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ stage: 'embed', type: 'batch', done: 5, total: 10 });
  });

  it('returns immediately if the response has no body', async () => {
    const res = new Response(null);
    const events = await collect(res);
    expect(events).toEqual([]);
  });
});

describe('describe', () => {
  it('describes fetch-start with the username', () => {
    expect(
      describeEvent({ stage: 'fetch-start', username: 'paulg' }),
    ).toMatch(/Fetching tweets for @paulg/);
  });

  it('describes a window with start/end dates', () => {
    expect(
      describeEvent({ stage: 'fetch', type: 'window', start: '2025-01', end: '2025-06' }),
    ).toContain('window 2025-01 → 2025-06');
  });

  it('describes window-done with counts', () => {
    expect(
      describeEvent({
        stage: 'fetch',
        type: 'window-done',
        added: 12,
        total: 100,
        originals: 80,
      }),
    ).toMatch(/\+12 new \(100 total, 80 originals\)/);
  });

  it('describes window-error with the message', () => {
    expect(
      describeEvent({ stage: 'fetch', type: 'window-error', message: 'rate limited' }),
    ).toContain('rate limited');
  });

  it('describes the embedding stages', () => {
    expect(describeEvent({ stage: 'embed-start', username: 'x' })).toMatch(/Embedding/);
    expect(describeEvent({ stage: 'embed', type: 'start', total: 100 })).toContain('100');
    expect(describeEvent({ stage: 'embed', type: 'batch', done: 30, total: 100 })).toContain(
      '30/100',
    );
    expect(describeEvent({ stage: 'embed', type: 'saved', total: 100 })).toMatch(/Embedded 100/);
  });

  it('describes essays fetched / failed / saved', () => {
    expect(
      describeEvent({ stage: 'essays', type: 'fetched', title: 'Founder Mode', chars: 1200 }),
    ).toContain('Founder Mode');
    expect(
      describeEvent({ stage: 'essays', type: 'failed', url: 'https://x.com', message: 'oops' }),
    ).toContain('oops');
    expect(describeEvent({ stage: 'essays', type: 'saved', total: 5 })).toMatch(/5 item/);
  });

  it('describes youtube fetched/failed/saved', () => {
    expect(
      describeEvent({
        stage: 'youtube',
        type: 'fetched',
        videoId: 'abc',
        title: 'Talk',
        chars: 800,
      }),
    ).toContain('abc');
    expect(
      describeEvent({ stage: 'youtube', type: 'failed', videoId: 'bad', message: 'no captions' }),
    ).toContain('no captions');
  });

  it('describes done + error', () => {
    expect(describeEvent({ stage: 'done', username: 'alice' })).toContain('alice');
    expect(describeEvent({ stage: 'error', message: 'fatal' })).toContain('fatal');
  });

  it('returns null for unknown stages', () => {
    expect(describeEvent({ stage: 'unknown' } as unknown as ProgressEvent)).toBeNull();
  });
});
