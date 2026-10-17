import { prKey, type PrRef } from '../shared/pr-url';
import { findTabNav } from './tab';

/** The viewer never gets shorter than this (small windows scroll the page instead). */
export const MIN_VIEWER_HEIGHT_PX = 320;

/**
 * Height that makes the iframe end exactly at the bottom of the viewport when the page is scrolled to the
 * top: `100vh` minus the iframe's offset from the top of the document (GitHub's header, PR title, tabs).
 * (The iframe also has `min-height: MIN_VIEWER_HEIGHT_PX`.)
 */
export function viewerHeight(iframe: HTMLElement, win: Window): string {
  const top = Math.max(0, Math.round(iframe.getBoundingClientRect().top + win.scrollY));
  return `calc(100vh - ${top}px)`;
}

/** The only `chrome.*` use in the content script, injectable so jsdom tests can fake it. */
let resolveExtensionUrl = (path: string): string => chrome.runtime.getURL(path);

export function setExtensionUrlResolver(fn: (path: string) => string): void {
  resolveExtensionUrl = fn;
}

export interface ViewerHost {
  iframe: HTMLIFrameElement;
  /** Removes the iframe, restores GitHub's content and tells the bridge to reset. Idempotent. */
  unmount(): void;
  /**
   * Re-hides content GitHub re-rendered since mount. Returns false when the host is stale
   * (iframe detached or the page layout was replaced) and must be remounted.
   */
  refresh(): boolean;
}

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

function originOf(url: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\/[^/]+/i.exec(url)?.[0] ?? url;
}

export function mountViewer(doc: Document, ref: PrRef): ViewerHost {
  const win = doc.defaultView;
  const anchor = findContentAnchor(doc);
  if (!win || !anchor || !anchor.parentElement) throw new Error('Pierre: PR tab content container not found');
  const parent = anchor.parentElement;
  let mounted = true;

  const iframe = doc.createElement('iframe');
  iframe.setAttribute('src', resolveExtensionUrl('viewer.html?pr=' + encodeURIComponent(prKey(ref))));
  iframe.setAttribute('title', 'Pierre');
  iframe.setAttribute('data-pierre-viewer', '');
  iframe.style.cssText = `display:block;width:100%;border:0;min-height:${MIN_VIEWER_HEIGHT_PX}px;`;
  const fitHeight = () => {
    if (!mounted || !iframe.isConnected) return;
    const height = viewerHeight(iframe, win);
    if (iframe.style.height !== height) iframe.style.height = height;
  };

  // Hide GitHub's tab content, remembering each element's inline style to restore it exactly.
  const hidden = new Map<HTMLElement, string | null>();
  const hideContent = () => {
    for (let el = anchor.nextElementSibling; el; el = el.nextElementSibling) {
      if (el === iframe || !(el instanceof win.HTMLElement)) continue;
      if (!hidden.has(el)) hidden.set(el, el.getAttribute('style'));
      el.style.setProperty('display', 'none', 'important');
    }
  };

  // One MessageChannel per handshake: port1 goes to the viewer, port2 to the MAIN-world bridge.
  const extOrigin = originOf(resolveExtensionUrl(''));
  let channel = new MessageChannel();
  let loaded = false;
  const sendToViewer = () => {
    iframe.contentWindow?.postMessage(
      { type: 'pierre:port', colorMode: doc.documentElement.getAttribute('data-color-mode') ?? undefined },
      extOrigin,
      [channel.port1],
    );
  };
  const sendToBridge = () => win.postMessage({ type: 'pierre:bridge-port' }, win.location.origin, [channel.port2]);
  const onLoad = () => {
    loaded = true;
    sendToViewer();
  };
  iframe.addEventListener('load', onLoad, { once: true });

  // The bridge runs at document_start, this script at document_idle, but a bridge that started late (e.g. an
  // extension update) must still work. If the bridge starts after we mounted, our
  // first port went nowhere; it announces itself with `pierre:bridge-ready` and we hand out a fresh
  // channel to both sides. (The viewer accepts a replacement port at any time: see src/shared/rpc.ts.)
  const onBridgeReady = (event: MessageEvent) => {
    if (event.source !== win || event.origin !== win.location.origin) return;
    if ((event.data as { type?: unknown } | null)?.type !== 'pierre:bridge-ready') return;
    if (!mounted || !iframe.isConnected) return;
    channel.port1.close();
    channel.port2.close();
    channel = new MessageChannel();
    // The bridge may already have accepted our first port (it was queued before the bridge started
    // listening, and ready was posted after it) and ignores further ports while one is active. Messages
    // are delivered in order, so a reset first frees it; with no active port the reset is a no-op.
    win.postMessage({ type: 'pierre:bridge-reset' }, win.location.origin);
    sendToBridge();
    if (loaded) sendToViewer(); // otherwise onLoad sends the newest port1
  };
  win.addEventListener('message', onBridgeReady);

  hideContent();
  parent.append(iframe);
  fitHeight();
  win.addEventListener('resize', fitHeight);
  sendToBridge();

  return {
    iframe,
    refresh() {
      if (!mounted || !iframe.isConnected || findContentAnchor(doc) !== anchor || iframe.parentElement !== parent) {
        return false;
      }
      hideContent();
      fitHeight();
      return true;
    },
    unmount() {
      if (!mounted) return;
      mounted = false;
      iframe.removeEventListener('load', onLoad);
      win.removeEventListener('message', onBridgeReady);
      win.removeEventListener('resize', fitHeight);
      iframe.remove();
      for (const [el, style] of hidden) {
        if (style === null) el.removeAttribute('style');
        else el.setAttribute('style', style);
      }
      hidden.clear();
      win.postMessage({ type: 'pierre:bridge-reset' }, win.location.origin);
      channel.port1.close();
      channel.port2.close();
    },
  };
}
