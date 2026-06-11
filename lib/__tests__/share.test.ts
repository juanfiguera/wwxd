import { describe, expect, it } from 'vitest';
import {
  buildSnapshot,
  snapshotToMarkdown,
  snapshotToPlainText,
  suggestedFilename,
} from '../share';

const personas = [
  { username: 'paulg', displayName: 'Paul Graham' },
  { username: 'sama', displayName: 'Sam Altman' },
];

describe('buildSnapshot', () => {
  it('stamps generatedAt + version + generator', () => {
    const snap = buildSnapshot({
      kind: 'roundtable',
      personas,
      messages: [{ role: 'user', text: 'hi' }],
    });
    expect(snap.schemaVersion).toBe(1);
    expect(snap.generatedBy).toBe('wwxd');
    expect(snap.kind).toBe('roundtable');
    // ISO 8601
    expect(snap.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('snapshotToMarkdown', () => {
  it('resolves speaker usernames to display names with AI suffix', () => {
    const snap = buildSnapshot({
      kind: 'roundtable',
      personas,
      messages: [
        { role: 'user', text: "what's the bottleneck?" },
        { role: 'assistant', speaker: 'paulg', text: 'distribution.' },
        { role: 'assistant', speaker: 'sama', text: 'compute.' },
      ],
    });
    const md = snapshotToMarkdown(snap);
    expect(md).toContain('**You:** what');
    expect(md).toContain('**Paul Graham (AI):** distribution.');
    expect(md).toContain('**Sam Altman (AI):** compute.');
    expect(md).toContain('wwxd');
  });

  it('falls back to first persona for solo assistant turns without speaker', () => {
    const snap = buildSnapshot({
      kind: 'solo',
      personas: [{ username: 'elonmusk', displayName: 'Elon Musk' }],
      messages: [
        { role: 'user', text: 'hi' },
        { role: 'assistant', text: 'hello.' },
      ],
    });
    expect(snapshotToMarkdown(snap)).toContain('**Elon Musk (AI):** hello.');
  });

  it('leads with a blockquote disclaimer naming the personas', () => {
    const md = snapshotToMarkdown(
      buildSnapshot({
        kind: 'roundtable',
        personas,
        messages: [{ role: 'user', text: 'hi' }],
      }),
    );
    // Disclaimer must appear before any message content.
    const disclaimerIdx = md.indexOf('> **AI impressions');
    const firstMsgIdx = md.indexOf('**You:**');
    expect(disclaimerIdx).toBeGreaterThan(-1);
    expect(firstMsgIdx).toBeGreaterThan(disclaimerIdx);
    expect(md).toContain('Paul Graham');
    expect(md).toContain('Sam Altman');
    expect(md).toMatch(/not the real (people|person)/i);
  });

  it('singularizes the disclaimer for solo conversations', () => {
    const md = snapshotToMarkdown(
      buildSnapshot({
        kind: 'solo',
        personas: [{ username: 'elonmusk', displayName: 'Elon Musk' }],
        messages: [{ role: 'user', text: 'hi' }],
      }),
    );
    expect(md).toContain('> **AI impression, not the real person.**');
  });

  it('skips empty messages', () => {
    const snap = buildSnapshot({
      kind: 'solo',
      personas: [{ username: 'elonmusk', displayName: 'Elon Musk' }],
      messages: [
        { role: 'user', text: '   ' },
        { role: 'user', text: 'real question' },
      ],
    });
    const md = snapshotToMarkdown(snap);
    expect(md).toContain('real question');
    expect(md.split('**You:**').length).toBe(2); // exactly one occurrence
  });

  it('uses title when provided, otherwise joins persona names', () => {
    const withTitle = snapshotToMarkdown(
      buildSnapshot({
        kind: 'roundtable',
        title: 'Board of Directors',
        personas,
        messages: [{ role: 'user', text: 'hi' }],
      }),
    );
    expect(withTitle).toContain('# Board of Directors');

    const noTitle = snapshotToMarkdown(
      buildSnapshot({
        kind: 'roundtable',
        personas,
        messages: [{ role: 'user', text: 'hi' }],
      }),
    );
    expect(noTitle).toContain('# Roundtable: Paul Graham, Sam Altman');
  });
});

describe('snapshotToPlainText', () => {
  it('uses bare colons + AI suffix, no markdown bold', () => {
    const snap = buildSnapshot({
      kind: 'solo',
      personas: [{ username: 'elonmusk', displayName: 'Elon Musk' }],
      messages: [
        { role: 'user', text: 'hi' },
        { role: 'assistant', text: 'hello.' },
      ],
    });
    const txt = snapshotToPlainText(snap);
    expect(txt).toContain('You: hi');
    expect(txt).toContain('Elon Musk (AI): hello.');
    expect(txt).not.toContain('**');
  });

  it('leads with a bracketed disclaimer block before any message', () => {
    const txt = snapshotToPlainText(
      buildSnapshot({
        kind: 'solo',
        personas: [{ username: 'elonmusk', displayName: 'Elon Musk' }],
        messages: [{ role: 'user', text: 'hi' }],
      }),
    );
    const disclaimerIdx = txt.indexOf('[AI impression, not the real person]');
    const firstMsgIdx = txt.indexOf('You: hi');
    expect(disclaimerIdx).toBeGreaterThan(-1);
    expect(firstMsgIdx).toBeGreaterThan(disclaimerIdx);
  });
});

describe('ShareSnapshot.disclaimer field', () => {
  it('is populated by buildSnapshot and survives JSON round-trip', () => {
    const snap = buildSnapshot({
      kind: 'solo',
      personas: [{ username: 'paulg', displayName: 'Paul Graham' }],
      messages: [{ role: 'user', text: 'hi' }],
    });
    expect(snap.disclaimer).toContain('Paul Graham');
    expect(snap.disclaimer.toLowerCase()).toContain('ai-generated');
    expect(snap.disclaimer.toLowerCase()).toMatch(/don'?t quote/);

    const roundTripped = JSON.parse(JSON.stringify(snap));
    expect(roundTripped.disclaimer).toBe(snap.disclaimer);
  });
});

describe('suggestedFilename', () => {
  it('slugifies the title or personas', () => {
    const snap = buildSnapshot({
      kind: 'roundtable',
      title: 'Board of Directors',
      personas,
      messages: [],
    });
    expect(suggestedFilename(snap)).toMatch(/^board-of-directors-\d{4}-\d{2}-\d{2}\.wwxd\.json$/);
  });

  it('falls back to persona usernames when no title', () => {
    const snap = buildSnapshot({
      kind: 'roundtable',
      personas,
      messages: [],
    });
    expect(suggestedFilename(snap)).toMatch(/^paulg-sama-\d{4}-\d{2}-\d{2}\.wwxd\.json$/);
  });
});
