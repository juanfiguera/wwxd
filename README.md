# wwxd

**what would x do?**

Type a name. Get a chat with that person. Or as close as a language model can get.

[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev)
[![Tests](https://img.shields.io/badge/tests-473%20passing-success)](#tests--evals)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

Steve Jobs on AI agents. Paul Graham on hiring your first engineer. Marcus Aurelius on the email you can't stop drafting. The same machine answers all three, and it'll cite its sources when it has them.

This is wwxd. Self-hosted. MIT. Project home at **[wwxd.chat](https://wwxd.chat)**.

> **Heads up.** wwxd generates AI _impressions_ of real people. The personas are not the people they reference, are not endorsed by them, and will sometimes misrepresent their views. Don't quote outputs. Don't take advice from them. Treat the whole thing as well-researched fan fiction.

## Two ways to create a persona

**Grounded.** Give wwxd source material: tweets via Apify, essays from URLs/RSS/sitemap, YouTube transcripts. It builds an embedding index over the corpus and every reply links back to specific chunks with `↗`. This is high-fidelity mode. You're hearing a synthesis of what they actually wrote.

**Prior-only.** Just type a name. wwxd asks the model "who is this?", catches typos (`"Elon Mosk"` → `"Elon Musk — Tesla and SpaceX CEO"`), stores a stub, and chats from the model's training knowledge. No corpus, no citations. The fastest way to bring Steve Jobs, Marcus Aurelius, or Marie Kondo to your table.

Both modes share the chat surface. Grounded personas wear a `CITED` pill. Prior-only personas read "from memory" instead of a tweet count.

## Quick start

```bash
git clone https://github.com/juanfiguera/wwxd.git && cd wwxd
cp .env.example .env.local        # fill in at least one LLM provider key
pnpm install
pnpm dev                           # http://localhost:3000
```

Open [/app](http://localhost:3000/app). You'll see an empty rail and an "Add a persona" card with two tabs.

- **X handle.** Paste a handle. wwxd pulls tweets, optionally essays + YouTube, embeds the lot. About a minute for the latest 850 tweets. Needs `APIFY_TOKEN` + an embedding provider.
- **Name anyone.** Type a name. wwxd disambiguates it and creates the persona instantly. No tokens beyond your LLM provider.

Make a persona, click their card, ask them something. That's the whole loop.

## Three ways to talk to them

| Surface | URL | Vibe |
| --- | --- | --- |
| Solo | `/app/<slug>` | One on one. Replies cite back to specific source chunks. |
| Compare | `/app/compare?personas=a,b,c` | Same prompt, parallel columns. See how each one differs. |
| Roundtable | `/app/compare?personas=a,b,c&mode=roundtable` | They take turns and react to each other by name. A gate lets a persona pass when they have nothing to add. |

Save a lineup as a **Group** ("Board of Directors", "The Stoa") and one-click load it from the rail. **Share** a conversation as Markdown, plain text, or a versioned `.wwxd.json` snapshot.

## Bring your own model

wwxd is provider-agnostic. Pick a chat model, pick an embedding model, edit `.env.local`. Defaults are Anthropic Claude Opus 4.7 + OpenAI `text-embedding-3-small` because they're what shipped working out of the box. None of it is hard-wired.

```bash
LLM_PROVIDER=anthropic                # anthropic | openai | openai-compatible
                                      # aliases: ollama | openrouter | vllm | lmstudio
ANTHROPIC_API_KEY=sk-ant-...

# Running Ollama locally? Two lines and you're done:
# LLM_PROVIDER=openai-compatible
# LLM_BASE_URL=http://localhost:11434/v1
# LLM_API_KEY=ollama

# Embeddings — optional, but recommended for grounded mode
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=sk-...

# Apify is only for the grounded "X handle" path. Skip if you only
# use prior-only personas.
APIFY_TOKEN=apify_api_...
```

Where to get keys:

- [Anthropic](https://console.anthropic.com/settings/keys)
- [OpenAI](https://platform.openai.com/api-keys)
- [Apify](https://console.apify.com/account/integrations)
- [Ollama](https://ollama.com) — local, free, no key

Full env reference in [`.env.example`](./.env.example).

## Adding a grounded persona from the CLI

The UI handles this from the X-handle tab. If you want to script it instead (batch imports, deep historical pulls, X archive JSON):

```bash
# Tweets — latest ~850 in X's search window
pnpm fetch-tweets paulg

# Full history — date-windowed, slower, more $$$
pnpm fetch-tweets paulg --deep

# Optional essays — URLs, RSS feed, sitemap, or file
pnpm fetch-essays paulg https://paulgraham.com/founders.html
pnpm fetch-essays paulg --rss https://example.com/feed.xml

# Optional YouTube transcripts
pnpm fetch-youtube lexfridman https://youtu.be/VIDEO_ID

# Embed everything (tweets + essays + transcripts → one index)
pnpm embed-tweets paulg

# /app/paulg now works.
```

`--file` on `fetch-tweets` accepts an X archive JSON if you want to skip Apify entirely.

## Tests + evals

```bash
pnpm test                       # 473 unit tests
pnpm eval-persona paulg         # voice match score via LLM judge
pnpm eval-discriminate paulg    # blind A/B: can a judge tell wwxd apart from the real thing?
```

## What's actually happening

```
scripts/fetch-tweets.ts     →  data/<slug>.json                  corpus
scripts/fetch-essays.ts     →  appends to data/<slug>.json
scripts/fetch-youtube.ts    →  appends to data/<slug>.json
scripts/embed-tweets.ts     →  data/<slug>.embeddings.json       vectors

lib/persona.ts         builds the system prompt.
                        Grounded → voice signature + citation rules.
                        Prior-only → "use what you know, no citations."

lib/retrieve.ts        per-query: embed the user message, run BM25 in
                        parallel, fuse with RRF, return top-K. Skipped
                        entirely for prior-only personas.

lib/disambiguate.ts    takes a typed name, returns canonical figure + bio.
                        Aggressive about spell-correction:
                        "Marqus Aurelius" → "Marcus Aurelius"
                        "Elon Mosk"       → "Elon Musk"

app/api/chat/[username]/route.ts:
  Load corpus, branch on mode. Grounded retrieves and injects sources
  with [src:ID] markers. Prior-only just emits the prompt and streams.
```

## How the roundtable works

For each turn, wwxd loops the personas in order:

1. **Gate.** A cheap call (whichever model you set as `GATE_MODEL`, defaults to your provider's small/fast tier) asks "given the conversation so far, do you actually have anything to add?" YES / NO with a reason. First speaker skips the gate.
2. **Speak.** If YES, retrieve their chunks (grounded) or go from memory (prior-only). The prompt includes every prior speaker's contribution so they can agree, push back, or build by name.
3. **Pass.** If NO, surface a `(passed)` chip with the reason. No charge for a turn nobody spoke on.

See `lib/gate.ts` and `app/api/roundtable/route.ts`.

## What it costs

Costs depend on the providers you pick. Rough ballpark:

- **Tweet ingestion** (Apify) — $0.25 to $0.40 per 1k tweets. A latest pull is a few dollars. A `--deep` pull of a 10-year account is $10 to $30. Skip entirely if you only use prior-only personas.
- **Embeddings** — typically $0.02 per 1M tokens with OpenAI's small embedding model. A 5k-tweet corpus is about $0.01 to embed. Free if you run embeddings locally (Ollama, vLLM, etc.).
- **Chat (hosted providers)** — the static persona prompt is cached when the provider supports it (Anthropic and OpenAI both do), so each turn mostly pays for retrieval + response. On a frontier-tier model, expect cents per turn; on a mid-tier model, fractions of a cent. A 4-persona roundtable turn is roughly 4× a solo turn.
- **Chat (local)** — Ollama, vLLM, LMStudio, or any openai-compatible backend you stand up yourself: free, minus electricity. Quality scales with the model you run.
- **Prior-only personas** — zero ingestion cost in any setup. You only pay (or only burn local compute) per chat turn.

## Caveats worth reading

- It's a simulation. The disclaimer at the top of this file isn't decoration. Please keep it visible if you ship a fork.
- No tools, no web access. The chat only knows what's in the corpus (grounded) or what the model knows (prior-only).
- Grounded without embeddings = BM25-only, no `↗` links. Set up an embedding provider if you want citations.
- Prior-only never cites. Specific quotes, dates, and numbers may be fabricated. Treat replies as informed extrapolation, not as records.
- Everything is local. `data/wwxd.db` (SQLite) holds conversations. `data/<slug>.{json,embeddings.json}` hold corpora. Nothing leaves your machine unless you share a snapshot.

## Contributing

PRs welcome. Surface is small:

- **Ingestion** — `lib/ingest/`, `scripts/`
- **Retrieval** — `lib/retrieve.ts`, `lib/bm25.ts`
- **Persona prompts** — `lib/persona.ts`, `lib/disambiguate.ts`
- **Chat UI** — `app/`

Run `pnpm test` before opening a PR. Tests live under `lib/__tests__/` and `app/components/__tests__/`.

## License

MIT, see [LICENSE](./LICENSE).
