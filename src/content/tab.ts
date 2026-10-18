import { BRAND } from '../shared/brand';
import { glideUrl, type PrRef } from '../shared/pr-url';

/**
 * The PR tab strip. The new React PR UI labels it "Pull request navigation"; the classic
 * server-rendered UI labels it "Pull request tabs".
 */
const NAV_SELECTOR =
  'nav[aria-label="Pull request navigation"], nav[aria-label="Pull request tabs"], [aria-label="Pull request tabs"]';
const NAV_LABELS = ['[aria-label="Pull request navigation"]', '[aria-label="Pull request tabs"]'];

/** GitHub marks the open tab with `aria-current="page"` plus `selected` (classic) or `selected__<hash>` (React). */
const SELECTED_CLASS = /^selected(?:__|$)/;

const SVG_NS = 'http://www.w3.org/2000/svg';

function isSelected(a: Element): boolean {
  return a.getAttribute('aria-current') === 'page' || [...a.classList].some((c) => SELECTED_CLASS.test(c));
}

/** The "Files changed" tab, or null when the tab strip is not rendered. */
export function findFilesTab(doc: Document): HTMLAnchorElement | null {
  const byId = doc.querySelector<HTMLAnchorElement>('a#prs-files-anchor-tab');
  if (byId) return byId;
  const selector = NAV_LABELS.flatMap((nav) =>
    ['a[href$="/files"]', 'a[href*="/changes"]'].map((link) => `${nav} ${link}:not([data-pierre-tab])`),
  ).join(', ');
  return doc.querySelector<HTMLAnchorElement>(selector);
}

/** The element holding the PR tabs. */
export function findTabNav(doc: Document): HTMLElement | null {
  return findFilesTab(doc)?.closest<HTMLElement>('nav') ?? doc.querySelector<HTMLElement>(NAV_SELECTOR);
}

/** The changed-files count in a tab: `CounterLabel` (React UI) or `.Counter` (classic). */
const COUNTER = '[data-component="CounterLabel"], .Counter';
/** The React UI's screen-reader copy of the count (" (20)"), right after the counter. */
const HIDDEN_COUNT = /VisuallyHidden/;

/** The count and its screen-reader copy from Files changed, as copies for the Glide tab (no ids). */
function copyCounter(files: HTMLAnchorElement): Element[] {
  const counter = files.querySelector(COUNTER);
  if (!counter) return [];
  const hidden = counter.nextElementSibling;
  const parts = hidden && HIDDEN_COUNT.test(hidden.className) ? [counter, hidden] : [counter];
  return parts.map((part) => {
    const copy = part.cloneNode(true) as Element;
    copy.removeAttribute('id');
    copy.setAttribute('data-pierre-counter', '');
    return copy;
  });
}

/** Keeps the Glide tab's count equal to Files changed's (GitHub updates it, e.g. after a push). */
function syncCounter(tab: HTMLAnchorElement, files: HTMLAnchorElement): void {
  const ours = tab.querySelectorAll('[data-pierre-counter]');
  const theirs = copyCounter(files);
  if (ours.length !== theirs.length || [...ours].some((e, i) => e.textContent !== theirs[i]!.textContent)) {
    ours.forEach((e) => e.remove());
    tab.append(...theirs);
  }
}

function createTab(doc: Document, files: HTMLAnchorElement, ref: PrRef): HTMLAnchorElement {
  const tab = doc.createElement('a');
  tab.className = [...files.classList].filter((c) => !SELECTED_CLASS.test(c)).join(' ');
  tab.setAttribute('href', glideUrl(ref));
  tab.setAttribute('data-pierre-tab', '');

  // Reuse the sibling icon's classes (spacing, muted color, responsive display) with our own glyph.
  const filesIcon = files.querySelector('svg');
  const icon = doc.createElementNS(SVG_NS, 'svg');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('viewBox', '0 0 16 16');
  icon.setAttribute('width', '16');
  icon.setAttribute('height', '16');
  const iconClass = filesIcon?.getAttribute('class');
  if (iconClass) icon.setAttribute('class', iconClass.replace(/octicon-[\w-]+/, 'octicon-pierre'));
  // The Glide mark as a one-color glyph: a diff "+" over a "-" that runs into an arrow, filled in the tab's own
  // color like GitHub's octicons.
  const path = doc.createElementNS(SVG_NS, 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', 'M7 1.5H8.5V4.5H13L12.25 6H8.5V9H7V6H2L2.75 4.5H7ZM3 11H10V8.5L14.5 11.75L10 15V12.5H2.25Z');
  icon.append(path);

  tab.append(icon, BRAND.short, ...copyCounter(files));
  return tab;
}

/**
 * Inserts the Glide tab directly after "Files changed". Idempotent: returns the existing tab
 * (repositioning it if GitHub re-rendered the strip around it). Null if the strip is not rendered.
 */
export function injectTab(doc: Document, ref: PrRef): HTMLAnchorElement | null {
  const files = findFilesTab(doc);
  if (!files) return null;

  let tab = doc.querySelector<HTMLAnchorElement>('a[data-pierre-tab]');
  if (tab && tab.closest('nav') !== files.closest('nav')) {
    tab.remove();
    tab = null;
  }
  if (!tab) tab = createTab(doc, files, ref);
  if (tab.getAttribute('href') !== glideUrl(ref)) tab.setAttribute('href', glideUrl(ref));
  syncCounter(tab, files);
  if (files.nextElementSibling !== tab) files.after(tab);
  return tab;
}

/** Removes the Glide tab (restoring GitHub's selected styling first). */
export function removeTab(doc: Document): void {
  const tab = doc.querySelector('a[data-pierre-tab]');
  // This runs on every DOM change of every non-PR GitHub page: with no Glide tab (and no tab it left unselected)
  // there is nothing to undo, so do not scan the page's links.
  if (!tab && !doc.querySelector('[data-pierre-class]')) return;
  setTabActive(doc, false);
  doc.querySelectorAll('a[data-pierre-tab]').forEach((t) => t.remove());
}

/**
 * Mirrors GitHub's selected-tab styling onto the Glide tab while active, taking it off the other
 * tabs; restores their exact original attributes when inactive. Idempotent.
 */
export function setTabActive(doc: Document, active: boolean): void {
  const tab = doc.querySelector<HTMLAnchorElement>('a[data-pierre-tab]');
  const scope: ParentNode = tab?.closest('nav') ?? doc;
  const others = [...scope.querySelectorAll<HTMLAnchorElement>('a')].filter((a) => a !== tab);

  if (active && tab) {
    let selectedClasses: string[] = [];
    for (const a of others) {
      if (!isSelected(a)) continue;
      const classes = [...a.classList].filter((c) => SELECTED_CLASS.test(c));
      selectedClasses = selectedClasses.concat(classes);
      a.setAttribute('data-pierre-class', a.getAttribute('class') ?? '');
      if (a.hasAttribute('aria-current')) {
        a.setAttribute('data-pierre-current', a.getAttribute('aria-current') ?? '');
        a.setAttribute('aria-current', 'false');
      }
      a.classList.remove(...classes);
      a.setAttribute('data-pierre-stripped', a.getAttribute('class') ?? '');
    }
    const stored = tab.getAttribute('data-pierre-selected');
    if (selectedClasses.length === 0) selectedClasses = stored ? stored.split(' ') : ['selected'];
    tab.setAttribute('data-pierre-selected', selectedClasses.join(' '));
    tab.setAttribute('aria-current', 'page');
    tab.classList.add(...selectedClasses);
    return;
  }

  for (const a of others) {
    if (!a.hasAttribute('data-pierre-class')) continue;
    // Restore only tabs still in the state we left them. If GitHub navigated meanwhile it has
    // already re-rendered them, and blindly restoring would select two tabs at once.
    const savedCurrent = a.getAttribute('data-pierre-current');
    const untouched =
      a.getAttribute('class') === a.getAttribute('data-pierre-stripped') &&
      (savedCurrent === null || a.getAttribute('aria-current') === 'false');
    if (untouched) {
      a.setAttribute('class', a.getAttribute('data-pierre-class') ?? '');
      if (savedCurrent !== null) a.setAttribute('aria-current', savedCurrent);
    }
    a.removeAttribute('data-pierre-class');
    a.removeAttribute('data-pierre-current');
    a.removeAttribute('data-pierre-stripped');
  }
  if (tab && tab.hasAttribute('data-pierre-selected')) {
    tab.classList.remove(...(tab.getAttribute('data-pierre-selected') ?? '').split(' '));
    tab.removeAttribute('data-pierre-selected');
    tab.removeAttribute('aria-current');
  }
}
