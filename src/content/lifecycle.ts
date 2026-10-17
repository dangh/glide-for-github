import { isPierreActive, parsePrUrl, prKey } from '../shared/pr-url';
import { findContentAnchor, mountViewer, type ViewerHost } from './host';
import { injectTab, removeTab, setTabActive } from './tab';

const DEBOUNCE_MS = 50;

export interface Lifecycle {
  /** Reconciles the page with the URL. Idempotent and cheap when nothing changed. */
  sync(): void;
  /** Installs listeners (soft-nav events, DOM observer, tab click) and runs an initial sync. */
  start(): void;
  stop(): void;
}

type NavigationTarget = { addEventListener(type: string, listener: () => void): void; removeEventListener(type: string, listener: () => void): void };

export function createLifecycle(win: Window & typeof globalThis = window): Lifecycle {
  const doc = win.document;
  let mounted: { key: string; host: ViewerHost } | null = null;
  let observer: MutationObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cleanups: Array<() => void> = [];

  function unmountViewer(): void {
    mounted?.host.unmount();
    mounted = null;
  }

  function sync(): void {
    const href = win.location.href;
    const ref = parsePrUrl(href);
    if (!ref) {
      unmountViewer();
      removeTab(doc);
      return;
    }

    const key = prKey(ref);
    if (mounted && mounted.key !== key) unmountViewer();

    // The strip may not be rendered yet (or is mid re-render); the observer will call us again.
    const tab = injectTab(doc, ref);

    if (!isPierreActive(href)) {
      unmountViewer();
      setTabActive(doc, false);
      return;
    }
    if (!tab || !findContentAnchor(doc)) return;

    if (mounted && !mounted.host.refresh()) unmountViewer();
    mounted ??= { key, host: mountViewer(doc, ref) };
    setTabActive(doc, true);
  }

  function schedule(): void {
    clearTimeout(timer);
    timer = setTimeout(sync, DEBOUNCE_MS);
  }

  /** Clicking Pierre on any page of the same PR stays on that page and only adds `#pierre`. */
  function onClick(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const tab = event.target instanceof win.Element ? event.target.closest<HTMLAnchorElement>('a[data-pierre-tab]') : null;
    if (!tab) return;
    const here = parsePrUrl(win.location.href);
    const there = parsePrUrl(tab.href);
    if (!here || !there || prKey(here) !== prKey(there)) return; // different PR: let the browser navigate
    event.preventDefault();
    event.stopPropagation(); // keep GitHub's router and Turbo out of it
    if (!isPierreActive(win.location.href)) {
      win.history.pushState(win.history.state, '', win.location.pathname + win.location.search + '#pierre');
    }
    sync();
  }

  function start(): void {
    stop();
    const listen = (target: EventTarget | NavigationTarget, type: string, fn: () => void, capture = false) => {
      (target as EventTarget).addEventListener(type, fn, capture);
      cleanups.push(() => (target as EventTarget).removeEventListener(type, fn, capture));
    };
    for (const type of ['turbo:render', 'soft-nav:react-done']) listen(doc, type, schedule);
    for (const type of ['popstate', 'hashchange']) listen(win, type, sync);
    listen(win, 'load', schedule);
    // Chrome's Navigation API also reports the History pushState calls GitHub's React router makes.
    const navigation = (win as unknown as { navigation?: NavigationTarget }).navigation;
    if (navigation) listen(navigation, 'navigatesuccess', schedule);

    doc.addEventListener('click', onClick as EventListener, true);
    cleanups.push(() => doc.removeEventListener('click', onClick as EventListener, true));

    observer = new MutationObserver(schedule);
    observer.observe(doc.body, { childList: true, subtree: true });

    sync();
  }

  function stop(): void {
    clearTimeout(timer);
    observer?.disconnect();
    observer = null;
    for (const fn of cleanups) fn();
    cleanups = [];
  }

  return { sync, start, stop };
}
