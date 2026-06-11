import { toast } from './toast';

export class FetchError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'FetchError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Thin wrapper around `fetch` that throws on non-2xx with a structured error
 * AND surfaces an error toast. Callers usually want to await + catch only
 * if they need to take action; otherwise they can call
 * `fetchJson(url, opts).catch(() => {})` knowing the user already saw a toast.
 */
export async function fetchJson<T = unknown>(
  url: string,
  init?: RequestInit & { onErrorMessage?: string },
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    const text = init?.onErrorMessage ?? 'Network error — check your connection.';
    toast.error(text);
    throw err;
  }
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // not JSON, ignore
    }
    const serverMsg =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : null;
    const text =
      init?.onErrorMessage ?? serverMsg ?? `Request failed (${res.status}).`;
    toast.error(text);
    throw new FetchError(text, res.status, body);
  }
  // 204 No Content
  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch {
    return undefined as T;
  }
}
