/**
 * The viewer's side of page scrolling (protocol and layout: src/shared/page-scroll.ts). The CodeView root is the
 * list: while the page says the iframe is stuck, the list scrolls natively and reports each position; otherwise it
 * cannot scroll (`overflow-y: hidden`) and the wheel reaches the page, whose positions the list follows.
 */
import { create } from 'zustand';
import {
  listCanScroll,
  parsePageMessage,
  parseScrollAnchor,
  ScrollRequests,
  wheelHandOff,
  wheelPixels,
  type ScrollAnchor,
  type ScrollLayout,
  type ViewerScrollMessage,
} from '../shared/page-scroll';

/** The layout this viewer was mounted in, and whether the page has it stuck (the merged bar shows the title then). */
export const usePageScroll = create<{ layout: ScrollLayout; stuck: boolean }>(() => ({ layout: 'frame', stuck: false }));

/**
 * Chrome latches a wheel gesture to one scroller. A mouse wheel has no gesture phases, so Chrome ends the gesture
 * 500 ms after its last event, or once the pointer is 10 px from where it began (kDefaultMouseWheelLatchingTransaction
 * and kWheelLatchingSlopRegion in Chromium's mouse_wheel_phase_handler.h). Trackpad gestures can outlast this; the
 * page side catches the double scroll that would cause (src/content/page-scroll.ts).
 */
const LATCH_MS = 500;
const LATCH_SLOP_PX = 10;
/** The position is saved for a reload once scrolling pauses this long. */
const SAVE_MS = 300;
/** How long a scroll the user asked for may take to start (Pierre scrolls on its next frame). */
const EXPECT_MS = 500;

/** The list's position in its own terms, for restoring it after a reload. */
export interface ListAnchors {
  anchor(): ScrollAnchor | null;
  scrollToAnchor(anchor: ScrollAnchor): void;
}

export interface PageScrollView {
  /** A fresh scroll channel from the page (each handshake brings one). */
  setPort(port: MessagePort): void;
  /** The list is about to scroll where the user asked (a tree click): the page follows, even from its header or footer. */
  expectListScroll(): void;
  /** Back to the top of GitHub's page (the merged title, like GitHub's sticky title); the list follows. */
  scrollPageToTop(): void;
  /** The CodeView root (null when it unmounts); the first one restores the position saved before a reload. */
  attach(root: HTMLElement | null, anchors: ListAnchors | null): void;
}

export function createPageScrollView(win: Window, layout: Exclude<ScrollLayout, 'frame'>, storageKey: string): PageScrollView {
  usePageScroll.setState({ layout });
  const requests = new ScrollRequests();
  let port: MessagePort | null = null;
  let root: HTMLElement | null = null;
  let anchors: ListAnchors | null = null;
  let restored = false;
  let stuck = false;
  let lastApplied = 0;
  /** The newest viewer request the page had applied in its last position. */
  let lastAck = 0;
  let lastExtent = -1;
  /** A list scroll the user asked for is on its way (see `expectListScroll`). */
  let expected = false;
  let expectTimer: ReturnType<typeof setTimeout> | undefined;
  /** The wheel gesture in progress: where it began, and whether the browser latched it to the list. */
  let gesture: { latched: boolean; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;

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

  /**
   * The list scrolls natively only while the iframe is stuck, switched mid-gesture too: the hand-off carries on a
   * gesture latched to the list, and a list still scrollable below GitHub's header takes the next swipe only to be put
   * back. A gesture latched to the list turns its rubber band off: on macOS, until a stretch at its edge springs back,
   * Chrome pulls the list back to that edge every frame (ElasticOverscrollController::ReconcileStretchAndScroll), and
   * the page that follows it. Meanwhile Chrome latches a new swipe to the list too, and the hand-off carries it.
   */
  const applyStyle = () => {
    if (!root) return;
    root.style.overflowY = stuck ? 'auto' : 'hidden';
    root.style.overscrollBehaviorY = gesture?.latched ? 'none' : '';
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
    // With GitHub's header or footer on screen the list only moves where the user asked: Pierre keeping its view in
    // place as files above load must not pull the page back to the list.
    if (!stuck && !expected && requests.current(lastAck)) {
      root.scrollTop = lastApplied;
      return;
    }
    expected = false;
    lastApplied = top;
    // The page must know the new range before it is asked to scroll into it.
    sendExtent();
    post({ type: 'scrollTo', top, seq: requests.request() });
  };

  const endGesture = () => {
    gesture = null;
    applyStyle();
  };

  const onWheel = (e: WheelEvent) => {
    if (!root) return;
    const dy = wheelPixels(e.deltaY, e.deltaMode, root.clientHeight);
    const extent = extentOf(root);
    if (gesture) {
      clearTimeout(gesture.timer);
      if (Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) >= LATCH_SLOP_PX) gesture = null;
    }
    if (gesture) gesture = { ...gesture, timer: setTimeout(endGesture, LATCH_MS) };
    else {
      // Latched once, when the gesture begins: to the list only if it could scroll then.
      gesture = { latched: stuck && listCanScroll(dy, root.scrollTop, extent), x: e.clientX, y: e.clientY, timer: setTimeout(endGesture, LATCH_MS) };
      applyStyle();
    }
    const handOff = wheelHandOff(gesture.latched, stuck, dy, root.scrollTop, extent);
    if (handOff === 0) return;
    // Where the list stopped goes first: its scroll event, still to come, would put the page back after the hand-off.
    if (Math.abs(root.scrollTop - lastApplied) >= 1) onRootScroll();
    post({ type: 'scrollBy', dy: handOff });
  };

  const onPageMessage = (event: MessageEvent) => {
    const msg = parsePageMessage(event.data);
    if (!msg) return;
    lastAck = msg.ack;
    // The list moved by itself (Pierre keeping the view in place as files above load) and its scroll event is still
    // to come: that position wins while the iframe is stuck, so ask the page for it now (which makes this message
    // stale); otherwise the list goes back to the page's position.
    if (root && Math.abs(root.scrollTop - lastApplied) >= 1) onRootScroll();
    if (!requests.current(msg.ack)) return;
    if (msg.stuck !== stuck) {
      stuck = msg.stuck;
      usePageScroll.setState({ stuck });
      applyStyle();
    }
    if (!root) return;
    lastApplied = msg.top;
    if (Math.abs(root.scrollTop - msg.top) >= 1) root.scrollTop = msg.top;
  };

  win.addEventListener('pagehide', () => {
    if (saveTimer !== undefined) save();
  });

  const expectListScroll = () => {
    expected = true;
    clearTimeout(expectTimer);
    // Cleared by the scroll itself; this only drops an expectation whose scroll never came (already there).
    expectTimer = setTimeout(() => (expected = false), EXPECT_MS);
  };

  const restore = () => {
    if (restored || !anchors) return;
    restored = true;
    let saved: ScrollAnchor | null = null;
    try {
      saved = parseScrollAnchor(win.sessionStorage.getItem(storageKey));
    } catch {
      return;
    }
    if (!saved) return;
    expectListScroll();
    anchors.scrollToAnchor(saved);
  };

  return {
    expectListScroll,
    scrollPageToTop: () => post({ type: 'scrollToTop' }),
    setPort(next) {
      if (port) {
        port.onmessage = null;
        port.close();
      }
      port = next;
      requests.reset();
      lastAck = 0;
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
      applyStyle();
      root.addEventListener('scroll', onRootScroll, { passive: true });
      root.addEventListener('wheel', onWheel, { passive: true });
      resizes.observe(root);
      for (const child of root.children) resizes.observe(child);
      sendExtent();
      restore();
    },
  };
}
