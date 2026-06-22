'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

// Roughly eight lines at the resting font size; past this the textarea scrolls
// instead of pushing the composer up the screen.
const MAX_HEIGHT_PX = 200;

type ChatInputProps = {
  value: string;
  onChange: (value: string) => void;
  /** Fired on Enter (without Shift) and IME-safe. The form's submit button
   *  drives submission separately, so this only covers the keyboard path. */
  onSubmit: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** When true, Enter is swallowed (nothing to send / busy) rather than
   *  submitting. Shift+Enter still inserts a newline. */
  disableSubmit?: boolean;
  'aria-label'?: string;
};

/**
 * Auto-growing chat composer. Starts at one line and expands with content up to
 * MAX_HEIGHT_PX, so a multi-line prompt stays fully visible instead of
 * scrolling out of a fixed single-line input.
 */
export const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(
  function ChatInput(
    { value, onChange, onSubmit, placeholder, autoFocus, disableSubmit, ...rest },
    forwardedRef,
  ) {
    const ref = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(forwardedRef, () => ref.current as HTMLTextAreaElement);

    // Recompute height on every value change — including the programmatic reset
    // to '' after a send, which must snap the box back to one line. Collapse to
    // auto first so the box can shrink, not just grow.
    useEffect(() => {
      const el = ref.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
    }, [value]);

    function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
      // Enter sends; Shift+Enter is a newline. Skip while an IME composition is
      // open so committing a candidate doesn't fire a send.
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        if (!disableSubmit) onSubmit();
      }
    }

    return (
      <textarea
        ref={ref}
        rows={1}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="flex-1 resize-none self-center bg-transparent px-3 py-1.5 text-[15px] leading-snug text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
        style={{ maxHeight: MAX_HEIGHT_PX }}
        {...rest}
      />
    );
  },
);
