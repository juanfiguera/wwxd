import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchJson, FetchError } from '../fetch-utils';
import { subscribeToasts, toast, type ToastItem } from '../toast';

let observed: ToastItem[][] = [];
let unsubscribe: () => void = () => {};

const savedFetch = globalThis.fetch;

/** The most recent toast emitted during this test (excluding any leftover
 *  from previous tests we didn't drain). */
function latestToast(): ToastItem | undefined {
  const last = observed.at(-1);
  return last ? last[last.length - 1] : undefined;
}

beforeEach(() => {
  // Drain any active toasts from previous tests.
  observed = [];
  const tmp = subscribeToasts((items) => {
    for (const t of items) toast.dismiss(t.id);
  });
  tmp();
  unsubscribe = subscribeToasts((next) => observed.push(next));
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
});
afterEach(() => {
  unsubscribe();
  globalThis.fetch = savedFetch;
  vi.restoreAllMocks();
});

describe('fetchJson — success paths', () => {
  it('returns parsed JSON on 200', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ hello: 'world' }), { status: 200 }),
    );
    const result = await fetchJson<{ hello: string }>('/x');
    expect(result).toEqual({ hello: 'world' });
  });

  it('returns undefined on 204 No Content', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const result = await fetchJson('/x', { method: 'DELETE' });
    expect(result).toBeUndefined();
  });

  it('gracefully handles a 200 with non-JSON body', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response('not json', { status: 200 }),
    );
    const result = await fetchJson('/x');
    expect(result).toBeUndefined();
  });
});

describe('fetchJson — error paths', () => {
  it('throws FetchError on non-2xx and emits an error toast with the server message', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Bad name' }), { status: 400 }),
    );
    await expect(fetchJson('/x', { method: 'POST' })).rejects.toBeInstanceOf(FetchError);
    expect(latestToast()?.kind).toBe('error');
    expect(latestToast()?.text).toBe('Bad name');
  });

  it('falls back to a generic message when no server error key + no override', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response('plain text', { status: 503 }),
    );
    await expect(fetchJson('/x')).rejects.toBeInstanceOf(FetchError);
    expect(latestToast()?.text).toMatch(/Request failed \(503\)/);
  });

  it('uses onErrorMessage override regardless of server response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'ignored' }), { status: 500 }),
    );
    await expect(
      fetchJson('/x', { onErrorMessage: 'Friendly explanation.' }),
    ).rejects.toBeInstanceOf(FetchError);
    expect(latestToast()?.text).toBe('Friendly explanation.');
  });

  it('rethrows on network failure and emits a "network error" toast', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(fetchJson('/x')).rejects.toBeInstanceOf(TypeError);
    expect(latestToast()?.text).toMatch(/Network error/i);
  });
});

describe('FetchError', () => {
  it('carries status + body', () => {
    const err = new FetchError('boom', 422, { detail: 'no' });
    expect(err.status).toBe(422);
    expect(err.body).toEqual({ detail: 'no' });
    expect(err.message).toBe('boom');
    expect(err.name).toBe('FetchError');
  });
});
