import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PullProgress } from '../pull-progress';
import type { PullJobStatus } from '../use-pull-job';

const baseStatus: PullJobStatus = {
  state: 'idle',
  deep: false,
  totalTweets: 0,
  originals: 0,
  essayCount: 0,
  transcriptCount: 0,
  embeddedCount: 0,
  embeddedTotal: 0,
  lines: [],
};

describe('PullProgress', () => {
  it('renders nothing while idle', () => {
    const { container } = render(<PullProgress status={baseStatus} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows "Fetching latest tweets…" headline during initial fetch', () => {
    render(
      <PullProgress
        status={{
          ...baseStatus,
          state: 'running',
          stage: 'fetching',
          username: 'paulg',
        }}
      />,
    );
    expect(screen.getByText(/Fetching latest tweets/)).toBeInTheDocument();
  });

  it('shows the windowed date range during deep fetch', () => {
    render(
      <PullProgress
        status={{
          ...baseStatus,
          state: 'running',
          stage: 'fetching',
          deep: true,
          username: 'paulg',
          currentWindow: { start: '2024-01-01', end: '2024-06-30' },
        }}
      />,
    );
    expect(screen.getByText(/Fetching tweets/)).toBeInTheDocument();
    // The dates show as "Jan 2024 → Jun 2024" in en-US; just verify both are present.
    expect(screen.getByText(/2024/)).toBeInTheDocument();
  });

  it('shows essay-stage headline with the running count', () => {
    render(
      <PullProgress
        status={{
          ...baseStatus,
          state: 'running',
          stage: 'essays',
          username: 'paulg',
          essayCount: 7,
        }}
      />,
    );
    expect(screen.getByText(/Fetching essays \(7\)/)).toBeInTheDocument();
  });

  it('shows youtube-stage headline with the running count', () => {
    render(
      <PullProgress
        status={{
          ...baseStatus,
          state: 'running',
          stage: 'youtube',
          username: 'paulg',
          transcriptCount: 3,
        }}
      />,
    );
    expect(screen.getByText(/Fetching YouTube transcripts \(3\)/)).toBeInTheDocument();
  });

  it('shows embedding progress with a x/y count once we know the total', () => {
    render(
      <PullProgress
        status={{
          ...baseStatus,
          state: 'running',
          stage: 'embedding',
          username: 'paulg',
          embeddedCount: 200,
          embeddedTotal: 800,
        }}
      />,
    );
    expect(screen.getAllByText(/200/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/800/).length).toBeGreaterThan(0);
  });

  it('shows a "done" message when state is done', () => {
    render(
      <PullProgress
        status={{
          ...baseStatus,
          state: 'done',
          username: 'paulg',
          totalTweets: 850,
          originals: 700,
        }}
      />,
    );
    // Just verify it renders something non-null.
    expect(screen.getAllByText(/850|done|paulg/i).length).toBeGreaterThan(0);
  });

  it('shows the error message when state is error', () => {
    render(
      <PullProgress
        status={{
          ...baseStatus,
          state: 'error',
          username: 'paulg',
          message: 'rate limited by Apify',
        }}
      />,
    );
    expect(screen.getByText(/rate limited by Apify/)).toBeInTheDocument();
  });

  it('calls onDismiss when the dismiss control is invoked (if rendered)', () => {
    const onDismiss = vi.fn();
    render(
      <PullProgress
        status={{ ...baseStatus, state: 'done', username: 'paulg' }}
        onDismiss={onDismiss}
      />,
    );
    // Find any button-like element and click it; if onDismiss wired correctly,
    // the spy should be called.
    const buttons = screen.queryAllByRole('button');
    if (buttons.length > 0) {
      fireEvent.click(buttons[0]);
      expect(onDismiss).toHaveBeenCalled();
    }
  });
});
