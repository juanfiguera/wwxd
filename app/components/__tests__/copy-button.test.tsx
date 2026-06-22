import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopyButton } from '../copy-button';

const toastError = vi.fn();
vi.mock('../toast', () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

beforeEach(() => {
  toastError.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mockClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  });
}

describe('CopyButton', () => {
  it('writes the resolved text to the clipboard on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    render(<CopyButton getText={() => 'hello world'} title="Copy message" />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /copy message/i }));
    });

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith('hello world');
  });

  it('resolves getText lazily at click time', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    let current = 'first';
    render(<CopyButton getText={() => current} title="Copy message" />);

    current = 'second';
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /copy message/i }));
    });

    expect(writeText).toHaveBeenCalledWith('second');
  });

  it('shows a transient "Copied" confirmation then reverts', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    render(
      <CopyButton getText={() => 'x'} title="Copy chat" label="copy chat" />,
    );

    const btn = screen.getByRole('button', { name: /copy chat/i });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(btn.textContent).toMatch(/copied/i);

    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(btn.textContent).toMatch(/copy chat/i);
    expect(btn.textContent).not.toMatch(/copied/i);
  });

  it('does nothing for blank text (no clipboard write)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    render(<CopyButton getText={() => '   '} title="Copy message" />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /copy message/i }));
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('toasts an error when the clipboard write fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    mockClipboard(writeText);
    // execCommand fallback also fails.
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn(() => false),
      configurable: true,
      writable: true,
    });
    render(<CopyButton getText={() => 'x'} title="Copy message" />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /copy message/i }));
    });

    expect(toastError).toHaveBeenCalledOnce();
  });
});
