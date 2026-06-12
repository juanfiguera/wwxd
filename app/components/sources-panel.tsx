'use client';

export type RetrievedTweetMeta = {
  id: string;
  text: string;
  url: string;
  createdAt: string;
  source?: 'tweet' | 'essay' | 'transcript';
  title?: string;
};

// Strict ID shape: only word chars + hyphens, the format the model is taught
// to emit. Anything that doesn't match this is treated as a malformed marker
// and stripped from the rendered text so it doesn't leak as raw "[tweet:…]"
// gibberish.
const CLEAN_ID_RE = /^[\w-]+$/;
// Tolerant outer match: anything that opens with [kind: and closes with ].
// We then validate the captured inner content separately. This catches the
// real-world failure mode where a model emits something like
// "[tweet:1851205852984377643... skip]" mid-sentence — the strict pattern
// would skip it, leaving the gibberish visible to the user.
const CITATION_RE = /\[(?:tweet|essay|transcript):([^\]]+)\]/g;

export function renderCitationMarkers(
  text: string,
  defaultUsername: string,
  retrieved: RetrievedTweetMeta[],
): string {
  const urlById = new Map(retrieved.map((t) => [t.id, t.url]));
  return text.replace(CITATION_RE, (_match, inner: string) => {
    const id = inner.trim();
    // If the inner content isn't a clean id (numeric/word/hyphen only), the
    // model hallucinated or wrapped extra prose inside the marker. Strip
    // the whole marker instead of forwarding malformed output to the user.
    if (!CLEAN_ID_RE.test(id)) return '';
    const url = urlById.get(id) ?? `https://x.com/${defaultUsername}/status/${id}`;
    return ` [↗](${url})`;
  });
}

export function SourcesPanel({
  tweets,
  citedIds,
}: {
  tweets: RetrievedTweetMeta[];
  citedIds?: Set<string>;
}) {
  if (!tweets || tweets.length === 0) return null;

  const cited = citedIds && citedIds.size > 0;

  return (
    <details className="group not-prose mt-2">
      <summary className="cursor-pointer list-none font-display text-[11px] font-bold text-[var(--ink-soft)] hover:text-[var(--ink)]">
        <span className="inline-block transition-transform group-open:rotate-90">▸</span>{' '}
        {tweets.length} source{tweets.length === 1 ? '' : 's'} retrieved
        {cited && ` · ${citedIds!.size} cited`}
      </summary>
      <ul className="mt-2 space-y-1.5">
        {tweets.map((t) => {
          const isCited = citedIds?.has(t.id) ?? false;
          const date = t.createdAt
            ? new Date(t.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })
            : '';
          const kind = t.source ?? 'tweet';
          const isLongForm = kind === 'essay' || kind === 'transcript';
          const label = t.title ?? (date || kind);
          const preview = isLongForm && t.text.length > 240 ? `${t.text.slice(0, 240)}...` : t.text;
          return (
            <li
              key={t.id}
              className={`rounded-[var(--r)] border px-2.5 py-1.5 text-xs ${
                isCited
                  ? 'border-emerald-300 bg-emerald-50'
                  : 'border-[var(--line)] bg-[var(--paper-2)]'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <a
                  href={t.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 shrink truncate text-[var(--ink-soft)] hover:text-[var(--ink)] hover:underline"
                >
                  <span className="mr-1 inline-block rounded-full bg-white px-1.5 py-0.5 font-display text-[9px] font-bold uppercase tracking-wide text-[var(--ink-soft)]">
                    {kind}
                  </span>
                  {label} ↗
                </a>
                {isCited && (
                  <span className="shrink-0 rounded-full bg-emerald-500/20 px-1.5 py-0.5 font-display text-[9px] font-bold uppercase tracking-wide text-emerald-700">
                    cited
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[var(--ink-2)]">{preview}</div>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

export function extractCitedIds(text: string): Set<string> {
  const set = new Set<string>();
  const re = new RegExp(CITATION_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const id = match[1].trim();
    // Match the rendering behaviour: only valid clean ids count as citations.
    if (CLEAN_ID_RE.test(id)) set.add(id);
  }
  return set;
}
