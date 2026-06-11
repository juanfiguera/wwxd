import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeToasts, toast, type ToastItem } from '../toast';
import { ToastTray } from '../toast-tray';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  // Drain any pending toasts so a test doesn't leak into the next.
  act(() => {
    vi.runAllTimers();
  });
  vi.useRealTimers();
});

describe('toast emitter', () => {
  it('delivers an emitted item to subscribers', () => {
    const items: ToastItem[][] = [];
    const unsubscribe = subscribeToasts((next) => items.push(next));
    act(() => {
      toast.error('boom');
    });
    expect(items.at(-1)).toMatchObject([{ kind: 'error', text: 'boom' }]);
    unsubscribe();
  });

  it('auto-dismisses after the default TTL (~4.5s)', () => {
    const items: ToastItem[][] = [];
    const unsubscribe = subscribeToasts((next) => items.push(next));
    act(() => {
      toast.success('saved');
    });
    expect(items.at(-1)).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(items.at(-1)).toEqual([]);
    unsubscribe();
  });

  it('honors an explicit TTL override', () => {
    const items: ToastItem[][] = [];
    const unsubscribe = subscribeToasts((next) => items.push(next));
    act(() => {
      toast.info('quick', 200);
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(items.at(-1)).toEqual([]);
    unsubscribe();
  });

  it('can be dismissed by id immediately', () => {
    const items: ToastItem[][] = [];
    const unsubscribe = subscribeToasts((next) => items.push(next));
    let id = '';
    act(() => {
      id = toast.error('to dismiss');
    });
    expect(items.at(-1)).toHaveLength(1);
    act(() => {
      toast.dismiss(id);
    });
    expect(items.at(-1)).toEqual([]);
    unsubscribe();
  });

  it('multiple toasts queue independently and dismiss independently', () => {
    const items: ToastItem[][] = [];
    const unsubscribe = subscribeToasts((next) => items.push(next));
    act(() => {
      toast.error('one', 200);
      toast.success('two', 800);
    });
    expect(items.at(-1)).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(items.at(-1)?.map((t) => t.text)).toEqual(['two']);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(items.at(-1)).toEqual([]);
    unsubscribe();
  });
});

describe('ToastTray rendering', () => {
  it('mounts and renders nothing when no toasts are active', () => {
    const { container } = render(<ToastTray />);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('renders an error pill when toast.error is called', () => {
    render(<ToastTray />);
    act(() => {
      toast.error('failed to save', 60_000);
    });
    expect(screen.getByText('failed to save')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders a success pill with the check glyph', () => {
    render(<ToastTray />);
    act(() => {
      toast.success('saved!', 60_000);
    });
    const pill = screen.getByText('saved!');
    expect(pill).toBeInTheDocument();
    // success pills include ✓ as a sibling span
    expect(pill.parentElement!.textContent).toContain('✓');
  });

  it('clicking a pill dismisses just that toast', () => {
    render(<ToastTray />);
    act(() => {
      toast.error('alpha', 60_000);
      toast.error('beta', 60_000);
    });
    expect(screen.getByText('alpha')).toBeInTheDocument();
    fireEvent.click(screen.getByText('alpha').closest('button')!);
    expect(screen.queryByText('alpha')).toBeNull();
    expect(screen.getByText('beta')).toBeInTheDocument();
  });
});
