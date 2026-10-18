import { filesRedirect, isGlideActive, parsePrUrl, prKey, showsGithubFiles } from '../shared/pr-url';
import { findContentAnchor, mountViewer, type ViewerHost } from './host';
import { fixedSettings, type SettingsSource } from './settings-source';
import { hideFilesTab, injectTab, removeTab, setTabActive } from './tab';

const DEBOUNCE_MS = 50;

export interface Lifecycle {
  /** Reconciles the page with the URL. Idempotent and cheap when nothing changed. */
  sync(): void;
  /** Installs listeners (soft-nav events, DOM observer, tab click) and runs an initial sync. */
  start(): void;
  stop(): void;
}

type NavigationTarget = { addEventListener(type: string, listener: () => void): void; removeEventListener(type: string, listener: () => void): void };

export function createLifecycle(win: Window & typeof globalThis = window, settings: SettingsSource = fixedSettings()): Lifecycle {
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
    let href = win.location.href;
    const ref = parsePrUrl(href);
    if (!ref) {
      unmountViewer();
      removeTab(doc);
      return;
    }

    const stored = settings.get();
    const replace = stored?.replaceFilesTab === true;
    const glide = replace ? filesRedirect(href) : null;
    if (glide) {
      // Replace, not push: Back then skips GitHub's Files changed page instead of landing on it again.
      win.history.replaceState(win.history.state, '', glide);
      href = glide;
    }

    const key = prKey(ref);
    if (mounted && mounted.key !== key) unmountViewer();

    // The strip may not be rendered yet (or is mid re-render); the observer will call us again.
    const tab = injectTab(doc, ref);
    // On GitHub's own Files changed page (a range, a spot in the diff, or chosen from Glide) its tab stays.
    hideFilesTab(doc, replace && !!tab && !showsGithubFiles(href));

    if (!isGlideActive(href)) {
      unmountViewer();
      setTabActive(doc, false);
      return;
    }
    // Until the settings are read, the viewer waits (the source calls us once they are).
    if (!tab || !findContentAnchor(doc) || !stored) return;
    const { layout } = stored;

    if (mounted && (mounted.host.layout !== layout || !mounted.host.refresh())) unmountViewer();
    mounted ??= { key, host: mountViewer(doc, ref, layout) };
    setTabActive(doc, true);
  }

  function schedule(): void {
    clearTimeout(timer);
    timer = setTimeout(sync, DEBOUNCE_MS);
  }

  const plainPress = (event: MouseEvent) =>
    event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
  const pierreTabOf = (target: EventTarget | null) =>
    target instanceof win.Element ? target.closest<HTMLAnchorElement>('a[data-pierre-tab]') : null;
  /** A link to GitHub's Files changed page that opens Glide instead, while it replaces that page. */
  const replacedFilesLinkOf = (target: EventTarget | null) => {
    if (settings.get()?.replaceFilesTab !== true || !(target instanceof win.Element)) return null;
    const link = target.closest<HTMLAnchorElement>('a[href]');
    if (!link || (link.target !== '' && link.target !== '_self') || link.hasAttribute('download')) return null;
    return filesRedirect(link.href) ? link : null;
  };
  /** The tab is for the PR on screen (a tab of another PR is left to the browser). */
  const samePr = (tab: HTMLAnchorElement) => {
    const here = parsePrUrl(win.location.href);
    const there = parsePrUrl(tab.href);
    return !!here && !!there && prKey(here) === prKey(there);
  };
  function activate(): void {
    if (!isGlideActive(win.location.href)) {
      win.history.pushState(win.history.state, '', win.location.pathname + win.location.search + '#glide');
    }
    sync();
  }

  /**
   * A press on the tab that may lose its click. While GitHub is still loading it re-renders the tab strip, and the
   * tab is re-injected (a new element) between pointerdown and pointerup: the browser then fires no click on it, so
   * the press was simply lost (Task 7 concern 1; seen in Task 12 as pointerdown on the tab, mousedown on a DIV).
   * A release inside the rectangle that was pressed, shortly after, opens Glide unless a click on the tab did.
   */
  const PRESS_MS = 1500;
  let press: { at: number; rect: DOMRect } | null = null;
  /** The release being checked: `handled` is set when the click that follows it reached the tab. */
  let release: { handled: boolean } | null = null;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;

  function onPointerDown(event: PointerEvent): void {
    const tab = pierreTabOf(event.target);
    press = tab && plainPress(event) && samePr(tab) ? { at: event.timeStamp, rect: tab.getBoundingClientRect() } : null;
  }

  function onPointerUp(event: PointerEvent): void {
    const p = press;
    press = null;
    if (!p || !plainPress(event) || event.timeStamp - p.at > PRESS_MS) return;
    const { left, right, top, bottom } = p.rect;
    if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) return;
    // The click, if the browser fires one, is dispatched in this same task, before the timeout.
    const r = { handled: false };
    release = r;
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => {
      if (release === r) release = null;
      if (!r.handled && parsePrUrl(win.location.href)) activate();
    }, 0);
  }

  /** Clicking Glide (or a link to Files changed it replaces) on any page of the same PR stays there and adds `#glide`. */
  function onClick(event: MouseEvent): void {
    if (event.defaultPrevented || !plainPress(event)) return;
    const tab = pierreTabOf(event.target) ?? replacedFilesLinkOf(event.target);
    if (!tab || !samePr(tab)) return; // different PR: let the browser navigate (sync opens Glide when it lands)
    if (release) release.handled = true;
    event.preventDefault();
    event.stopPropagation(); // keep GitHub's router and Turbo out of it
    activate();
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

    listen(doc, 'click', onClick as EventListener as () => void, true);
    listen(doc, 'pointerdown', onPointerDown as EventListener as () => void, true);
    listen(doc, 'pointerup', onPointerUp as EventListener as () => void, true);

    // Observe the root, not <body>: Turbo Drive replaces document.body on classic-UI navigations,
    // which would leave an observer on <body> watching a detached node.
    observer = new MutationObserver(schedule);
    observer.observe(doc.documentElement, { childList: true, subtree: true });
    // A changed layout remounts an open viewer in it.
    cleanups.push(settings.subscribe(sync));

    sync();
  }

  function stop(): void {
    clearTimeout(timer);
    clearTimeout(releaseTimer);
    press = null;
    release = null;
    observer?.disconnect();
    observer = null;
    for (const fn of cleanups) fn();
    cleanups = [];
  }

  return { sync, start, stop };
}
