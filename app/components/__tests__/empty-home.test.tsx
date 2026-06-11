import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyHome } from '../empty-home';

describe('EmptyHome (first-run welcome)', () => {
  it('headlines the build-your-cast call to action', () => {
    render(<EmptyHome />);
    expect(screen.getByText('Build your first cast.')).toBeInTheDocument();
  });

  it('explains the ingestion pipeline at a high level', () => {
    render(<EmptyHome />);
    expect(
      screen.getByText(/tweets, optionally their essays and YouTube transcripts/i),
    ).toBeInTheDocument();
  });

  it('renders the "Add anyone" prompt above the lifted persona', () => {
    render(<EmptyHome />);
    expect(screen.getByText('Add anyone')).toBeInTheDocument();
  });

  it('shows the five preview avatars', () => {
    const { container } = render(<EmptyHome />);
    expect(container.querySelectorAll('svg').length).toBe(5);
  });

  it('suggests known starter handles', () => {
    render(<EmptyHome />);
    expect(screen.getByText('garrytan')).toBeInTheDocument();
    expect(screen.getByText('pmarca')).toBeInTheDocument();
    expect(screen.getByText('naval')).toBeInTheDocument();
  });
});
