import { describe, it, expect } from 'vitest';
import {
  extractCaptionTracks,
  extractChannelName,
  extractVideoId,
  extractVideoTitle,
  parseCaptionXml,
} from '../fetch-youtube';

describe('extractVideoId', () => {
  it('returns a bare 11-char ID untouched', () => {
    expect(extractVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses youtube.com/watch URLs', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses youtu.be short URLs', () => {
    expect(extractVideoId('https://youtu.be/dQw4w9WgXcQ?si=foo')).toBe('dQw4w9WgXcQ');
  });

  it('parses embed URLs', () => {
    expect(extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses shorts URLs', () => {
    expect(extractVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for non-YouTube input', () => {
    expect(extractVideoId('https://example.com/video')).toBeNull();
  });
});

describe('extractCaptionTracks', () => {
  it('extracts tracks from embedded JSON', () => {
    const html =
      '...other html..."captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=abc","languageCode":"en","kind":"asr"},{"baseUrl":"https://www.youtube.com/api/timedtext?v=abc\\u0026lang=es","languageCode":"es"}]...';
    const tracks = extractCaptionTracks(html);
    expect(tracks).toHaveLength(2);
    expect(tracks[0].languageCode).toBe('en');
    expect(tracks[1].baseUrl).toContain('lang=es');
    expect(tracks[1].baseUrl).not.toContain('\\u0026');
  });

  it('returns empty when no captions present', () => {
    expect(extractCaptionTracks('<html>no captions here</html>')).toEqual([]);
  });
});

describe('parseCaptionXml', () => {
  it('joins text segments', () => {
    const xml = `<?xml version="1.0"?>
<transcript>
  <text start="0" dur="3">first line</text>
  <text start="3" dur="2">second line</text>
</transcript>`;
    expect(parseCaptionXml(xml)).toBe('first line second line');
  });

  it('decodes HTML entities', () => {
    const xml = `<transcript><text>it&#39;s here &amp; now</text></transcript>`;
    expect(parseCaptionXml(xml)).toBe("it's here & now");
  });

  it('returns empty when no text nodes', () => {
    expect(parseCaptionXml('<transcript></transcript>')).toBe('');
  });
});

describe('extractVideoTitle', () => {
  it('prefers og:title', () => {
    const html = '<meta property="og:title" content="The Real Title"><title>Fallback - YouTube</title>';
    expect(extractVideoTitle(html)).toBe('The Real Title');
  });

  it('strips " - YouTube" suffix from title tag', () => {
    expect(extractVideoTitle('<title>Cool Talk - YouTube</title>')).toBe('Cool Talk');
  });
});

describe('extractChannelName', () => {
  it('finds author field', () => {
    expect(extractChannelName('..."author":"Lex Fridman",...')).toBe('Lex Fridman');
  });

  it('returns empty when missing', () => {
    expect(extractChannelName('no author here')).toBe('');
  });
});
