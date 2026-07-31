/**
 * Generic, reusable accessible dialog. Rendered through a portal.
 *
 * - role="dialog" + aria-modal="true" + aria-labelledby
 * - focus moves into the dialog on open, is trapped while open, and is
 *   restored to the trigger element on close
 * - Escape closes; backdrop click closes
 * - background scroll is locked while open
 * - respects prefers-reduced-motion (no JS-driven animation; CSS handles it)
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function Modal({
  open,
  onClose,
  labelId,
  children,
  className = '',
}: {
  open: boolean;
  onClose: () => void;
  /** id of the element (usually the title) that labels this dialog */
  labelId: string;
  children: ReactNode;
  className?: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  /*
   * Callers pass an inline arrow for `onClose`, so its identity changes on every
   * parent render. Depending on it directly would tear down and re-run the whole
   * setup each time — re-capturing the "previously focused" element mid-flight
   * (sometimes landing on a node inside the dialog, which is unmounted by the
   * time we try to restore, dropping focus to <body>). Hold it in a ref so the
   * effect keys only on `open`.
   */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const dialog = dialogRef.current;
    const focusables = () =>
      dialog ? Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) : [];

    // Move focus into the dialog.
    const initial = focusables()[0] ?? dialog;
    initial?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement;
      if (e.shiftKey) {
        if (activeEl === first || !dialog?.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else if (activeEl === last || !dialog?.contains(activeEl)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      // Only restore to a node still in the document — focusing a detached
      // element silently drops focus to <body>, stranding keyboard users.
      const trigger = previouslyFocused.current;
      previouslyFocused.current = null;
      if (trigger?.isConnected) trigger.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="cl-modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          // Prevent the browser's default mousedown focus-shift (which would
          // otherwise blur to <body> and race with — and clobber — the
          // focus-restore this triggers below).
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        className={`cl-modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
