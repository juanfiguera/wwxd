'use client';

import { useEffect, useState } from 'react';
import { PullProgress } from './pull-progress';
import { usePullJob } from './use-pull-job';

type HandleMode = 'latest' | 'deep';
type Tab = 'handle' | 'name';

type Disambiguation = {
  canonical: string;
  who: string;
  confidence: 'high' | 'low' | 'unknown';
};

function splitLines(raw: string): string[] {
  return raw
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Turn a free-form display name into a route/file-safe slug:
 *   "Steve Jobs"     → "steve-jobs"
 *   "Marie Kondo"    → "marie-kondo"
 *   "François Hollande" → "francois-hollande"
 *
 * Falls within the API's relaxed regex (`/^[a-zA-Z0-9_-]+$/`) and the 40-char
 * cap. Returns "" if the name is empty after normalization so callers can
 * bail out early.
 */
function slugify(name: string): string {
  return name
    .normalize('NFD')
    // U+0300-U+036F are combining diacritical marks; NFD splits "é" into
    // "e" + this range, so stripping the range leaves the base letter.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function AddPersona() {
  const [tab, setTab] = useState<Tab>('handle');

  // ── Handle tab state ──────────────────────────────────────────────────────
  const [username, setUsername] = useState('');
  const [handleMode, setHandleMode] = useState<HandleMode>('latest');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [essayRss, setEssayRss] = useState('');
  const [essaySitemap, setEssaySitemap] = useState('');
  const [essayUrlsRaw, setEssayUrlsRaw] = useState('');
  const [youtubeUrlsRaw, setYoutubeUrlsRaw] = useState('');

  // ── Name tab state ────────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [disambig, setDisambig] = useState<Disambiguation | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);

  const { status, start, reset } = usePullJob();
  const isRunning = status.state === 'running';

  // Debounced disambiguation. Fires 600ms after the user stops typing in the
  // Name tab. Cancels in flight calls when the input changes again.
  useEffect(() => {
    if (tab !== 'name') return;
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setDisambig(null);
      setIsLookingUp(false);
      return;
    }
    setIsLookingUp(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/personas/disambiguate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: trimmed }),
          signal: controller.signal,
        });
        if (!res.ok) {
          setDisambig(null);
          return;
        }
        const data = (await res.json()) as Disambiguation;
        setDisambig(data);
      } catch {
        // Aborted by the next keystroke or network failure — ignore.
      } finally {
        setIsLookingUp(false);
      }
    }, 600);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [tab, name]);

  async function onSubmitHandle(e: React.FormEvent) {
    e.preventDefault();
    const handle = username.trim().replace(/^@/, '');
    if (!handle || isRunning) return;
    await start(handle, {
      mode: handleMode,
      essayRss: essayRss.trim() || undefined,
      essaySitemap: essaySitemap.trim() || undefined,
      essayUrls: splitLines(essayUrlsRaw),
      youtubeUrls: splitLines(youtubeUrlsRaw),
    });
  }

  async function onSubmitName(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || isRunning) return;
    // High-confidence disambiguation wins — model spell-corrected and confirmed.
    // Low/unknown fall back to the user's input so they can still create a
    // persona for someone the model didn't recognize.
    const displayName =
      disambig?.confidence === 'high' && disambig.canonical
        ? disambig.canonical
        : trimmed;
    const bio = disambig?.who || undefined;
    const slug = slugify(displayName);
    if (!slug) return;
    await start(slug, { mode: 'prior-only', displayName, bio });
  }

  function onReset() {
    reset();
    setUsername('');
    setHandleMode('latest');
    setEssayRss('');
    setEssaySitemap('');
    setEssayUrlsRaw('');
    setYoutubeUrlsRaw('');
    setShowAdvanced(false);
    setName('');
    setDisambig(null);
  }

  const tabBlurb =
    tab === 'handle'
      ? "Paste any X handle. We'll pull their tweets, optionally essays + transcripts, then embed everything."
      : "Type a name. We use the model's training knowledge of them. No tweets, no embeddings — replies won't have citations.";

  return (
    <div className="rounded-[var(--r-lg)] border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-sm)]">
      <h2 className="font-display text-base font-extrabold tracking-tight text-[var(--ink)]">
        Add a persona
      </h2>

      {/* Tab toggle */}
      <div
        role="tablist"
        aria-label="persona source"
        className="mt-2 inline-flex rounded-full border border-[var(--line)] bg-white p-0.5 text-xs font-display font-bold"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'handle'}
          onClick={() => setTab('handle')}
          disabled={isRunning}
          className={`rounded-full px-3 py-1.5 transition ${
            tab === 'handle'
              ? 'bg-[var(--ink)] text-white'
              : 'text-[var(--ink-soft)] hover:text-[var(--ink)]'
          }`}
        >
          X handle
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'name'}
          onClick={() => setTab('name')}
          disabled={isRunning}
          className={`rounded-full px-3 py-1.5 transition ${
            tab === 'name'
              ? 'bg-[var(--ink)] text-white'
              : 'text-[var(--ink-soft)] hover:text-[var(--ink)]'
          }`}
        >
          Name anyone
        </button>
      </div>

      <p className="mt-2 text-xs text-[var(--ink-soft)]">{tabBlurb}</p>

      {tab === 'handle' && (
        <>
          <form onSubmit={onSubmitHandle} className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex min-w-[180px] flex-1 items-center rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm focus-within:border-[var(--ink)]">
              <span className="text-[var(--ink-faint)]">@</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="handle"
                disabled={isRunning}
                className="ml-1 flex-1 bg-transparent text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)] disabled:opacity-50"
              />
            </div>

            <div
              role="radiogroup"
              aria-label="pull mode"
              className="flex rounded-full border border-[var(--line)] bg-white p-0.5 text-xs font-display font-bold"
            >
              <button
                type="button"
                role="radio"
                aria-checked={handleMode === 'latest'}
                onClick={() => setHandleMode('latest')}
                disabled={isRunning}
                className={`rounded-full px-3 py-1.5 transition ${
                  handleMode === 'latest'
                    ? 'bg-[var(--ink)] text-white'
                    : 'text-[var(--ink-soft)] hover:text-[var(--ink)]'
                }`}
                title="~850 most recent tweets, ~1 minute"
              >
                latest
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={handleMode === 'deep'}
                onClick={() => setHandleMode('deep')}
                disabled={isRunning}
                className={`rounded-full px-3 py-1.5 transition ${
                  handleMode === 'deep'
                    ? 'bg-[var(--ink)] text-white'
                    : 'text-[var(--ink-soft)] hover:text-[var(--ink)]'
                }`}
                title="walks back in 6-month windows to 2010, 20-30 min, $5-12"
              >
                full history
              </button>
            </div>

            <button
              type="submit"
              disabled={isRunning || !username.trim()}
              className="rounded-full bg-[var(--ink)] px-4 py-2 font-display text-sm font-bold text-white transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-sm)] disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
            >
              {isRunning ? 'Working...' : 'Add'}
            </button>
          </form>

          <details
            className="mt-3"
            open={showAdvanced}
            onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
          >
            <summary className="cursor-pointer text-[11px] font-display font-bold text-[var(--ink-soft)] hover:text-[var(--ink)]">
              <span className="inline-block transition-transform group-open:rotate-90">▸</span>{' '}
              essays + YouTube (optional)
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-xs text-[var(--ink-soft)]">
                essay RSS feed
                <input
                  type="url"
                  value={essayRss}
                  onChange={(e) => setEssayRss(e.target.value)}
                  placeholder="https://example.com/feed.xml"
                  disabled={isRunning}
                  className="mt-1 block w-full rounded-[var(--r)] border border-[var(--line)] bg-white px-3 py-1.5 text-xs text-[var(--ink)] outline-none focus:border-[var(--ink)]"
                />
              </label>
              <label className="block text-xs text-[var(--ink-soft)]">
                essay sitemap
                <input
                  type="url"
                  value={essaySitemap}
                  onChange={(e) => setEssaySitemap(e.target.value)}
                  placeholder="https://example.com/sitemap.xml"
                  disabled={isRunning}
                  className="mt-1 block w-full rounded-[var(--r)] border border-[var(--line)] bg-white px-3 py-1.5 text-xs text-[var(--ink)] outline-none focus:border-[var(--ink)]"
                />
              </label>
              <label className="block text-xs text-[var(--ink-soft)] sm:col-span-2">
                essay URLs (one per line or comma-separated)
                <textarea
                  value={essayUrlsRaw}
                  onChange={(e) => setEssayUrlsRaw(e.target.value)}
                  placeholder="https://paulgraham.com/founders.html"
                  disabled={isRunning}
                  rows={3}
                  className="mt-1 block w-full rounded-[var(--r)] border border-[var(--line)] bg-white px-3 py-1.5 text-xs text-[var(--ink)] outline-none focus:border-[var(--ink)]"
                />
              </label>
              <label className="block text-xs text-[var(--ink-soft)] sm:col-span-2">
                YouTube URLs or video IDs (one per line or comma-separated)
                <textarea
                  value={youtubeUrlsRaw}
                  onChange={(e) => setYoutubeUrlsRaw(e.target.value)}
                  placeholder="https://youtu.be/dQw4w9WgXcQ"
                  disabled={isRunning}
                  rows={3}
                  className="mt-1 block w-full rounded-[var(--r)] border border-[var(--line)] bg-white px-3 py-1.5 text-xs text-[var(--ink)] outline-none focus:border-[var(--ink)]"
                />
              </label>
            </div>
          </details>

          <p className="mt-2 text-[11px] text-[var(--ink-soft)]">
            {handleMode === 'latest'
              ? 'Latest: ~850 recent tweets, takes about a minute.'
              : 'Full history: walks back in 6-month windows to 2010. Takes 20-30 min and $5-12 in Apify credits. Partial progress is saved as it goes.'}
          </p>
        </>
      )}

      {tab === 'name' && (
        <>
          <form onSubmit={onSubmitName} className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex min-w-[180px] flex-1 items-center rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm focus-within:border-[var(--ink)]">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Steve Jobs"
                disabled={isRunning}
                className="flex-1 bg-transparent text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)] disabled:opacity-50"
              />
            </div>

            <button
              type="submit"
              disabled={isRunning || !name.trim()}
              className="rounded-full bg-[var(--ink)] px-4 py-2 font-display text-sm font-bold text-white transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-sm)] disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
            >
              {isRunning ? 'Working...' : 'Create'}
            </button>
          </form>

          <DisambiguationCard
            name={name}
            isLookingUp={isLookingUp}
            result={disambig}
          />
        </>
      )}

      {status.state !== 'idle' && (
        <div className="mt-4">
          <PullProgress status={status} onDismiss={onReset} />
        </div>
      )}
    </div>
  );
}

/**
 * Inline disambiguation feedback. Shown only when the Name tab is active and
 * the user has typed at least a couple of characters. Three states:
 *
 *   - looking up: pulse + neutral chip
 *   - high confidence: green check + canonical + bio (will be used as displayName)
 *   - low confidence: yellow flag + best guess + reminder to override by editing
 *   - unknown: gray note ("we'll use what you typed")
 */
function DisambiguationCard({
  name,
  isLookingUp,
  result,
}: {
  name: string;
  isLookingUp: boolean;
  result: Disambiguation | null;
}) {
  const trimmed = name.trim();
  if (trimmed.length < 2) return null;

  if (isLookingUp) {
    return (
      <p className="mt-2 text-[11px] text-[var(--ink-faint)]">
        Looking up <strong>{trimmed}</strong>...
      </p>
    );
  }

  if (!result) return null;

  if (result.confidence === 'high') {
    return (
      <p className="mt-2 text-[11px] text-[var(--ink-soft)]">
        <span className="text-[var(--c-green,#17a44e)]">✓</span> Using{' '}
        <strong className="text-[var(--ink)]">{result.canonical}</strong>
        {result.who ? ` — ${result.who}` : ''}.
      </p>
    );
  }

  if (result.confidence === 'low') {
    return (
      <p className="mt-2 text-[11px] text-[var(--ink-soft)]">
        <span className="text-[var(--c-yellow,#fbbf24)]">⚠</span> Best guess:{' '}
        <strong className="text-[var(--ink)]">{result.canonical}</strong>
        {result.who ? ` (${result.who})` : ''}. We&apos;ll use what you typed —
        edit it above if you meant someone else.
      </p>
    );
  }

  return (
    <p className="mt-2 text-[11px] text-[var(--ink-soft)]">
      Couldn&apos;t place <strong>{trimmed}</strong>. We&apos;ll create the
      persona anyway — replies may be highly speculative.
    </p>
  );
}
