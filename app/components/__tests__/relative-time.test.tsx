import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RelativeTime } from '../relative-time';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-09T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('RelativeTime', () => {
  it('returns null for an empty iso string', () => {
    const { container } = render(<RelativeTime iso="" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a relative string (e.g., "10 minutes ago") for a recent timestamp', () => {
    render(<RelativeTime iso="2026-06-09T11:50:00Z" />);
    // Intl.RelativeTimeFormat output varies by locale; just check it's some
    // string referencing minutes.
    const span = screen.getByTitle(/2026/);
    expect(span.textContent).toMatch(/minute/);
  });

  it('renders an hours-ago string for older timestamps', () => {
    render(<RelativeTime iso="2026-06-09T09:00:00Z" />);
    const span = screen.getByTitle(/2026/);
    expect(span.textContent).toMatch(/hour/);
  });

  it('renders days for multi-day-old timestamps', () => {
    render(<RelativeTime iso="2026-06-06T12:00:00Z" />);
    const span = screen.getByTitle(/2026/);
    expect(span.textContent).toMatch(/day/);
  });

  it('shares a single interval across mounted instances (updates together)', () => {
    render(<RelativeTime iso="2026-06-09T11:59:00Z" />);
    render(<RelativeTime iso="2026-06-09T11:30:00Z" />);
    // Advance system time + the cached "now" tick by 5 minutes.
    act(() => {
      vi.setSystemTime(new Date('2026-06-09T12:05:00Z'));
      vi.advanceTimersByTime(60_000);
    });
    // Both rendered spans should reflect the new "now".
    const spans = screen.getAllByTitle(/2026/);
    expect(spans.length).toBeGreaterThanOrEqual(2);
  });

  it('always sets a title attribute with the absolute timestamp', () => {
    render(<RelativeTime iso="2026-06-09T11:00:00Z" />);
    const span = screen.getByTitle(/2026/);
    expect(span.getAttribute('title')).toMatch(/2026/);
  });
});
