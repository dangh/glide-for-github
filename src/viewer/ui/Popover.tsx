/** Minimal toolbar popover: a toggle button and a panel that closes on outside click or Escape. */
import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Popover({
  label,
  title,
  className,
  testId,
  children,
}: {
  label: ReactNode;
  title?: string;
  className?: string;
  testId?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={`popover ${className ?? ''}`} ref={root}>
      <button
        className="pill"
        aria-haspopup="true"
        aria-expanded={open}
        title={title}
        data-testid={testId}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open && <div className="popover-panel">{children(() => setOpen(false))}</div>}
    </div>
  );
}
