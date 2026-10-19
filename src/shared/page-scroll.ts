/**
 * Page scrolling (experiment `pageScroll`): GitHub's document owns the scrollbar, and the diff list follows it.
 *
 * Layout (src/content/page-scroll.ts): the viewer iframe is `position: sticky` at `stickTop` inside a wrapper that is
 * as tall as the iframe plus the list's scroll range (`extent`). Scrolling the page first moves GitHub's header out
 * of view; while the iframe is stuck, every page pixel is a list pixel. The page ends with the list: GitHub's footer is
 * hidden while Glide scrolls with the page (src/content/page-scroll.ts).
 *
 * While the iframe is stuck the list scrolls natively (no lag on a busy GitHub page) and tells the page where it is;
 * otherwise the list cannot scroll and the wheel reaches the page. The page is the single source of truth: it maps
 * its scroll position to a list offset and posts it, tagged with the newest viewer request it has applied (`ack`),
 * and the viewer ignores page positions older than its own newest request (`seq`), so the two never fight.
 *
 * Messages travel over their own MessageChannel, handed to the viewer with the `pierre:port` handshake.
 *
 * macOS's rubber band: until a stretch springs back, Chrome pulls its scroller back to the edge every frame
 * (ElasticOverscrollController::ReconcileStretchAndScroll), undoing a scroll that follows the other scroller meanwhile,
 * and the other scroller then follows that back. Without experiment `rubberBand`, GitHub's page never stretches, nor
 * does the list under a gesture latched to it. With it, each keeps its rubber band at the edge where nothing follows
 * it: the page at its top, the list at its bottom.
 */
import type { ExperimentSettings } from './experiments';

/**
 * How the viewer scrolls: `frame` (inside its iframe, today's default), `page` (with GitHub's page, below GitHub's
 * sticky PR header) or `merged` (with the page, GitHub's sticky header hidden and folded into Glide's toolbar).
 */
export type ScrollLayout = 'frame' | 'page' | 'merged';

export function scrollLayoutOf(e: ExperimentSettings): ScrollLayout {
  if (!e.pageScroll) return 'frame';
  return e.mergedBar ? 'merged' : 'page';
}

/** The viewer URL parameter carrying the layout (absent for `frame`). */
export const SCROLL_LAYOUT_PARAM = 'scroll';

export function parseScrollLayout(search: string): ScrollLayout {
  const v = new URLSearchParams(search).get(SCROLL_LAYOUT_PARAM);
  return v === 'page' || v === 'merged' ? v : 'frame';
}

/** The viewer URL parameter (`=1`) for experiment `rubberBand`. */
export const RUBBER_BAND_PARAM = 'rubberBand';

export const parseRubberBand = (search: string): boolean => new URLSearchParams(search).get(RUBBER_BAND_PARAM) === '1';

/** Page → viewer: the list offset the page's scroll position maps to, and whether the iframe is stuck. */
export interface PageScrollMessage {
  type: 'scroll';
  top: number;
  stuck: boolean;
  /** The newest viewer `scrollTo` seq the page had applied when it computed `top`. */
  ack: number;
}

/** Viewer → page. */
export type ViewerScrollMessage =
  /** The list's scroll range (`scrollHeight - clientHeight`). */
  | { type: 'extent'; extent: number }
  /** The list scrolled itself (wheel while stuck, tree click, keyboard): bring the page to the same offset. */
  | { type: 'scrollTo'; top: number; seq: number }
  /** The rest of a wheel gesture the list could not use (it reached its top or bottom). */
  | { type: 'scrollBy'; dy: number }
  /** The merged title was clicked: back to the top of GitHub's page, like GitHub's own sticky title. */
  | { type: 'scrollToTop' };

/** Half a CSS pixel: sub-pixel scroll positions at the edges still count as there. */
const EDGE = 0.5;

/**
 * The list offset for the page's current scroll position, from the wrapper's viewport top. The iframe is stuck while
 * the wrapper's top is between `stickTop` and `stickTop - extent` above it.
 */
export function listScroll(wrapperTop: number, stickTop: number, extent: number): { top: number; stuck: boolean } {
  const past = stickTop - wrapperTop;
  return { top: Math.min(extent, Math.max(0, past)), stuck: past >= -EDGE && past <= extent + EDGE };
}

/** How far the page must scroll so the list sits at `listTop` (the inverse of `listScroll` while stuck). */
export function pageScrollDelta(wrapperTop: number, stickTop: number, listTop: number): number {
  return wrapperTop - stickTop + listTop;
}

/** Wrapper and iframe heights: the iframe fills the viewport below `stickTop`; the wrapper adds the list's range. */
export function stickySizes(stickTop: number, extent: number): { wrapper: string; iframe: string } {
  return { wrapper: `calc(100vh - ${stickTop}px + ${extent}px)`, iframe: `calc(100vh - ${stickTop}px)` };
}

/** A wheel delta in CSS pixels (`deltaMode` 1 = lines, 2 = pages). */
export function wheelPixels(deltaY: number, deltaMode: number, pageHeight: number): number {
  return deltaMode === 1 ? deltaY * 40 : deltaMode === 2 ? deltaY * pageHeight : deltaY;
}

/** Whether the list can scroll further in the wheel's direction. */
export function listCanScroll(dy: number, scrollTop: number, extent: number): boolean {
  return dy < 0 ? scrollTop > EDGE : dy > 0 ? scrollTop < extent - EDGE : false;
}

/**
 * The part of a wheel step to hand to the page. Only a gesture the browser latched to the list (it could still
 * scroll when the gesture began) needs this, wherever the list should not move: at its top or bottom, or while the
 * iframe is not stuck. The browser chains any other gesture to the page by itself, and handing that one over too
 * would scroll the page twice.
 */
export function wheelHandOff(latchedToList: boolean, stuck: boolean, dy: number, scrollTop: number, extent: number): number {
  return latchedToList && (!stuck || !listCanScroll(dy, scrollTop, extent)) ? dy : 0;
}

/**
 * GitHub's page stretches only until the iframe sticks. Above that the list cannot scroll, so the page never follows
 * it; from there on the page's end is the list's, where the next swipe up scrolls the list and the page follows.
 */
export function pageRubberBand(wrapperTop: number, stickTop: number): boolean {
  return wrapperTop > stickTop + EDGE;
}

/** The list's `overscroll-behavior-y`: `contain` stretches the list without chaining the overscroll to the page. */
export type ListOverscroll = '' | 'contain' | 'none';

/**
 * At its top GitHub's page always takes over from the list (the PR header is above it), so a gesture latched to the
 * list that heads up is `none` before it gets there: Chrome starts the stretch in the frame the list reaches its edge,
 * before the viewer sees that wheel event. At its bottom the page ends too: there the list stretches, under a gesture
 * that heads down and under one that begins there (which `''` would chain to the page).
 */
export function listOverscroll(
  rubberBand: boolean,
  gesture: { latched: boolean; up: boolean } | null,
  stuck: boolean,
  scrollTop: number,
  extent: number,
): ListOverscroll {
  if (gesture?.latched) return !rubberBand || gesture.up ? 'none' : 'contain';
  const onlyAtBottom = stuck && !listCanScroll(1, scrollTop, extent) && listCanScroll(-1, scrollTop, extent);
  return rubberBand && onlyAtBottom ? 'contain' : '';
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * The messages are parsed on both ends: the viewer's end of the channel arrives in a `pierre:port` message, which
 * GitHub's own scripts could also post to the iframe.
 */
export function parsePageMessage(data: unknown): PageScrollMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const m = data as Record<string, unknown>;
  return m.type === 'scroll' && isFiniteNumber(m.top) && m.top >= 0 && typeof m.stuck === 'boolean' && isFiniteNumber(m.ack)
    ? { type: 'scroll', top: m.top, stuck: m.stuck, ack: m.ack }
    : null;
}

export function parseViewerMessage(data: unknown): ViewerScrollMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const m = data as Record<string, unknown>;
  if (m.type === 'extent' && isFiniteNumber(m.extent) && m.extent >= 0) return { type: 'extent', extent: m.extent };
  if (m.type === 'scrollTo' && isFiniteNumber(m.top) && isFiniteNumber(m.seq)) return { type: 'scrollTo', top: m.top, seq: m.seq };
  if (m.type === 'scrollBy' && isFiniteNumber(m.dy)) return { type: 'scrollBy', dy: m.dy };
  if (m.type === 'scrollToTop') return { type: 'scrollToTop' };
  return null;
}

/**
 * The viewer's side of the seq/ack ordering: `request()` numbers each scroll the viewer asks the page for, and
 * `current(ack)` says whether a page position already reflects the newest of them.
 */
export class ScrollRequests {
  private seq = 0;

  request(): number {
    return ++this.seq;
  }

  current(ack: number): boolean {
    return ack >= this.seq;
  }

  /** A new channel: the page side starts again from ack 0. */
  reset(): void {
    this.seq = 0;
  }
}

/** sessionStorage key for the scroll position restored on reload. */
export const restoreKey = (pr: string) => `glide.scroll:${pr}`;

/** Where the list was: the top visible file and how far into it, in px. */
export interface ScrollAnchor {
  path: string;
  offset: number;
}

export function parseScrollAnchor(raw: string | null): ScrollAnchor | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ScrollAnchor> | null;
    return v && typeof v.path === 'string' && v.path !== '' && typeof v.offset === 'number' && Number.isFinite(v.offset)
      ? { path: v.path, offset: v.offset }
      : null;
  } catch {
    return null;
  }
}
