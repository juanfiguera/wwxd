import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  extractCitedIds,
  renderCitationMarkers,
  SourcesPanel,
  type RetrievedTweetMeta,
} from '../sources-panel';

describe('extractCitedIds', () => {
  it('returns an empty set for text with no citation markers', () => {
    expect(extractCitedIds('just regular prose')).toEqual(new Set());
  });

  it('extracts a single tweet ID', () => {
    expect(extractCitedIds('see [tweet:1234567890]')).toEqual(new Set(['1234567890']));
  });

  it('extracts ids from essays and transcripts too', () => {
    const out = extractCitedIds(
      'see [essay:abc123] and [transcript:xyz_987] and [tweet:t-1]',
    );
    expect(out).toEqual(new Set(['abc123', 'xyz_987', 't-1']));
  });

  it('de-duplicates repeated ids', () => {
    expect(extractCitedIds('[tweet:1] and [tweet:1] again')).toEqual(new Set(['1']));
  });
});

describe('renderCitationMarkers', () => {
  const retrieved: RetrievedTweetMeta[] = [
    {
      id: '123',
      text: 'a',
      url: 'https://x.com/paulg/status/123',
      createdAt: '',
    },
  ];

  it('replaces a [tweet:ID] marker with a markdown link arrow', () => {
    const out = renderCitationMarkers('see [tweet:123] for context', 'paulg', retrieved);
    expect(out).toContain('[↗](https://x.com/paulg/status/123)');
  });

  it('falls back to a constructed x.com URL when the id is not in retrieved', () => {
    const out = renderCitationMarkers('see [tweet:999]', 'paulg', []);
    expect(out).toContain('https://x.com/paulg/status/999');
  });

  it('uses the retrieved URL when present (essay or transcript)', () => {
    const out = renderCitationMarkers(
      'see [essay:abc]',
      'paulg',
      [
        {
          id: 'abc',
          text: 'an essay',
          url: 'https://paulgraham.com/founders.html',
          createdAt: '',
          source: 'essay',
        },
      ],
    );
    expect(out).toContain('paulgraham.com');
  });
});

describe('SourcesPanel', () => {
  it('renders nothing when no tweets are supplied', () => {
    const { container } = render(<SourcesPanel tweets={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a collapsed <details> summary with the source count', () => {
    render(
      <SourcesPanel
        tweets={[
          { id: '1', text: 'a', url: 'u1', createdAt: '2025-01-01T00:00:00Z' },
          { id: '2', text: 'b', url: 'u2', createdAt: '' },
        ]}
      />,
    );
    expect(screen.getByText(/2 sources retrieved/i)).toBeInTheDocument();
  });

  it('singularizes when there is exactly one source', () => {
    render(<SourcesPanel tweets={[{ id: '1', text: 'a', url: 'u1', createdAt: '' }]} />);
    expect(screen.getByText(/1 source retrieved/i)).toBeInTheDocument();
  });

  it('appends the cited count when citedIds has entries', () => {
    render(
      <SourcesPanel
        tweets={[
          { id: '1', text: 'a', url: 'u1', createdAt: '' },
          { id: '2', text: 'b', url: 'u2', createdAt: '' },
        ]}
        citedIds={new Set(['1'])}
      />,
    );
    expect(screen.getByText(/1 cited/i)).toBeInTheDocument();
  });

  it('marks the cited source visually distinct', () => {
    render(
      <SourcesPanel
        tweets={[
          { id: '1', text: 'a', url: 'u1', createdAt: '' },
          { id: '2', text: 'b', url: 'u2', createdAt: '' },
        ]}
        citedIds={new Set(['1'])}
      />,
    );
    // The cited row carries the "cited" badge.
    expect(screen.getAllByText('cited').length).toBeGreaterThanOrEqual(1);
  });

  it('truncates long-form essay / transcript previews at 240 chars', () => {
    const longText = 'x'.repeat(300);
    render(
      <SourcesPanel
        tweets={[
          {
            id: '1',
            text: longText,
            url: 'u1',
            createdAt: '',
            source: 'essay',
            title: 'A Long Essay',
          },
        ]}
      />,
    );
    expect(screen.getByText(/x{240}\.{3}/)).toBeInTheDocument();
  });

  it('uses the title as the link label when provided', () => {
    render(
      <SourcesPanel
        tweets={[
          {
            id: '1',
            text: 'short text',
            url: 'u1',
            createdAt: '',
            source: 'essay',
            title: 'Founder Mode',
          },
        ]}
      />,
    );
    expect(screen.getByText(/Founder Mode/)).toBeInTheDocument();
  });
});
