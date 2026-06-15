/**
 * Tiny Server-Sent Events parser for streaming roundtable responses.
 *
 * Why not the browser's EventSource? It only supports GET; we POST.
 *
 * Each event in the wire is:
 *   event: <name>\n
 *   data: <json-string>\n
 *   \n
 *
 * Multiple `data:` lines on one event are joined by '\n' per the SSE spec.
 * We expect every payload to be JSON-encoded (even text chunks) so newlines
 * in content never collide with the line-based framing.
 */

export type SseEvent<TName extends string = string, TPayload = unknown> = {
  event: TName;
  data: TPayload;
};

export async function* readSse<T extends SseEvent>(
  body: ReadableStream<Uint8Array>,
): AsyncIterableIterator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const parsed = parseBlock(block);
        if (parsed) yield parsed as T;
      }
      if (done) break;
    }
    // Flush any trailing event without a final \n\n (server may close early).
    if (buffer.trim()) {
      const parsed = parseBlock(buffer);
      if (parsed) yield parsed as T;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseBlock(block: string): SseEvent | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    // Lines starting with ':' are SSE comments; ignore.
  }
  if (dataLines.length === 0) {
    // Empty `event: done` style — still a valid event with no payload.
    return { event, data: null };
  }
  const raw = dataLines.join('\n');
  try {
    return { event, data: JSON.parse(raw) };
  } catch {
    // Tolerate non-JSON data — surface it as a string.
    return { event, data: raw };
  }
}
