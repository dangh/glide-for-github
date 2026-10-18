/**
 * GitHub's sticky pull request header: the bar with the PR's state, title and number that GitHub pins to the top of
 * the viewport once the title scrolls away (Conversation, Commits and Checks pages; measured 60 px on 2026-10-18).
 *
 * It is the second Primer `PageHeader` inside the page layout's `<header>` (the content anchor, see host.ts), told
 * apart from the title header by its computed position: sticky while hidden (`display: none`), fixed once shown.
 * CSS-module class names are hashed per release, so nothing here depends on them.
 */

export function findStickyHeader(anchor: HTMLElement): HTMLElement | null {
  if (anchor.tagName !== 'HEADER') return null;
  const win = anchor.ownerDocument.defaultView!;
  for (const el of anchor.querySelectorAll<HTMLElement>('[data-component="PageHeader"]')) {
    const position = win.getComputedStyle(el).position;
    if (position === 'sticky' || position === 'fixed') return el;
  }
  return null;
}

/**
 * The header's height when shown. While GitHub hides it (the title is on screen) it has no box, so it is shown
 * invisibly for one synchronous measurement and restored before the browser renders.
 */
export function stickyHeaderHeight(header: HTMLElement): number {
  const shown = header.getBoundingClientRect().height;
  if (shown > 0) return Math.round(shown);
  const style = header.getAttribute('style');
  header.style.setProperty('display', 'flex', 'important');
  header.style.setProperty('visibility', 'hidden', 'important');
  header.style.setProperty('position', 'fixed', 'important');
  const height = header.getBoundingClientRect().height;
  if (style === null) header.removeAttribute('style');
  else header.setAttribute('style', style);
  return Math.round(height);
}

/**
 * Fallback when GitHub's header is not found: the bottom of a fixed or sticky bar covering the top of the viewport
 * (outside `exclude`, Glide's own wrapper), or 0.
 */
export function topBarBottom(doc: Document, exclude: Element): number {
  const win = doc.defaultView;
  if (!win || typeof doc.elementsFromPoint !== 'function') return 0;
  for (const hit of doc.elementsFromPoint(win.innerWidth / 2, 1)) {
    if (exclude.contains(hit)) continue;
    for (let el: Element | null = hit; el && el !== doc.body && el !== doc.documentElement; el = el.parentElement) {
      const cs = win.getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      const r = el.getBoundingClientRect();
      if (r.top <= 1 && r.height >= 16 && r.height <= 200 && cs.visibility === 'visible' && cs.opacity !== '0') return Math.round(r.bottom);
    }
  }
  return 0;
}
