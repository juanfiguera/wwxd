import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockPath = '/';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPath,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('../use-pull-job', () => ({
  usePullJob: () => ({
    status: { state: 'idle' },
    start: vi.fn(),
    reset: vi.fn(),
  }),
}));

import {
  ChatRailClient,
  type RailConv,
  type RailGroup,
  type RailPersona,
} from '../chat-rail-client';

const personas: RailPersona[] = [
  {
    username: 'paulg',
    displayName: 'Paul Graham',
    tweetCount: 850,
    fetchedAt: new Date(Date.now() - 60_000).toISOString(),
    accent: '#b45309',
  },
  {
    username: 'sama',
    displayName: 'Sam Altman',
    tweetCount: 1200,
    fetchedAt: new Date(Date.now() - 120_000).toISOString(),
    accent: '#17a44e',
  },
];

const groups: RailGroup[] = [
  {
    id: 'g1',
    name: 'Founders',
    personas: ['paulg', 'sama'],
    accent: '#b45309',
  },
];

const recent: RailConv[] = [
  {
    kind: 'solo',
    key: 'paulg',
    displayName: 'Paul Graham',
    members: ['paulg'],
    memberDisplayNames: ['Paul Graham'],
    messageCount: 4,
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
    accent: '#b45309',
  },
  {
    kind: 'roundtable',
    key: 'paulg,sama',
    displayName: 'Paul Graham, Sam Altman',
    members: ['paulg', 'sama'],
    memberDisplayNames: ['Paul Graham', 'Sam Altman'],
    groupId: 'g1',
    messageCount: 12,
    updatedAt: new Date(Date.now() - 120_000).toISOString(),
    accent: '#17a44e',
  },
];

const savedFetch = globalThis.fetch;
const savedConfirm = globalThis.confirm;

beforeEach(() => {
  mockPath = '/';
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  globalThis.confirm = vi.fn().mockReturnValue(true);
});
afterEach(() => {
  globalThis.fetch = savedFetch;
  globalThis.confirm = savedConfirm;
  vi.restoreAllMocks();
});

describe('ChatRailClient — recent', () => {
  it('renders the "+ New conversation" link', () => {
    render(
      <ChatRailClient personas={personas} groups={groups} recent={recent} />,
    );
    expect(screen.getByText(/New conversation/)).toBeInTheDocument();
  });

  it('renders recent conversations under a "Recent" section', () => {
    render(
      <ChatRailClient personas={personas} groups={groups} recent={recent} />,
    );
    expect(screen.getByText(/Recent/)).toBeInTheDocument();
    // Paul Graham appears in the solo row.
    expect(screen.getAllByText('Paul Graham').length).toBeGreaterThan(0);
    // The roundtable display name appears too (may also appear in hover state).
    expect(screen.getAllByText('Paul Graham, Sam Altman').length).toBeGreaterThan(0);
  });

  it('renders an empty-state CTA when no recent conversations exist', () => {
    render(
      <ChatRailClient personas={personas} groups={groups} recent={[]} />,
    );
    expect(screen.getByText(/No conversations yet/)).toBeInTheDocument();
  });

  it('links solo recent rows to /<username>', () => {
    render(
      <ChatRailClient personas={personas} groups={groups} recent={recent} />,
    );
    const link = screen.getByText('Paul Graham').closest('a');
    expect(link?.getAttribute('href')).toBe('/paulg');
  });

  it('links group recent rows to /compare?... with group id', () => {
    render(
      <ChatRailClient personas={personas} groups={groups} recent={recent} />,
    );
    // The first match is in the recent row (hover-text comes later in DOM).
    const link = screen.getAllByText('Paul Graham, Sam Altman')[0].closest('a');
    expect(link?.getAttribute('href')).toMatch(/^\/compare\?/);
    expect(link?.getAttribute('href')).toContain('group=g1');
  });
});

describe('ChatRailClient — search', () => {
  it('opens the filter input when the search button is clicked', () => {
    render(
      <ChatRailClient personas={personas} groups={groups} recent={recent} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
    expect(screen.getByPlaceholderText(/Filter/i)).toBeInTheDocument();
  });

  it('reveals the Personas section only when a search query is entered', () => {
    render(
      <ChatRailClient personas={personas} groups={groups} recent={recent} />,
    );
    // Without query, Personas section is hidden.
    expect(screen.queryByText(/Personas/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
    fireEvent.change(screen.getByPlaceholderText(/Filter/i), {
      target: { value: 'paul' },
    });
    expect(screen.getByText(/Personas/i)).toBeInTheDocument();
  });

  it('reveals the Rooms (groups) section when a search query matches', () => {
    render(
      <ChatRailClient personas={personas} groups={groups} recent={recent} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
    fireEvent.change(screen.getByPlaceholderText(/Filter/i), {
      target: { value: 'founders' },
    });
    expect(screen.getByText(/Rooms/i)).toBeInTheDocument();
  });

  it('shows a "no matches" message when the query matches nothing', () => {
    render(
      <ChatRailClient personas={personas} groups={groups} recent={recent} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
    fireEvent.change(screen.getByPlaceholderText(/Filter/i), {
      target: { value: 'zzzzz' },
    });
    expect(screen.getByText(/No matches/i)).toBeInTheDocument();
  });

  it('closes search when "✕" is clicked', () => {
    render(
      <ChatRailClient personas={personas} groups={groups} recent={recent} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
    fireEvent.click(screen.getByRole('button', { name: /close search/i }));
    expect(screen.queryByPlaceholderText(/Filter/i)).toBeNull();
  });
});

describe('ChatRailClient — footer', () => {
  it('highlights the Settings link when path starts with /settings', () => {
    mockPath = '/settings';
    render(
      <ChatRailClient personas={personas} groups={groups} recent={recent} />,
    );
    const settings = screen.getByRole('link', { name: /settings/i });
    // Active styling adds shadow class.
    expect(settings.className).toMatch(/shadow/);
  });

  it('does not highlight Settings on /<username>', () => {
    mockPath = '/paulg';
    render(
      <ChatRailClient personas={personas} groups={groups} recent={recent} />,
    );
    const settings = screen.getByRole('link', { name: /settings/i });
    expect(settings.className).not.toMatch(/bg-white/);
  });
});
