import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ImpressionCard } from '../impression-card';

describe('ImpressionCard', () => {
  it('singular for solo: "AI impression. ... not the real person."', () => {
    render(
      <ImpressionCard
        kind="solo"
        personas={[{ username: 'paulg', displayName: 'Paul Graham' }]}
      />,
    );
    expect(screen.getByText(/AI impression\./i)).toBeInTheDocument();
    expect(screen.getByText('Paul Graham')).toBeInTheDocument();
    expect(screen.getByText(/not the real person/i)).toBeInTheDocument();
  });

  it('plural for roundtable: "AI roundtable. ... not the real people."', () => {
    render(
      <ImpressionCard
        kind="roundtable"
        personas={[
          { username: 'paulg', displayName: 'Paul Graham' },
          { username: 'sama', displayName: 'Sam Altman' },
          { username: 'elonmusk', displayName: 'Elon Musk' },
        ]}
      />,
    );
    expect(screen.getByText(/AI roundtable\./i)).toBeInTheDocument();
    expect(screen.getByText(/not the real people/i)).toBeInTheDocument();
    expect(screen.getByText(/Paul Graham, Sam Altman, and Elon Musk/)).toBeInTheDocument();
  });

  it('joins two personas with "and"', () => {
    render(
      <ImpressionCard
        kind="roundtable"
        personas={[
          { username: 'a', displayName: 'Alice' },
          { username: 'b', displayName: 'Bob' },
        ]}
      />,
    );
    expect(screen.getByText(/Alice and Bob/)).toBeInTheDocument();
  });

  it('has aria-label that screen readers announce as a note', () => {
    render(
      <ImpressionCard
        kind="solo"
        personas={[{ username: 'a', displayName: 'A' }]}
      />,
    );
    const note = screen.getByRole('note');
    expect(note).toHaveAttribute('aria-label', 'About AI impressions');
  });

  it('mentions citation links as the place to verify', () => {
    render(
      <ImpressionCard
        kind="solo"
        personas={[{ username: 'a', displayName: 'A' }]}
      />,
    );
    expect(screen.getByText(/source material you can verify/i)).toBeInTheDocument();
  });

  describe('prior-only mode', () => {
    it("solo prior-only swaps 'public writing' for 'model's general knowledge'", () => {
      render(
        <ImpressionCard
          kind="solo"
          personas={[{ username: 'steve-jobs', displayName: 'Steve Jobs', mode: 'prior-only' }]}
        />,
      );
      expect(
        screen.getByText(/drawn from the model's general knowledge of them/i),
      ).toBeInTheDocument();
      expect(screen.queryByText(/trained on their public writing/i)).not.toBeInTheDocument();
    });

    it('solo prior-only replaces the citation promise with a no-citations note', () => {
      render(
        <ImpressionCard
          kind="solo"
          personas={[{ username: 'steve-jobs', displayName: 'Steve Jobs', mode: 'prior-only' }]}
        />,
      );
      expect(screen.getByText(/no citations to verify/i)).toBeInTheDocument();
      expect(screen.queryByText(/source material you can verify/i)).not.toBeInTheDocument();
    });

    it('roundtable with mixed modes calls out the split', () => {
      render(
        <ImpressionCard
          kind="roundtable"
          personas={[
            { username: 'paulg', displayName: 'Paul Graham', mode: 'grounded' },
            { username: 'steve-jobs', displayName: 'Steve Jobs', mode: 'prior-only' },
          ]}
        />,
      );
      expect(
        screen.getByText(/some trained on their public writing.*general knowledge/i),
      ).toBeInTheDocument();
      expect(screen.getByText(/look for the ↗ links where source material exists/i)).toBeInTheDocument();
    });

    it('treats legacy corpora (undefined mode) as grounded', () => {
      render(
        <ImpressionCard
          kind="solo"
          personas={[{ username: 'paulg', displayName: 'Paul Graham' }]}
        />,
      );
      expect(screen.getByText(/trained on their public writing/i)).toBeInTheDocument();
    });
  });
});
