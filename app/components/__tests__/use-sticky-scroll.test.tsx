import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useStickyScroll } from '../use-sticky-scroll';

function Harness() {
  const { ref, pinned, scrollToBottom, ping } = useStickyScroll<HTMLDivElement>();
  return (
    <div>
      <span data-testid="pinned">{pinned ? 'yes' : 'no'}</span>
      <div ref={ref} data-testid="scroll">
        content
      </div>
      <button data-testid="ping" onClick={() => ping()}>
        ping
      </button>
      <button data-testid="snap" onClick={() => scrollToBottom('auto')}>
        snap
      </button>
    </div>
  );
}

function setScrollGeometry(el: HTMLElement, scrollTop: number, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, configurable: true, writable: true });
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
}

describe('useStickyScroll', () => {
  it('starts pinned (auto-scroll engaged)', () => {
    const { getByTestId } = render(<Harness />);
    expect(getByTestId('pinned').textContent).toBe('yes');
  });

  it('marks unpinned when the user scrolls far from the bottom', () => {
    const { getByTestId } = render(<Harness />);
    const el = getByTestId('scroll');
    setScrollGeometry(el, 0, 1000, 300); // 700px from bottom
    act(() => {
      el.dispatchEvent(new Event('scroll'));
    });
    expect(getByTestId('pinned').textContent).toBe('no');
  });

  it('re-pins automatically once the user scrolls back near the bottom', () => {
    const { getByTestId } = render(<Harness />);
    const el = getByTestId('scroll');

    setScrollGeometry(el, 0, 1000, 300);
    act(() => el.dispatchEvent(new Event('scroll')));
    expect(getByTestId('pinned').textContent).toBe('no');

    setScrollGeometry(el, 750, 1000, 300); // distance = 0, well within threshold
    act(() => el.dispatchEvent(new Event('scroll')));
    expect(getByTestId('pinned').textContent).toBe('yes');
  });

  it('ping() scrolls when pinned, no-ops when unpinned', () => {
    const { getByTestId } = render(<Harness />);
    const el = getByTestId('scroll');
    el.scrollTo = vi.fn();
    setScrollGeometry(el, 750, 1000, 300);

    act(() => getByTestId('ping').click());
    expect(el.scrollTo).toHaveBeenCalledTimes(1);

    // Detach: user scrolls up.
    setScrollGeometry(el, 0, 1000, 300);
    act(() => el.dispatchEvent(new Event('scroll')));
    expect(getByTestId('pinned').textContent).toBe('no');

    (el.scrollTo as ReturnType<typeof vi.fn>).mockClear();
    act(() => getByTestId('ping').click());
    expect(el.scrollTo).not.toHaveBeenCalled();
  });

  it('scrollToBottom() snaps regardless of pinned state and re-pins', () => {
    const { getByTestId } = render(<Harness />);
    const el = getByTestId('scroll');
    el.scrollTo = vi.fn();

    setScrollGeometry(el, 0, 1000, 300);
    act(() => el.dispatchEvent(new Event('scroll')));
    expect(getByTestId('pinned').textContent).toBe('no');

    act(() => getByTestId('snap').click());
    expect(el.scrollTo).toHaveBeenCalledTimes(1);
    expect(getByTestId('pinned').textContent).toBe('yes');
  });
});
