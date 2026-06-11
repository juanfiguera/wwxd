import Link from 'next/link';

type SettingsCardProps = {
  href: string;
  title: string;
  description: string;
  external?: boolean;
};

function SettingsCard({ href, title, description, external }: SettingsCardProps) {
  const Element = external ? 'a' : Link;
  const extraProps = external
    ? { target: '_blank' as const, rel: 'noreferrer' as const }
    : {};
  return (
    <Element
      href={href}
      {...extraProps}
      className="group flex items-center justify-between gap-3 rounded-[var(--r-lg)] border border-[var(--line)] bg-white p-4 transition hover:border-[var(--ink)] hover:shadow-[var(--shadow-sm)]"
    >
      <div className="min-w-0">
        <div className="font-display text-[15px] font-extrabold tracking-tight text-[var(--ink)]">
          {title}
        </div>
        <p className="mt-0.5 text-xs text-[var(--ink-soft)]">{description}</p>
      </div>
      <span
        aria-hidden
        className="shrink-0 text-[var(--ink-faint)] transition group-hover:text-[var(--ink)]"
      >
        →
      </span>
    </Element>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{ marginBottom: 8 }}
      className="font-display text-[11.5px] font-bold uppercase tracking-[0.12em] text-[var(--ink-faint)]"
    >
      {children}
    </h2>
  );
}

export default function SettingsPage() {
  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[var(--paper-2)]">
      <div className="mx-auto w-full max-w-2xl px-4 py-10 md:px-6">
        <header className="mb-8">
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-[var(--ink)]">
            Settings
          </h1>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            wwxd is open source and self-hosted. Most config lives in your{' '}
            <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-[var(--ink)]">
              .env.local
            </code>{' '}
            file.
          </p>
        </header>

        <section className="mb-8">
          <SectionLabel>Keys + models</SectionLabel>
          <div className="rounded-[var(--r-lg)] border border-[var(--line)] bg-white p-5">
            <p className="text-sm text-[var(--ink-2)]">
              API keys live in{' '}
              <code className="rounded bg-[var(--paper-2)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--ink)]">
                .env.local
              </code>
              . Restart{' '}
              <code className="rounded bg-[var(--paper-2)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--ink)]">
                pnpm dev
              </code>{' '}
              after editing.
            </p>
            <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
              <div className="rounded-[var(--r)] bg-[var(--paper-2)] p-3">
                <dt className="font-display font-bold text-[var(--ink)]">LLM_PROVIDER</dt>
                <dd className="mt-1 text-[var(--ink-soft)]">
                  <code className="font-mono text-[11px]">anthropic</code> ·{' '}
                  <code className="font-mono text-[11px]">openai</code> ·{' '}
                  <code className="font-mono text-[11px]">openai-compatible</code>{' '}
                  (Ollama, OpenRouter, vLLM).
                </dd>
              </div>
              <div className="rounded-[var(--r)] bg-[var(--paper-2)] p-3">
                <dt className="font-display font-bold text-[var(--ink)]">LLM_BASE_URL + LLM_API_KEY</dt>
                <dd className="mt-1 text-[var(--ink-soft)]">
                  Only for{' '}
                  <code className="font-mono text-[11px]">openai-compatible</code>.
                  e.g. Ollama:{' '}
                  <code className="font-mono text-[11px]">http://localhost:11434/v1</code>.
                </dd>
              </div>
              <div className="rounded-[var(--r)] bg-[var(--paper-2)] p-3">
                <dt className="font-display font-bold text-[var(--ink)]">
                  ANTHROPIC_API_KEY / OPENAI_API_KEY
                </dt>
                <dd className="mt-1 text-[var(--ink-soft)]">
                  Set whichever your provider needs.
                </dd>
              </div>
              <div className="rounded-[var(--r)] bg-[var(--paper-2)] p-3">
                <dt className="font-display font-bold text-[var(--ink)]">
                  CHAT_MODEL / GATE_MODEL / CLASSIFIER_MODEL
                </dt>
                <dd className="mt-1 text-[var(--ink-soft)]">
                  Override defaults per role. Blank = provider default.
                </dd>
              </div>
              <div className="rounded-[var(--r)] bg-[var(--paper-2)] p-3">
                <dt className="font-display font-bold text-[var(--ink)]">
                  EMBEDDING_PROVIDER / EMBEDDING_MODEL
                </dt>
                <dd className="mt-1 text-[var(--ink-soft)]">
                  Defaults to OpenAI{' '}
                  <code className="font-mono text-[11px]">text-embedding-3-small</code> @
                  512d.
                </dd>
              </div>
              <div className="rounded-[var(--r)] bg-[var(--paper-2)] p-3">
                <dt className="font-display font-bold text-[var(--ink)]">
                  TWEET_PROVIDER
                </dt>
                <dd className="mt-1 text-[var(--ink-soft)]">
                  <code className="font-mono text-[11px]">apify</code> (needs{' '}
                  <code className="font-mono text-[11px]">APIFY_TOKEN</code>) ·{' '}
                  <code className="font-mono text-[11px]">file</code> (JSON via{' '}
                  <code className="font-mono text-[11px]">TWEET_FILE_PATH</code>).
                </dd>
              </div>
              <div className="rounded-[var(--r)] bg-[var(--paper-2)] p-3">
                <dt className="font-display font-bold text-[var(--ink)]">
                  ESSAY_PROVIDER / YOUTUBE_PROVIDER
                </dt>
                <dd className="mt-1 text-[var(--ink-soft)]">
                  <code className="font-mono text-[11px]">http</code> scrapes; {' '}
                  <code className="font-mono text-[11px]">file</code> loads a manifest
                  ({' '}
                  <code className="font-mono text-[11px]">*_FILE_PATH</code>).
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="mb-8">
          <SectionLabel>Quality</SectionLabel>
          <div className="space-y-2">
            <SettingsCard
              href="/app/evals"
              title="Evals"
              description="Score how well each persona sounds like the real person."
            />
          </div>
        </section>

        <section className="mb-8">
          <SectionLabel>About</SectionLabel>
          <div className="rounded-[var(--r-lg)] border border-[var(--line)] bg-white p-5">
            <p className="text-sm text-[var(--ink-2)]">
              <span className="font-display font-extrabold text-[var(--ink)]">wwxd</span> — what would
              X do? Chat with AI personas built from public writing.
            </p>
            <p className="mt-2 text-xs text-[var(--ink-soft)]">
              MIT licensed. Clone the repo, set up your keys and models, done.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
