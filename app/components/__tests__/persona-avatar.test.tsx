import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PersonaAvatar } from '../persona-avatar';

describe('PersonaAvatar', () => {
  it('renders an SVG with the configured width (height auto-scales to viewBox)', () => {
    const { container } = render(
      <PersonaAvatar color="#2e6bf6" crown="antenna" size={48} eyeColor="#fff" />,
    );
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute('width')).toBe('48');
    // height is 48 × (112/100) = 53.76 — preserve aspect ratio
    expect(svg!.getAttribute('height')).toBe('53.76');
  });

  it('renders different crowns without crashing', () => {
    const crowns = ['bumps', 'sprout', 'spikes', 'antenna', 'ears', 'horns', 'tuft', 'flat'] as const;
    for (const crown of crowns) {
      const { container, unmount } = render(
        <PersonaAvatar color="#ff5c8a" crown={crown} size={36} eyeColor="#fff" />,
      );
      expect(container.querySelector('svg')).toBeTruthy();
      unmount();
    }
  });

  it('sets role + aria-label when title is provided (a11y hook)', () => {
    const { container } = render(
      <PersonaAvatar
        color="#0e9c8e"
        crown="flat"
        size={48}
        eyeColor="#fff"
        title="Naval Ravikant"
      />,
    );
    const svg = container.querySelector('svg');
    expect(svg!.getAttribute('role')).toBe('img');
    expect(svg!.getAttribute('aria-label')).toBe('Naval Ravikant');
  });

  it('marks itself aria-hidden when no title is provided', () => {
    const { container } = render(
      <PersonaAvatar color="#0e9c8e" crown="flat" size={48} eyeColor="#fff" />,
    );
    const svg = container.querySelector('svg');
    expect(svg!.getAttribute('aria-hidden')).toBe('true');
    expect(svg!.getAttribute('role')).toBe('presentation');
  });
});
