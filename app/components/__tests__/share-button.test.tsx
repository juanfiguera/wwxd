import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareButton } from '../share-button';

const personas = [{ username: 'paulg', displayName: 'Paul Graham' }];
const messages = [
  { role: 'user' as const, text: 'hi' },
  { role: 'assistant' as const, text: 'hello.' },
];

beforeEach(() => {
  // Provide a mock clipboard API.
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
    writable: true,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('ShareButton — disabled state', () => {
  it('is disabled when there are no non-empty messages', () => {
    render(<ShareButton kind="solo" personas={personas} messages={[]} />);
    const btn = screen.getByRole('button', { name: /share conversation/i });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('title')).toMatch(/nothing to share/i);
  });

  it('is disabled when only empty-text messages are present', () => {
    render(
      <ShareButton
        kind="solo"
        personas={personas}
        messages={[{ role: 'user', text: '   ' }]}
      />,
    );
    expect(screen.getByRole('button', { name: /share conversation/i })).toBeDisabled();
  });

  it('is disabled when the disabled prop is true', () => {
    render(<ShareButton kind="solo" personas={personas} messages={messages} disabled />);
    expect(screen.getByRole('button', { name: /share conversation/i })).toBeDisabled();
  });
});

describe('ShareButton — menu interaction', () => {
  it('opens the menu on click and shows three actions', () => {
    render(<ShareButton kind="solo" personas={personas} messages={messages} />);
    fireEvent.click(screen.getByRole('button', { name: /share conversation/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('Copy as Markdown')).toBeInTheDocument();
    expect(screen.getByText('Copy as plain text')).toBeInTheDocument();
    expect(screen.getByText('Download .wwxd.json')).toBeInTheDocument();
  });

  it('closes the menu when Escape is pressed', () => {
    render(<ShareButton kind="solo" personas={personas} messages={messages} />);
    fireEvent.click(screen.getByRole('button', { name: /share conversation/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes the menu on a mousedown outside the trigger + menu', () => {
    render(
      <div>
        <span data-testid="outside">outside</span>
        <ShareButton kind="solo" personas={personas} messages={messages} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: /share conversation/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('copies markdown to clipboard with the disclaimer block + AI suffix on speakers', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(<ShareButton kind="solo" personas={personas} messages={messages} />);
    fireEvent.click(screen.getByRole('button', { name: /share conversation/i }));
    fireEvent.click(screen.getByText('Copy as Markdown'));
    // Resolve the writeText promise.
    await Promise.resolve();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledOnce();
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain('# Paul Graham');
    expect(text).toContain('> **AI impression');
    expect(text).toContain('**Paul Graham (AI):**');
  });

  it('copies plain text without markdown bold', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(<ShareButton kind="solo" personas={personas} messages={messages} />);
    fireEvent.click(screen.getByRole('button', { name: /share conversation/i }));
    fireEvent.click(screen.getByText('Copy as plain text'));
    await Promise.resolve();
    await Promise.resolve();

    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain('Paul Graham (AI): hello.');
    expect(text).not.toContain('**');
  });

  it('shows a "Copied!" confirmation after a successful copy', async () => {
    render(<ShareButton kind="solo" personas={personas} messages={messages} />);
    fireEvent.click(screen.getByRole('button', { name: /share conversation/i }));
    fireEvent.click(screen.getByText('Copy as Markdown'));
    await Promise.resolve();
    await Promise.resolve();
    expect(await screen.findByText('Copied!')).toBeInTheDocument();
  });

  it('falls back to execCommand when navigator.clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('not allowed')) },
      configurable: true,
    });
    document.execCommand = vi.fn().mockReturnValue(true) as unknown as typeof document.execCommand;

    render(<ShareButton kind="solo" personas={personas} messages={messages} />);
    fireEvent.click(screen.getByRole('button', { name: /share conversation/i }));
    fireEvent.click(screen.getByText('Copy as Markdown'));
    await Promise.resolve();
    await Promise.resolve();

    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });
});

describe('ShareButton — JSON download', () => {
  it('creates a download link with a .wwxd.json filename when the action fires', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectURL,
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectURL,
      configurable: true,
    });

    let lastAnchor: HTMLAnchorElement | null = null;
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreate(tag);
      if (tag === 'a') {
        lastAnchor = el as HTMLAnchorElement;
        el.click = vi.fn(); // don't trigger an actual navigation
      }
      return el;
    });

    render(
      <ShareButton kind="roundtable" title="Board" personas={personas} messages={messages} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /share conversation/i }));
    fireEvent.click(screen.getByText('Download .wwxd.json'));

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(lastAnchor!.download).toMatch(/board-\d{4}-\d{2}-\d{2}\.wwxd\.json$/);
    expect(lastAnchor!.click).toHaveBeenCalledOnce();
  });
});
