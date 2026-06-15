import { describe, expect, it } from 'vitest';
import { readSse } from '../sse-reader';

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

async function collect<T>(it: AsyncIterableIterator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe('readSse', () => {
  it('parses a single event with JSON payload', async () => {
    const stream = streamFromChunks([
      'event: text\n',
      'data: {"value":"hello"}\n',
      '\n',
    ]);
    const events = await collect(readSse(stream));
    expect(events).toEqual([{ event: 'text', data: { value: 'hello' } }]);
  });

  it('parses multiple events split across chunks', async () => {
    const stream = streamFromChunks([
      'event: meta\ndata: {"retrievedTweets":[]}\n\nevent: text\nda',
      'ta: {"value":"hi"}\n\nevent: done\n\n',
    ]);
    const events = await collect(readSse(stream));
    expect(events.map((e) => e.event)).toEqual(['meta', 'text', 'done']);
    expect(events[1].data).toEqual({ value: 'hi' });
  });

  it('joins multi-line data blocks', async () => {
    const stream = streamFromChunks([
      'event: text\n',
      'data: line one\n',
      'data: line two\n',
      '\n',
    ]);
    const events = await collect(readSse(stream));
    // JSON.parse fails so it falls back to raw string with embedded newline
    expect(events[0]).toEqual({ event: 'text', data: 'line one\nline two' });
  });

  it('flushes a trailing event with no terminator', async () => {
    const stream = streamFromChunks([
      'event: error\n',
      'data: {"message":"oops"}',
    ]);
    const events = await collect(readSse(stream));
    expect(events).toEqual([{ event: 'error', data: { message: 'oops' } }]);
  });

  it('treats events with no `event:` prefix as `message`', async () => {
    const stream = streamFromChunks(['data: {"v":1}\n\n']);
    const events = await collect(readSse(stream));
    expect(events).toEqual([{ event: 'message', data: { v: 1 } }]);
  });

  it('handles empty events (done marker)', async () => {
    const stream = streamFromChunks(['event: done\n\n']);
    const events = await collect(readSse(stream));
    expect(events).toEqual([{ event: 'done', data: null }]);
  });

  it('ignores comment lines starting with :', async () => {
    const stream = streamFromChunks([
      ': keep-alive\nevent: text\ndata: {"value":"x"}\n\n',
    ]);
    const events = await collect(readSse(stream));
    expect(events).toEqual([{ event: 'text', data: { value: 'x' } }]);
  });

  it('falls back to raw string when data is not JSON', async () => {
    const stream = streamFromChunks(['event: text\ndata: not json\n\n']);
    const events = await collect(readSse(stream));
    expect(events).toEqual([{ event: 'text', data: 'not json' }]);
  });
});
