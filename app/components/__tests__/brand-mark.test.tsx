import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandMark } from '../brand-mark';

describe('BrandMark', () => {
  it('renders the "wwxd" wordmark', () => {
    render(<BrandMark />);
    expect(screen.getByText('wwxd')).toBeInTheDocument();
  });

  it('includes the mascot SVG', () => {
    const { container } = render(<BrandMark size={32} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute('width')).toBe('32');
  });

  it('font-size scales with the size prop', () => {
    render(<BrandMark size={50} />);
    const span = screen.getByText('wwxd');
    expect(span.style.fontSize).toBe('41px'); // 50 * 0.82
  });

  it('passes className through', () => {
    render(<BrandMark className="my-custom-class" />);
    const span = screen.getByText('wwxd');
    expect(span.className).toContain('my-custom-class');
  });
});
