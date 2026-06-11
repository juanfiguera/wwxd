import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockPath = '/app';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPath,
}));

import { ChatShell } from '../chat-shell';

beforeEach(() => {
  mockPath = '/app';
});
afterEach(() => {
  // The shell locks body scroll while drawer is open; make sure each test
  // starts unlocked.
  document.body.style.overflow = '';
  vi.restoreAllMocks();
});

describe('ChatShell — mobile drawer behavior', () => {
  it('renders the rail and the children passed in', () => {
    render(
      <ChatShell rail={<aside data-testid="the-rail">rail content</aside>}>
        <main data-testid="kids">child content</main>
      </ChatShell>,
    );
    expect(screen.getByTestId('the-rail')).toBeInTheDocument();
    expect(screen.getByTestId('kids')).toBeInTheDocument();
  });

  it('opens the drawer when the hamburger is clicked', () => {
    render(
      <ChatShell rail={<div>rail</div>}>
        <div>content</div>
      </ChatShell>,
    );
    // Backdrop is the "Close navigation" button — absent until open.
    expect(screen.queryByRole('button', { name: /close navigation/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /open navigation/i }));
    expect(screen.getByRole('button', { name: /close navigation/i })).toBeInTheDocument();
  });

  it('closes the drawer when the backdrop is tapped', () => {
    render(
      <ChatShell rail={<div>rail</div>}>
        <div>content</div>
      </ChatShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: /open navigation/i }));
    fireEvent.click(screen.getByRole('button', { name: /close navigation/i }));
    expect(screen.queryByRole('button', { name: /close navigation/i })).toBeNull();
  });

  it('closes the drawer when Escape is pressed', () => {
    render(
      <ChatShell rail={<div>rail</div>}>
        <div>content</div>
      </ChatShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: /open navigation/i }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: /close navigation/i })).toBeNull();
  });

  it('locks body scroll while the drawer is open and restores on close', () => {
    document.body.style.overflow = 'auto';
    render(
      <ChatShell rail={<div>rail</div>}>
        <div>content</div>
      </ChatShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: /open navigation/i }));
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.body.style.overflow).toBe('auto');
  });

  it('closes the drawer when the route changes', () => {
    const { rerender } = render(
      <ChatShell rail={<div>rail</div>}>
        <div>content</div>
      </ChatShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: /open navigation/i }));
    expect(screen.getByRole('button', { name: /close navigation/i })).toBeInTheDocument();
    mockPath = '/app/elonmusk';
    rerender(
      <ChatShell rail={<div>rail</div>}>
        <div>content</div>
      </ChatShell>,
    );
    expect(screen.queryByRole('button', { name: /close navigation/i })).toBeNull();
  });
});
