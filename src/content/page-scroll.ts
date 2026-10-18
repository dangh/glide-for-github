/**
 * The page's side of page scrolling (see src/shared/page-scroll.ts): the sticky iframe in its tall wrapper, GitHub's
 * sticky PR header (measured in `page`, hidden in `merged`), and the scroll channel to the viewer.
 */
import {
  listScroll,
  pageScrollDelta,
  parseViewerMessage,
  stickySizes,
  type PageScrollMessage,
  type ScrollLayout,
} from '../shared/page-scroll';
import { findStickyHeader, stickyHeaderHeight, topBarBottom } from './github-header';

export interface PageScroll {
  /** Goes into the page where the bare iframe would (it holds the iframe). */
  wrapper: HTMLElement;
  /** The page's end of a fresh scroll channel (one per `pierre:port` handshake); the previous one is closed. */
  connect(port: MessagePort): void;
  /** After GitHub changed the page: re-finds its sticky header (re-hiding a re-rendered one in `merged`). */
  refresh(): void;
  /** Stops listening, closes the channel and shows GitHub's header again. The caller removes the wrapper. */
  dispose(): void;
}

/** A wheel hand-off is dropped while the page has scrolled by itself this recently. */
const OWN_SCROLL_MS = 200;

export function createPageScroll(doc: Document, anchor: HTMLElement, iframe: HTMLIFrameElement, layout: Exclude<ScrollLayout, 'frame'>): PageScroll {
  const win = doc.defaultView!;
  const wrapper = doc.createElement('div');
  wrapper.setAttribute('data-glide-scroll', layout);
  wrapper.append(iframe);

  let port: MessagePort | null = null;
  let extent = 0;
  let stickTop = 0;
  let lastAck = 0;
  let lastPosted = '';
  /** `scrollY` after the page's last scroll, and when it last moved other than at the viewer's request. */
  let lastY = win.scrollY;
  let movedByItselfAt = -Infinity;
  /**
   * GitHub's header and its height when shown, or the bottom of the bar found without it: both force a layout, so
   * they are measured once per element and viewport width.
   */
  let measured: { header: HTMLElement | null; width: number; height: number } | null = null;
  let resizeFrame = 0;
  /** Headers hidden in `merged`, with their inline style to restore. */
  const hidden = new Map<HTMLElement, string | null>();

  const layoutSizes = () => {
    const sizes = stickySizes(stickTop, extent);
    wrapper.style.cssText = `position:relative;width:100%;flex:1 1 auto;min-width:0;height:${sizes.wrapper};`;
    iframe.style.cssText = `display:block;width:100%;border:0;position:sticky;top:${stickTop}px;height:${sizes.iframe};`;
  };

  const sendScroll = () => {
    if (!port) return;
    const { top, stuck } = listScroll(wrapper.getBoundingClientRect().top, stickTop, extent);
    const key = `${top}|${stuck}|${lastAck}`;
    if (key === lastPosted) return;
    lastPosted = key;
    port.postMessage({ type: 'scroll', top, stuck, ack: lastAck } satisfies PageScrollMessage);
  };

  const hide = (header: HTMLElement) => {
    if (!hidden.has(header)) hidden.set(header, header.getAttribute('style'));
    if (header.style.getPropertyPriority('display') !== 'important' || header.style.display !== 'none') {
      header.style.setProperty('display', 'none', 'important');
    }
  };

  /** Where the iframe sticks: below GitHub's header, at 0 when it is hidden, else below any bar pinned to the top. */
  const measureStickTop = (): number => {
    const header = findStickyHeader(anchor);
    if (header && layout === 'merged') {
      hide(header);
      return 0;
    }
    const width = win.innerWidth;
    if (measured?.header !== header || measured.width !== width) {
      measured = { header, width, height: header ? stickyHeaderHeight(header) : topBarBottom(doc, wrapper) };
    }
    return measured.height;
  };

  const remeasure = () => {
    const next = measureStickTop();
    if (next === stickTop) return;
    stickTop = next;
    layoutSizes();
    sendScroll();
  };

  const onResize = () => {
    if (resizeFrame) return;
    resizeFrame = win.requestAnimationFrame(() => {
      resizeFrame = 0;
      remeasure();
    });
  };

  const onScroll = () => {
    if (Math.abs(win.scrollY - lastY) >= 1) movedByItselfAt = performance.now();
    lastY = win.scrollY;
    sendScroll();
  };

  const onMessage = (event: MessageEvent) => {
    const msg = parseViewerMessage(event.data);
    if (!msg) return;
    if (msg.type === 'extent') {
      if (msg.extent === extent) return;
      extent = msg.extent;
      layoutSizes();
    } else if (msg.type === 'scrollTo') {
      lastAck = msg.seq;
      const dy = pageScrollDelta(wrapper.getBoundingClientRect().top, stickTop, msg.top);
      if (Math.abs(dy) >= 1) win.scrollBy({ top: dy, behavior: 'instant' });
      lastY = win.scrollY;
    } else {
      // Chrome latched this wheel gesture to the page after all (a trackpad gesture can outlast the viewer's guess at
      // its end): the page is scrolling itself, and taking the hand-off too would scroll it twice.
      if (performance.now() - movedByItselfAt < OWN_SCROLL_MS) return;
      win.scrollBy({ top: msg.dy, behavior: 'instant' });
      lastY = win.scrollY;
      return; // the scroll event reports it
    }
    // Also when the page could not move (already there, or at its end): the viewer waits for this ack.
    sendScroll();
  };

  stickTop = measureStickTop();
  layoutSizes();
  win.addEventListener('scroll', onScroll, { passive: true });
  win.addEventListener('resize', onResize, { passive: true });

  return {
    wrapper,
    connect(next) {
      if (port) {
        port.onmessage = null;
        port.close();
      }
      port = next;
      lastAck = 0;
      lastPosted = '';
      port.onmessage = onMessage;
      sendScroll();
    },
    refresh: remeasure,
    dispose() {
      win.removeEventListener('scroll', onScroll);
      win.removeEventListener('resize', onResize);
      win.cancelAnimationFrame(resizeFrame);
      if (port) {
        port.onmessage = null;
        port.close();
        port = null;
      }
      for (const [el, style] of hidden) {
        if (style === null) el.removeAttribute('style');
        else el.setAttribute('style', style);
      }
      hidden.clear();
    },
  };
}
