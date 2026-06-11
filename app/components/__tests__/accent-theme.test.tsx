import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AccentTheme } from '../accent-theme';

afterEach(() => {
  document.documentElement.style.removeProperty('--accent');
  document.documentElement.style.removeProperty('--accent-soft');
});

describe('AccentTheme', () => {
  it('renders nothing (it only sets CSS variables)', () => {
    const { container } = render(<AccentTheme color="#ff0000" />);
    expect(container.firstChild).toBeNull();
  });

  it('writes --accent and --accent-soft on documentElement', () => {
    render(<AccentTheme color="#2e6bf6" />);
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#2e6bf6');
    expect(
      document.documentElement.style.getPropertyValue('--accent-soft'),
    ).toMatch(/^rgb/); // tintHex returns rgb(...)
  });

  it('restores the previous accent on unmount', () => {
    document.documentElement.style.setProperty('--accent', '#previous');
    const { unmount } = render(<AccentTheme color="#abc123" />);
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#abc123');
    unmount();
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#previous');
  });

  it('falls back to the default accent if nothing was set previously', () => {
    const { unmount } = render(<AccentTheme color="#abc123" />);
    unmount();
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#2e6bf6');
  });

  it('updates the variables when color prop changes', () => {
    const { rerender } = render(<AccentTheme color="#aaaaaa" />);
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#aaaaaa');
    rerender(<AccentTheme color="#bbbbbb" />);
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#bbbbbb');
  });
});
