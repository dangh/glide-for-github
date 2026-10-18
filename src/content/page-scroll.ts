/**
 * The page's side of page scrolling (see src/shared/page-scroll.ts): the sticky iframe in its tall wrapper, GitHub's
 * sticky PR header (measured in `page`, hidden in `merged`), and the scroll channel to the viewer.
 */
import {
  listScroll,
  pageScrollDelta,
  stickySizes,
  type PageScrollMessage,
  type ScrollLayout,
  type ViewerScrollMessage,
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

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A message from the viewer, or null for anything that is not one. */
function parseViewerMessage(data: unknown): ViewerScrollMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const m = data as Record<string, unknown>;
  if (m.type === 'extent' && isNumber(m.extent) && m.extent >= 0) return { type: 'extent', extent: m.extent };
  if (m.type === 'scrollTo' && isNumber(m.top) && isNumber(m.seq)) return { type: 'scrollTo', top: m.top, seq: m.seq };
  if (m.type === 'scrollBy' && isNumber(m.dy)) return { type: 'scrollBy', dy: m.dy };
  return null;
}

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
  /** GitHub's header and its height when shown, measured once per element and window size. */
  let measured: { header: HTMLElement; height: number } | null = null;
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
    if (header) {
      if (measured?.header !== header) measured = { header, height: stickyHeaderHeight(header) };
      return measured.height;
    }
    return topBarBottom(doc, wrapper);
  };

  const remeasure = () => {
    const next = measureStickTop();
    if (next === stickTop) return;
    stickTop = next;
    layoutSizes();
    sendScroll();
  };

  const onResize = () => {
    measured = null;
    remeasure();
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
    } else {
      win.scrollBy({ top: msg.dy, behavior: 'instant' });
      return; // the scroll event reports it
    }
    // Also when the page could not move (already there, or at its end): the viewer waits for this ack.
    sendScroll();
  };

  stickTop = measureStickTop();
  layoutSizes();
  win.addEventListener('scroll', sendScroll, { passive: true });
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
      win.removeEventListener('scroll', sendScroll);
      win.removeEventListener('resize', onResize);
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
