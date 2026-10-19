/** Menus close on outside clicks, Escape, or window blur. An open modal suppresses blur dismissal. */
import { useEffect, type RefObject } from 'react';
import { viewerRoot } from '../rootEl';

export function useDismiss(
  open: boolean,
  root: RefObject<HTMLElement | null>,
  close: () => void,
  /** Targets outside `root` that must not close the menu on mousedown (e.g. its own dialogs). */
  keepFor?: (target: Element) => boolean,
): void {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const path = e.composedPath();
      const target = path.find((node): node is Element => node instanceof Element);
      if (root.current && !path.includes(root.current) && !(target && keepFor?.(target))) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onBlur = () => {
      if (!viewerRoot.scope.querySelector('[aria-modal="true"]')) close();
    };
    const doc = viewerRoot.el.ownerDocument;
    doc.addEventListener('mousedown', onDown, true);
    viewerRoot.scope.addEventListener('keydown', onKey as EventListener);
    window.addEventListener('blur', onBlur);
    return () => {
      doc.removeEventListener('mousedown', onDown, true);
      viewerRoot.scope.removeEventListener('keydown', onKey as EventListener);
      window.removeEventListener('blur', onBlur);
    };
  }, [open, root, close, keepFor]);
}
