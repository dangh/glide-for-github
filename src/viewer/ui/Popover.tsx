/** Minimal toolbar popover: a toggle button and a panel that closes on outside click, Escape or frame blur (dismiss.ts). */
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useDismiss } from './dismiss';

export function Popover({
  label,
  title,
  ariaLabel,
  className,
  testId,
  children,
}: {
  label: ReactNode;
  title?: string;
  ariaLabel?: string;
  className?: string;
  testId?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, root, close);

  return (
    <div className={`popover ${className ?? ''}`} ref={root}>
      <button
        className="pill"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={title}
        data-testid={testId}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open && <div className="popover-panel">{children(close)}</div>}
    </div>
  );
}
