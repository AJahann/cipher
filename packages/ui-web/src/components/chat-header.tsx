import * as React from 'react';
import { Badge } from './primitives/badge';

export interface ChatHeaderProps {
  title?: string;
  isConnected: boolean;
}

export function ChatHeader({ title = 'Chat', isConnected }: ChatHeaderProps) {
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!shortcutsOpen) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    closeRef.current?.focus();
  }, [shortcutsOpen]);

  function closeShortcuts() {
    const dialog = dialogRef.current;
    if (dialog?.open && typeof dialog.close === 'function') dialog.close();
    else dialog?.removeAttribute('open');
    setShortcutsOpen(false);
    triggerRef.current?.focus();
  }

  function trapFocus(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeShortcuts();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (
      (!event.shiftKey && document.activeElement === last) ||
      (event.shiftKey && document.activeElement === first)
    ) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  }

  return (
    <header className='flex items-center gap-3 border-b border-[var(--cipher-border)] bg-[var(--cipher-surface)] px-5 py-3.5'>
      <h1 className='font-[var(--cipher-font-sans)] text-[13px] font-medium text-[var(--cipher-text)]'>
        {title}
      </h1>
      <span role='status' aria-live='polite' aria-atomic='true'>
        <Badge variant={isConnected ? 'connected' : 'disconnected'}>
          {isConnected ? 'connected' : 'disconnected'}
        </Badge>
      </span>
      <button
        ref={triggerRef}
        type='button'
        onClick={() => setShortcutsOpen(true)}
        className='ml-auto rounded px-2 py-1 font-[var(--cipher-font-mono)] text-[11px] text-[var(--cipher-muted)] outline-none hover:text-[var(--cipher-text)] focus-visible:ring-2 focus-visible:ring-[var(--cipher-accent)]'
      >
        Keyboard shortcuts
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby='keyboard-shortcuts-title'
        onCancel={(event) => {
          event.preventDefault();
          closeShortcuts();
        }}
        onKeyDown={trapFocus}
        className='w-[min(28rem,calc(100%-2rem))] rounded-xl border border-[var(--cipher-border)] bg-[var(--cipher-surface)] p-0 text-[var(--cipher-text)] shadow-2xl backdrop:bg-black/70'
      >
        <div className='p-5'>
          <div className='flex items-start gap-4'>
            <div className='flex-1'>
              <h2
                id='keyboard-shortcuts-title'
                className='text-base font-semibold'
              >
                Keyboard shortcuts
              </h2>
              <p className='mt-1 text-[12px] text-[var(--cipher-muted)]'>
                Work in a conversation without reaching for the mouse.
              </p>
            </div>
            <button
              ref={closeRef}
              type='button'
              aria-label='Close keyboard shortcuts'
              onClick={closeShortcuts}
              className='rounded px-2 py-1 text-lg leading-none text-[var(--cipher-muted)] outline-none hover:text-[var(--cipher-text)] focus-visible:ring-2 focus-visible:ring-[var(--cipher-accent)]'
            >
              ×
            </button>
          </div>
          <dl className='mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-[13px]'>
            <dt>
              <kbd className='rounded border border-[var(--cipher-border)] px-2 py-1'>
                Tab
              </kbd>
            </dt>
            <dd>Move through conversations and controls</dd>
            <dt>
              <kbd className='rounded border border-[var(--cipher-border)] px-2 py-1'>
                Enter
              </kbd>
            </dt>
            <dd>Send a message from the composer</dd>
            <dt>
              <kbd className='rounded border border-[var(--cipher-border)] px-2 py-1'>
                Shift + Enter
              </kbd>
            </dt>
            <dd>Add a new line to a message</dd>
            <dt>
              <kbd className='rounded border border-[var(--cipher-border)] px-2 py-1'>
                Escape
              </kbd>
            </dt>
            <dd>Close this help dialog</dd>
          </dl>
        </div>
      </dialog>
    </header>
  );
}
