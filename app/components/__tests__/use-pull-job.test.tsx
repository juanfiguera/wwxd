import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routerRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

import { usePullJob } from '../use-pull-job';

function Harness({
  expose,
}: {
  expose: (api: ReturnType<typeof usePullJob>) => void;
}) {
  const api = usePullJob();
  expose(api);
  return null;
}

function ndjsonStream(lines: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const l of lines) controller.enqueue(encoder.encode(l + '\n'));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

const savedFetch = globalThis.fetch;

beforeEach(() => {
  routerRefresh.mockClear();
});
afterEach(() => {
  globalThis.fetch = savedFetch;
  vi.restoreAllMocks();
});

describe('usePullJob', () => {
  it('starts in idle state', () => {
    let api!: ReturnType<typeof usePullJob>;
    render(<Harness expose={(a) => (api = a)} />);
    expect(api.status.state).toBe('idle');
    expect(api.status.totalTweets).toBe(0);
    expect(api.status.lines).toEqual([]);
  });

  it('walks through fetching → embedding → done events from the stream', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      ndjsonStream([
        JSON.stringify({ stage: 'fetch-start', username: 'paulg' }),
        JSON.stringify({
          stage: 'fetch',
          type: 'saved',
          total: 100,
          originals: 80,
          displayName: 'Paul Graham',
        }),
        JSON.stringify({ stage: 'embed-start', username: 'paulg' }),
        JSON.stringify({ stage: 'embed', type: 'start', total: 100 }),
        JSON.stringify({ stage: 'embed', type: 'batch', done: 50, total: 100 }),
        JSON.stringify({ stage: 'embed', type: 'saved', total: 100 }),
        JSON.stringify({ stage: 'done', username: 'paulg' }),
      ]),
    ) as unknown as typeof fetch;

    let api!: ReturnType<typeof usePullJob>;
    const { rerender } = render(<Harness expose={(a) => (api = a)} />);

    await act(async () => {
      await api.start('paulg', { mode: 'latest' });
    });
    rerender(<Harness expose={(a) => (api = a)} />);

    expect(api.status.state).toBe('done');
    expect(api.status.username).toBe('paulg');
    expect(api.status.totalTweets).toBe(100);
    expect(api.status.originals).toBe(80);
    expect(api.status.embeddedCount).toBe(100);
    expect(api.status.embeddedTotal).toBe(100);
    expect(routerRefresh).toHaveBeenCalled();
  });

  it('flips state to "error" when the response is not ok', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid handle' }), { status: 400 }),
    ) as unknown as typeof fetch;

    let api!: ReturnType<typeof usePullJob>;
    const { rerender } = render(<Harness expose={(a) => (api = a)} />);
    await act(async () => {
      await api.start('badhandle', { mode: 'latest' });
    });
    rerender(<Harness expose={(a) => (api = a)} />);
    expect(api.status.state).toBe('error');
    expect(api.status.message).toBe('invalid handle');
  });

  it('flips state to "error" when a stream event has stage="error"', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      ndjsonStream([
        JSON.stringify({ stage: 'fetch-start', username: 'paulg' }),
        JSON.stringify({ stage: 'error', message: 'rate limited' }),
      ]),
    ) as unknown as typeof fetch;

    let api!: ReturnType<typeof usePullJob>;
    const { rerender } = render(<Harness expose={(a) => (api = a)} />);
    await act(async () => {
      await api.start('paulg', { mode: 'latest' });
    });
    rerender(<Harness expose={(a) => (api = a)} />);
    expect(api.status.state).toBe('error');
    expect(api.status.message).toBe('rate limited');
  });

  it('handles a thrown fetch (offline)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network down')) as unknown as typeof fetch;

    let api!: ReturnType<typeof usePullJob>;
    const { rerender } = render(<Harness expose={(a) => (api = a)} />);
    await act(async () => {
      await api.start('paulg', { mode: 'latest' });
    });
    rerender(<Harness expose={(a) => (api = a)} />);
    expect(api.status.state).toBe('error');
    expect(api.status.message).toBe('Network down');
  });

  it('reset() returns to idle', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      ndjsonStream([JSON.stringify({ stage: 'done', username: 'x' })]),
    ) as unknown as typeof fetch;

    let api!: ReturnType<typeof usePullJob>;
    const { rerender } = render(<Harness expose={(a) => (api = a)} />);
    await act(async () => {
      await api.start('x', { mode: 'latest' });
    });
    rerender(<Harness expose={(a) => (api = a)} />);
    expect(api.status.state).toBe('done');

    act(() => api.reset());
    rerender(<Harness expose={(a) => (api = a)} />);
    expect(api.status.state).toBe('idle');
  });

  it('includes optional sources (essays / youtube) in the POST body', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      ndjsonStream([JSON.stringify({ stage: 'done', username: 'paulg' })]),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    let api!: ReturnType<typeof usePullJob>;
    render(<Harness expose={(a) => (api = a)} />);
    await act(async () => {
      await api.start('paulg', {
        mode: 'deep',
        essayRss: 'https://blog.com/feed.xml',
        essayUrls: ['https://blog.com/a'],
        youtubeUrls: ['https://youtu.be/xyz'],
      });
    });
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.username).toBe('paulg');
    expect(body.mode).toBe('deep');
    expect(body.essayRss).toBe('https://blog.com/feed.xml');
    expect(body.essayUrls).toEqual(['https://blog.com/a']);
    expect(body.youtubeUrls).toEqual(['https://youtu.be/xyz']);
  });
});
