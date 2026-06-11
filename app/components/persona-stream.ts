export type ProgressEvent = {
  stage: string;
  message?: string;
  username?: string;
  type?: string;
  total?: number;
  originals?: number;
  added?: number;
  done?: number;
  start?: string;
  end?: string;
  displayName?: string;
  url?: string;
  via?: string;
  count?: number;
  videoId?: string;
  title?: string;
  chars?: number;
};

export async function* readNdjson(res: Response): AsyncGenerator<ProgressEvent> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        yield JSON.parse(line) as ProgressEvent;
      } catch {
        // ignore malformed line
      }
    }
  }
  const tail = buffer.trim();
  if (tail) {
    try {
      yield JSON.parse(tail) as ProgressEvent;
    } catch {
      // ignore
    }
  }
}

export function describe(evt: ProgressEvent): string | null {
  switch (evt.stage) {
    case 'fetch-start':
      return `Fetching tweets for @${evt.username}...`;
    case 'fetch':
      if (evt.type === 'window' && evt.start && evt.end) return `  window ${evt.start} → ${evt.end}`;
      if (evt.type === 'window') return '  fetching latest window...';
      if (evt.type === 'window-done')
        return `  +${evt.added} new (${evt.total} total, ${evt.originals} originals)`;
      if (evt.type === 'window-error') return `  window failed: ${evt.message}`;
      if (evt.type === 'saved')
        return `✓ Saved ${evt.total} tweets (${evt.originals} originals) for ${evt.displayName}`;
      return null;
    case 'essays-discover':
      return `  discovering essays from ${evt.via}: ${evt.url}`;
    case 'essays-discovered':
      return `  found ${evt.count} URL(s) from ${evt.via}`;
    case 'essays-discover-failed':
      return `  ${evt.via} discovery failed: ${evt.message}`;
    case 'essays-start':
      return `Fetching ${evt.total} essay(s) for @${evt.username}...`;
    case 'essays':
      if (evt.type === 'fetched') return `  ✓ "${evt.title}" (${evt.chars} chars)`;
      if (evt.type === 'failed') return `  ✗ ${evt.url} — ${evt.message}`;
      if (evt.type === 'saved') return `✓ Saved ${evt.total} item(s) after essays`;
      return null;
    case 'youtube-start':
      return `Fetching ${evt.total} YouTube transcript(s) for @${evt.username}...`;
    case 'youtube':
      if (evt.type === 'fetched')
        return `  ✓ ${evt.videoId} — "${evt.title}" (${evt.chars} chars)`;
      if (evt.type === 'failed') return `  ✗ ${evt.videoId} — ${evt.message}`;
      if (evt.type === 'saved') return `✓ Saved ${evt.total} item(s) after transcripts`;
      return null;
    case 'embed-start':
      return `Embedding @${evt.username}...`;
    case 'embed':
      if (evt.type === 'start') return `  embedding ${evt.total} items`;
      if (evt.type === 'batch') return `  ${evt.done}/${evt.total} embedded`;
      if (evt.type === 'saved') return `✓ Embedded ${evt.total} items`;
      return null;
    case 'created':
      // Prior-only personas skip the whole fetch/embed pipeline; the API
      // emits a single 'created' event before 'done'.
      return `Created ${evt.username} (no sources — using model knowledge).`;
    case 'done':
      return `Done — @${evt.username} is ready.`;
    case 'error':
      return `Error: ${evt.message}`;
    default:
      return null;
  }
}
