import { describe, it, expect } from 'vitest';
import { buildStaticPersona, buildRetrievalBlock, type Corpus, type Tweet } from '../persona';

function tweet(overrides: Partial<Tweet>): Tweet {
  return {
    id: '1',
    url: 'https://x.com/i/web/status/1',
    text: 'sample',
    createdAt: '2024-01-01T00:00:00Z',
    likes: 0,
    retweets: 0,
    replies: 0,
    views: 0,
    isReply: false,
    isRetweet: false,
    isQuote: false,
    ...overrides,
  };
}

function corpus(tweets: Tweet[], overrides: Partial<Corpus> = {}): Corpus {
  return {
    username: 'test',
    displayName: 'Test User',
    fetchedAt: '2024-01-01T00:00:00Z',
    tweets,
    ...overrides,
  };
}

describe('buildStaticPersona', () => {
  it('includes username and display name', () => {
    const prompt = buildStaticPersona(corpus([tweet({ id: '1', text: 'hello' })]));
    expect(prompt).toContain('@test');
    expect(prompt).toContain('Test User');
  });

  it('only uses original tweets (no replies/retweets) in voice signature', () => {
    const tweets = [
      tweet({ id: '1', text: 'original high engagement', likes: 1000 }),
      tweet({ id: '2', text: 'a reply', likes: 1000, isReply: true }),
      tweet({ id: '3', text: 'a retweet', likes: 1000, isRetweet: true }),
    ];
    const prompt = buildStaticPersona(corpus(tweets));
    expect(prompt).toContain('original high engagement');
    expect(prompt).not.toContain('a reply');
    expect(prompt).not.toContain('a retweet');
  });

  it('orders voice signature by engagement score', () => {
    const tweets = [
      tweet({ id: '1', text: 'low engagement', likes: 1 }),
      tweet({ id: '2', text: 'high engagement', likes: 1000 }),
      tweet({ id: '3', text: 'medium engagement', likes: 100 }),
    ];
    const prompt = buildStaticPersona(corpus(tweets));
    const highIdx = prompt.indexOf('high engagement');
    const medIdx = prompt.indexOf('medium engagement');
    const lowIdx = prompt.indexOf('low engagement');
    expect(highIdx).toBeGreaterThan(0);
    expect(highIdx).toBeLessThan(medIdx);
    expect(medIdx).toBeLessThan(lowIdx);
  });

  it('declares citation rules', () => {
    const prompt = buildStaticPersona(corpus([tweet({})]));
    expect(prompt).toContain('[tweet:ID]');
  });

  describe('prior-only mode', () => {
    it('uses a different prompt that tells the model to draw on training knowledge', () => {
      const prompt = buildStaticPersona(
        corpus([], { username: 'steve-jobs', displayName: 'Steve Jobs', mode: 'prior-only' }),
      );
      expect(prompt).toContain('Steve Jobs');
      expect(prompt).toContain('training knowledge');
      expect(prompt).toContain('no curated corpus attached');
    });

    it('tells the model not to emit citation markers', () => {
      const prompt = buildStaticPersona(
        corpus([], { username: 'steve-jobs', displayName: 'Steve Jobs', mode: 'prior-only' }),
      );
      expect(prompt).toContain('Do not include citation markers');
      // The grounded "Citation rules (IMPORTANT)" header should not appear.
      expect(prompt).not.toContain('Citation rules (IMPORTANT)');
      // The grounded "VOICE SIGNATURE" header should not appear.
      expect(prompt).not.toContain('VOICE SIGNATURE');
    });

    it('omits the @username handle reference since prior-only personas may not have one', () => {
      const prompt = buildStaticPersona(
        corpus([], { username: 'steve-jobs', displayName: 'Steve Jobs', mode: 'prior-only' }),
      );
      expect(prompt).not.toContain('@steve-jobs');
      expect(prompt).not.toContain('on X/Twitter');
    });

    it('injects the bio line when provided', () => {
      const prompt = buildStaticPersona(
        corpus([], {
          username: 'steve-jobs',
          displayName: 'Steve Jobs',
          mode: 'prior-only',
          bio: 'Apple co-founder (1955-2011)',
        }),
      );
      expect(prompt).toContain('Apple co-founder (1955-2011)');
    });

    it('skips the bio line when not provided', () => {
      const prompt = buildStaticPersona(
        corpus([], { username: 'marie-kondo', displayName: 'Marie Kondo', mode: 'prior-only' }),
      );
      expect(prompt).not.toContain('Context:');
    });

    it('still uses prior-only branch even if tweets array contains data (mode wins)', () => {
      // Defensive: if a corpus gets mislabeled prior-only with stale tweets,
      // we honor the mode flag rather than silently switching to grounded.
      const prompt = buildStaticPersona(
        corpus([tweet({ id: '1', text: 'should be ignored' })], {
          mode: 'prior-only',
          displayName: 'Stale Persona',
        }),
      );
      expect(prompt).toContain('training knowledge');
      expect(prompt).not.toContain('should be ignored');
    });
  });
});

describe('buildRetrievalBlock', () => {
  it('returns a no-tweets placeholder when empty', () => {
    const block = buildRetrievalBlock([]);
    expect(block).toContain('no relevant tweets found');
  });

  it('formats retrieved tweets with IDs for citation', () => {
    const tweets = [
      tweet({ id: '12345', text: 'this is a retrieved tweet' }),
      tweet({ id: '67890', text: 'another one' }),
    ];
    const block = buildRetrievalBlock(tweets);
    expect(block).toContain('[id:12345]');
    expect(block).toContain('this is a retrieved tweet');
    expect(block).toContain('[id:67890]');
    expect(block).toContain('another one');
  });

  it('normalizes whitespace in tweet text', () => {
    const tweets = [tweet({ id: '1', text: 'hello\n\n\nworld   spaces' })];
    const block = buildRetrievalBlock(tweets);
    expect(block).toContain('hello world spaces');
    expect(block).not.toContain('\n\n\n');
  });
});
