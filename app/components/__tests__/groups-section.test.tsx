import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routerRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

import { GroupsSection, type GroupSummary } from '../groups-section';

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

const personas = [
  { username: 'paulg', displayName: 'Paul Graham', tweetCount: 800, fetchedAt: '', hasEmbeddings: true },
  { username: 'sama', displayName: 'Sam Altman', tweetCount: 1200, fetchedAt: '', hasEmbeddings: true },
];

function makeGroup(over: Partial<GroupSummary>): GroupSummary {
  return {
    id: 'g1',
    name: 'Founders',
    personas: ['paulg', 'sama'],
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

describe('GroupsSection', () => {
  it('renders nothing when groups is empty', () => {
    const { container } = render(<GroupsSection groups={[]} personas={personas} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the group name and member display names', () => {
    render(<GroupsSection groups={[makeGroup({})]} personas={personas} />);
    expect(screen.getByText('Founders')).toBeInTheDocument();
    // Names are rendered as `<span>Paul Graham,</span><span>Sam Altman</span>`
    // so we match the leading text.
    expect(screen.getByText(/Paul Graham/)).toBeInTheDocument();
    expect(screen.getByText(/Sam Altman/)).toBeInTheDocument();
  });

  it('flags missing members with a "(N missing)" badge', () => {
    render(
      <GroupsSection
        groups={[makeGroup({ personas: ['paulg', 'someone-deleted'] })]}
        personas={personas}
      />,
    );
    expect(screen.getByText('(1 missing)')).toBeInTheDocument();
  });

  it('shows "no members available" when every member is missing', () => {
    render(
      <GroupsSection
        groups={[makeGroup({ personas: ['ghost1', 'ghost2'] })]}
        personas={personas}
      />,
    );
    expect(screen.getByText(/no members available/i)).toBeInTheDocument();
  });

  it('links to /app/compare with the group params for roundtable', () => {
    render(<GroupsSection groups={[makeGroup({})]} personas={personas} />);
    const link = screen.getByText('Founders').closest('a');
    expect(link?.getAttribute('href')).toBe(
      '/app/compare?personas=paulg%2Csama&group=g1&mode=roundtable',
    );
  });

  it('on confirm + 204, calls fetch DELETE and router.refresh', async () => {
    render(<GroupsSection groups={[makeGroup({})]} personas={personas} />);
    fireEvent.click(screen.getByRole('button', { name: /delete founders/i }));
    // Let microtasks resolve.
    await Promise.resolve();
    await Promise.resolve();
    expect(globalThis.confirm).toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/groups/g1', {
      method: 'DELETE',
    });
    expect(routerRefresh).toHaveBeenCalled();
  });

  it('on confirm declined, neither fetches nor refreshes', () => {
    (globalThis.confirm as ReturnType<typeof vi.fn>).mockReturnValue(false);
    render(<GroupsSection groups={[makeGroup({})]} personas={personas} />);
    fireEvent.click(screen.getByRole('button', { name: /delete founders/i }));
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(routerRefresh).not.toHaveBeenCalled();
  });
});
