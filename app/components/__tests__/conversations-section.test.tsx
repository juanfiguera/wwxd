import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routerRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

import { ConversationsSection, type RecentConversation } from '../conversations-section';

const savedFetch = globalThis.fetch;
const savedConfirm = globalThis.confirm;

beforeEach(() => {
  routerRefresh.mockClear();
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  globalThis.confirm = vi.fn().mockReturnValue(true);
});
afterEach(() => {
  globalThis.fetch = savedFetch;
  globalThis.confirm = savedConfirm;
  vi.restoreAllMocks();
});

const solo: RecentConversation = {
  kind: 'solo',
  key: 'paulg',
  updatedAt: new Date(Date.now() - 60_000).toISOString(),
  messageCount: 4,
  participants: [{ username: 'paulg', displayName: 'Paul Graham' }],
};
const round: RecentConversation = {
  kind: 'roundtable',
  key: 'paulg,sama',
  updatedAt: new Date(Date.now() - 120_000).toISOString(),
  messageCount: 12,
  participants: [
    { username: 'paulg', displayName: 'Paul Graham' },
    { username: 'sama', displayName: 'Sam Altman' },
  ],
};

describe('ConversationsSection', () => {
  it('renders nothing when there are no recent conversations', () => {
    const { container } = render(<ConversationsSection conversations={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders solo conversations with the "solo" badge', () => {
    render(<ConversationsSection conversations={[solo]} />);
    expect(screen.getByText('solo')).toBeInTheDocument();
    expect(screen.getByText('Paul Graham')).toBeInTheDocument();
  });

  it('renders roundtable conversations with comma-joined display names', () => {
    render(<ConversationsSection conversations={[round]} />);
    expect(screen.getByText('roundtable')).toBeInTheDocument();
    expect(screen.getByText('Paul Graham, Sam Altman')).toBeInTheDocument();
  });

  it('links solo to /<username> and roundtable to /compare?...', () => {
    render(<ConversationsSection conversations={[solo, round]} />);
    const links = screen.getAllByRole('link');
    expect(links.find((a) => a.getAttribute('href')?.startsWith('/paulg'))).toBeTruthy();
    expect(
      links.find((a) =>
        a.getAttribute('href')?.startsWith('/compare?personas=paulg%2Csama'),
      ),
    ).toBeTruthy();
  });

  it('singularizes "1 message"', () => {
    render(
      <ConversationsSection
        conversations={[{ ...solo, messageCount: 1 }]}
      />,
    );
    expect(screen.getByText(/1 message/i)).toBeInTheDocument();
  });

  it('on delete + confirm + 204, hides the row and refreshes the router', async () => {
    render(<ConversationsSection conversations={[solo]} />);
    await act(async () => {
      fireEvent.click(
        screen.getAllByRole('button', { name: /delete conversation/i })[0],
      );
    });
    await waitFor(() => {
      expect(routerRefresh).toHaveBeenCalled();
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/conversations?kind=solo&key=paulg',
      { method: 'DELETE' },
    );
    expect(screen.queryByText('Paul Graham')).toBeNull();
  });

  it('does nothing when the user cancels the confirm', () => {
    (globalThis.confirm as ReturnType<typeof vi.fn>).mockReturnValue(false);
    render(<ConversationsSection conversations={[solo]} />);
    fireEvent.click(screen.getAllByRole('button', { name: /delete conversation/i })[0]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(routerRefresh).not.toHaveBeenCalled();
    expect(screen.getByText('Paul Graham')).toBeInTheDocument();
  });

  it('only renders the first 8 conversations', () => {
    const many: RecentConversation[] = Array.from({ length: 10 }, (_, i) => ({
      ...solo,
      key: `user${i}`,
      participants: [{ username: `user${i}`, displayName: `User ${i}` }],
    }));
    render(<ConversationsSection conversations={many} />);
    // 8 visible
    expect(screen.getAllByText('solo')).toHaveLength(8);
  });
});
