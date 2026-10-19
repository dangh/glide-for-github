import { findTabNav } from './tab';

/**
 * The element after which GitHub's tab content sits; everything after it is the content to hide.
 * - New React PR UI: the `<header>` of the page layout that contains the tab nav. Its next sibling
 *   (`PageLayoutContent`: toolbar, file-tree pane, diff content) is the tab content. The Conversation,
 *   Commits, Checks and Files pages all share this layout.
 * - Classic UI: the `.tabnav` row; its next sibling (`<diff-layout>` on Files, the timeline on
 *   Conversation) is the tab content.
 * Both anchor on structural elements, not hashed CSS-module class names, which change per release.
 */
export function findContentAnchor(doc: Document): HTMLElement | null {
  const nav = findTabNav(doc);
  if (!nav) return null;
  const anchor = nav.closest<HTMLElement>('header') ?? nav.closest<HTMLElement>('.tabnav');
  return anchor?.parentElement ? anchor : null;
}


/** Keeps GitHub's tab content hidden while the in-page viewer is mounted. */
export function createContentHost(doc: Document, host: HTMLElement) {
  const hidden = new Map<HTMLElement, string | null>();
  let mounted = true;
  return {
    refresh(): HTMLElement | null {
      const anchor = findContentAnchor(doc);
      if (!mounted || !anchor) return null;
      if (host.previousElementSibling !== anchor) anchor.after(host);
      for (let el = anchor.nextElementSibling; el; el = el.nextElementSibling) {
        if (el === host || !(el instanceof doc.defaultView!.HTMLElement)) continue;
        if (!hidden.has(el)) hidden.set(el, el.getAttribute('style'));
        if (el.style.display !== 'none') el.style.setProperty('display', 'none', 'important');
      }
      return anchor;
    },
    unmount() {
      if (!mounted) return;
      mounted = false;
      host.remove();
      for (const [el, style] of hidden) {
        if (style === null) el.removeAttribute('style');
        else el.setAttribute('style', style);
      }
      hidden.clear();
    },
  };
}
