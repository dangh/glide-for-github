/**
 * Closing rules shared by the toolbar's menus (Popover, ReviewMenu): a mousedown outside the menu, Escape, and the
 * frame losing focus. The viewer is an iframe inside GitHub's page, so a click on the page around it never reaches
 * this document; it does blur this window (focus moves to the parent page). A blur while a modal dialog is open
 * (the token prompt, the commit dialog) keeps the menu: the user may be fetching a token in another tab, and the
 * dialog has its own Cancel.
 */
import { useEffect, type RefObject } from 'react';

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
      const target = e.target as Element;
      if (root.current && !root.current.contains(target) && !keepFor?.(target)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onBlur = () => {
      if (!document.querySelector('[aria-modal="true"]')) close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [open, root, close, keepFor]);
}
