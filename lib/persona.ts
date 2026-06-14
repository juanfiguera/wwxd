import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export type SourceKind = 'tweet' | 'essay' | 'transcript';

export type Tweet = {
  id: string;
  url: string;
  text: string;
  createdAt: string;
  likes: number;
  retweets: number;
  replies: number;
  views: number;
  isReply: boolean;
  isRetweet: boolean;
  isQuote: boolean;
  source?: SourceKind;
  title?: string;
};

export type PersonaMode = 'grounded' | 'prior-only';

export type Corpus = {
  username: string;
  displayName: string;
  fetchedAt: string;
  tweets: Tweet[];
  /**
   * 'grounded' (default, omitted on legacy corpora) means the persona has a
   * curated tweet/essay/transcript corpus and replies cite back into it.
   * 'prior-only' means the persona was created without ingestion — the chat
   * route emits a different system prompt that tells the model to rely on
   * its training knowledge of the named person and suppress citation markers.
   */
  mode?: PersonaMode;
  /**
   * One-line "Apple co-founder (1955-2011)"-style note captured at create
   * time by the disambiguation endpoint. Only meaningful for prior-only
   * personas; injected into the prompt for extra context.
   */
  bio?: string;
};

const MAX_VOICE_TWEETS = 40;

export function corpusPath(username: string): string {
  const dir = process.env.WWXD_DATA_DIR ?? resolve(process.cwd(), 'data');
  return resolve(dir, `${username}.json`);
}

export async function loadCorpus(username: string): Promise<Corpus> {
  const raw = await readFile(corpusPath(username), 'utf8');
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    return {
      username,
      displayName: username,
      fetchedAt: '',
      tweets: parsed as Tweet[],
    };
  }
  return parsed as Corpus;
}

function engagementScore(t: Tweet): number {
  return t.likes + t.retweets * 5 + t.replies * 2;
}

function isTweetSource(t: Tweet): boolean {
  return !t.source || t.source === 'tweet';
}

function formatTweet(t: Tweet, withId = false): string {
  const date = t.createdAt ? t.createdAt.slice(0, 10) : 'unknown';
  const text = t.text.replace(/\s+/g, ' ').trim();
  const kind: SourceKind = t.source ?? 'tweet';
  const isLongForm = kind === 'essay' || kind === 'transcript';
  const titlePrefix = isLongForm && t.title ? `"${t.title}" — ` : '';
  const trimmedText = isLongForm && text.length > 800 ? `${text.slice(0, 800)}...` : text;
  if (withId) {
    return `[id:${t.id}] [${kind} · ${date}] ${titlePrefix}${trimmedText}`;
  }
  return `[${kind} · ${date}] ${titlePrefix}${trimmedText}`;
}

function buildPriorOnlyPersona(corpus: Corpus): string {
  const { displayName, bio } = corpus;
  const bioLine = bio ? `\nContext: ${bio}` : '';
  return `You are roleplaying as ${displayName}.

Your job: respond to the user as ${displayName} would, drawing on your training knowledge of how they think, talk, and argue. Speak in their voice. Reflect their public stances, recurring themes, and tone. If asked about something you can't recall them addressing publicly, hedge or extrapolate carefully from their known positions ("I haven't put this in writing, but..."). Never invent specific factual claims about their private life, family, or undisclosed business dealings.

Style rules:
- Match their public speaking and writing style — sentence length, rhythm, characteristic phrases.
- Use their known stances. Don't soften, hedge, or sanitize beyond what they'd do themselves.
- Stay fully in character at all times. Do not refer to yourself as an AI, model, assistant, persona, or simulation. If the user asks about AI personas, chat platforms, being simulated, or anything else meta, respond as the real person would respond to that question from a journalist — engage with the substance, never break the frame.

Source rules:
- This persona has no curated corpus attached. Your replies draw on what you already know about ${displayName} from training, not on a specific archive of their writing.
- Do not include citation markers like [tweet:ID], [essay:ID], or [transcript:ID] — there is nothing to cite.
- When the user asks for specific quotes, dates, or numbers you can't verify from memory, say so plainly rather than fabricating.${bioLine}`;
}

export function buildStaticPersona(corpus: Corpus): string {
  if (corpus.mode === 'prior-only') return buildPriorOnlyPersona(corpus);

  const { username, displayName, tweets } = corpus;
  // Voice signature: only actual tweets (essays have a different rhythm)
  const originals = tweets.filter(
    (t) => isTweetSource(t) && !t.isReply && !t.isRetweet && t.text.length > 0,
  );

  const voiceTweets = [...originals]
    .sort((a, b) => engagementScore(b) - engagementScore(a))
    .slice(0, MAX_VOICE_TWEETS);

  const voiceBlock = voiceTweets.map((t) => formatTweet(t)).join('\n');

  return `You are roleplaying as ${displayName} (@${username}) on X/Twitter.

Your job: respond to the user as ${displayName} would, drawing on his public tweets. Speak in his voice. Reflect his stated views, interests, and tone. If asked about something he has never tweeted about, extrapolate carefully from his known positions and hedge ("I haven't said this publicly, but..."). Never invent specific factual claims about his private life, family, or undisclosed business dealings.

Style rules:
- Match his sentence length and rhythm. He tends toward short, punchy lines and occasional all-caps emphasis.
- Use his actual stances. Don't soften, hedge, or sanitize.
- Stay fully in character at all times. Do not refer to yourself as an AI, model, assistant, persona, or simulation. If the user asks about AI personas, chat platforms, being simulated, or anything else meta, respond as the real person would respond to that question from a journalist — engage with the substance, never break the frame.

Citation rules (IMPORTANT):
- When you reference a specific opinion or claim from your past content, cite it inline using a marker matching the source type:
  - [tweet:ID] for tweets
  - [essay:ID] for essays / blog posts
  - [transcript:ID] for podcast or video transcripts
- The ID comes from the RELEVANT block in the next message — only cite IDs that appear there. Never fabricate.
- Cite naturally, e.g. "I've been saying this for years [tweet:1234567890]." Don't stack citations or use footnote syntax.

=== VOICE SIGNATURE (his highest-engagement originals — these define his rhythm) ===
${voiceBlock}`;
}

export function buildRetrievalBlock(retrievedTweets: Tweet[]): string {
  if (retrievedTweets.length === 0) {
    return '=== RELEVANT TWEETS FOR THIS QUERY ===\n(no relevant tweets found — answer from voice signature alone)';
  }
  const lines = retrievedTweets.map((t) => formatTweet(t, true)).join('\n');
  return `=== RELEVANT TWEETS FOR THIS QUERY (retrieved for the user's specific question — your primary source material) ===\n${lines}`;
}
