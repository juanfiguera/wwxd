import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AIBadge } from '../ai-badge';

describe('AIBadge', () => {
  it('renders the literal "AI" text', () => {
    render(<AIBadge />);
    expect(screen.getByText('AI')).toBeInTheDocument();
  });

  it('exposes the disclaimer via title attribute for hover/screen readers', () => {
    render(<AIBadge />);
    const badge = screen.getByText('AI');
    expect(badge.getAttribute('title')).toMatch(/AI-generated impression/i);
  });

  it('applies the provided accent color', () => {
    render(<AIBadge tone="#ff0000" />);
    expect(screen.getByText('AI').style.color).toBe('#ff0000');
  });

  it('defaults to the ink-faint css variable when no tone is provided', () => {
    render(<AIBadge />);
    expect(screen.getByText('AI').style.color).toBe('var(--ink-faint)');
  });

  it('renders smaller when size="xs"', () => {
    const { rerender } = render(<AIBadge size="sm" />);
    const sm = screen.getByText('AI').className;
    rerender(<AIBadge size="xs" />);
    const xs = screen.getByText('AI').className;
    expect(sm).not.toEqual(xs);
    expect(xs).toMatch(/text-\[9px\]/);
  });
});
