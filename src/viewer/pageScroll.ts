/**
 * The viewer's side of page scrolling (protocol and layout: src/shared/page-scroll.ts). The CodeView root is the
 * list: while the page says the iframe is stuck, the list scrolls natively and reports each position; otherwise it
 * cannot scroll (`overflow-y: hidden`) and the wheel reaches the page, whose positions the list follows.
 */
import { create } from 'zustand';
import {
  listCanScroll,
  parseScrollAnchor,
  ScrollRequests,
  wheelHandOff,
  wheelPixels,
  type PageScrollMessage,
  type ScrollAnchor,
  type ScrollLayout,
  type ViewerScrollMessage,
} from '../shared/page-scroll';

/** The layout this viewer was mounted in, and whether the page has it stuck (the merged bar shows the title then). */
export const usePageScroll = create<{ layout: ScrollLayout; stuck: boolean }>(() => ({ layout: 'frame', stuck: false }));

/** How long after the last wheel event a gesture counts as over (Chrome latches a wheel gesture to one scroller). */
const GESTURE_MS = 250;
/** The position is saved for a reload once scrolling pauses this long. */
const SAVE_MS = 300;

/** The list's position in its own terms, for restoring it after a reload. */
export interface ListAnchors {
  anchor(): ScrollAnchor | null;
  scrollToAnchor(anchor: ScrollAnchor): void;
}

export interface PageScrollView {
  /** A fresh scroll channel from the page (each handshake brings one). */
  setPort(port: MessagePort): void;
  /** The CodeView root (null when it unmounts); the first one restores the position saved before a reload. */
  attach(root: HTMLElement | null, anchors: ListAnchors | null): void;
}

const isPageMessage = (v: unknown): v is PageScrollMessage => {
  const m = v as Partial<PageScrollMessage> | null;
  return typeof m === 'object' && m !== null && m.type === 'scroll' && typeof m.top === 'number' && typeof m.stuck === 'boolean' && typeof m.ack === 'number';
};

export function createPageScrollView(win: Window, layout: Exclude<ScrollLayout, 'frame'>, storageKey: string): PageScrollView {
  usePageScroll.setState({ layout });
  const requests = new ScrollRequests();
  let port: MessagePort | null = null;
  let root: HTMLElement | null = null;
  let anchors: ListAnchors | null = null;
  let restored = false;
  let stuck = false;
  let lastApplied = 0;
  let lastExtent = -1;
  /** The wheel gesture in progress, and whether the browser latched it to the list. */
  let gesture: { latched: boolean; timer: ReturnType<typeof setTimeout> } | null = null;

  const post = (msg: ViewerScrollMessage) => port?.postMessage(msg);
  const extentOf = (el: HTMLElement) => Math.max(0, el.scrollHeight - el.clientHeight);

  const sendExtent = () => {
    if (!root) return;
    const extent = extentOf(root);
    if (extent === lastExtent) return;
    lastExtent = extent;
    post({ type: 'extent', extent });
  };
  const resizes = new ResizeObserver(sendExtent);

  /** Switched only between gestures: changing the scroller under a latched gesture would cut it off. */
  const applyOverflow = () => {
    if (!root || gesture) return;
    root.style.overflowY = stuck ? 'auto' : 'hidden';
  };

  /**
   * Saved when scrolling pauses, not on pagehide: GitHub replaces its layout once while loading, which unloads a viewer
   * that may not have restored yet, and its pagehide would overwrite the position the next viewer is to restore.
   */
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    saveTimer = undefined;
    const anchor = anchors?.anchor();
    try {
      if (anchor) win.sessionStorage.setItem(storageKey, JSON.stringify(anchor));
    } catch {
      /* storage unavailable: nothing to restore next time */
    }
  };

  const onRootScroll = () => {
    if (!root) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_MS);
    const top = root.scrollTop;
    if (Math.abs(top - lastApplied) < 1) return;
    lastApplied = top;
    // The page must know the new range before it is asked to scroll into it.
    sendExtent();
    post({ type: 'scrollTo', top, seq: requests.request() });
  };

  const onWheel = (e: WheelEvent) => {
    if (!root || (!gesture && !stuck)) return; // not latched to the list: the page scrolls by itself
    const dy = wheelPixels(e.deltaY, e.deltaMode, root.clientHeight);
    const extent = extentOf(root);
    if (gesture) clearTimeout(gesture.timer);
    const latched = gesture ? gesture.latched : listCanScroll(dy, root.scrollTop, extent);
    const timer = setTimeout(() => {
      gesture = null;
      applyOverflow();
    }, GESTURE_MS);
    gesture = { latched, timer };
    const handOff = wheelHandOff(latched, dy, root.scrollTop, extent);
    if (handOff !== 0) post({ type: 'scrollBy', dy: handOff });
  };

  const onPageMessage = (event: MessageEvent) => {
    const msg: unknown = event.data;
    if (!isPageMessage(msg)) return;
    // The list moved by itself (Pierre keeping the view in place as files above load) and its scroll event is still
    // to come: that position wins, so ask the page for it now, which also makes this message stale.
    if (root && Math.abs(root.scrollTop - lastApplied) >= 1) onRootScroll();
    if (!requests.current(msg.ack)) return;
    if (msg.stuck !== stuck) {
      stuck = msg.stuck;
      usePageScroll.setState({ stuck });
      applyOverflow();
    }
    if (!root) return;
    lastApplied = msg.top;
    if (Math.abs(root.scrollTop - msg.top) >= 1) root.scrollTop = msg.top;
  };

  win.addEventListener('pagehide', () => {
    if (saveTimer !== undefined) save();
  });

  const restore = () => {
    if (restored || !anchors) return;
    restored = true;
    let saved: ScrollAnchor | null = null;
    try {
      saved = parseScrollAnchor(win.sessionStorage.getItem(storageKey));
    } catch {
      return;
    }
    if (saved) anchors.scrollToAnchor(saved);
  };

  return {
    setPort(next) {
      if (port) {
        port.onmessage = null;
        port.close();
      }
      port = next;
      requests.reset();
      lastExtent = -1;
      port.onmessage = onPageMessage;
      sendExtent();
    },
    attach(next, nextAnchors) {
      if (next === root) return;
      if (root) {
        root.removeEventListener('scroll', onRootScroll);
        root.removeEventListener('wheel', onWheel);
        resizes.disconnect();
      }
      root = next;
      anchors = nextAnchors;
      lastExtent = -1;
      if (!root) return;
      lastApplied = root.scrollTop;
      applyOverflow();
      root.addEventListener('scroll', onRootScroll, { passive: true });
      root.addEventListener('wheel', onWheel, { passive: true });
      resizes.observe(root);
      for (const child of root.children) resizes.observe(child);
      sendExtent();
      restore();
    },
  };
}
