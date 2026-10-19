/** Throwaway spike: full viewer in an isolated shadow root, sharing the page's scroll. */
import './windowScroll';
import { createRoot } from 'react-dom/client';
import { findContentAnchor } from '../content/host';
import { injectTab, setTabActive } from '../content/tab';
import { parsePrUrl, isGlideActive } from '../shared/pr-url';
import { createRpcClient, type BridgeMethods } from '../shared/rpc';
import { reachedBreakpoints } from '../shared/viewport';
import { App, workerSpike } from '../viewer/App';
import { setViewerRoot } from '../viewer/rootEl';
import { initSettings, useSettings } from '../viewer/state/settings';
import { initBatchPersistence } from '../viewer/state/batch';
import { initDraftPersistence } from '../viewer/state/drafts';
import { initFileGroups } from '../viewer/state/fileGroups';
import { initRelatedFiles } from '../viewer/state/relatedFiles';
import { startFreshness } from '../viewer/state/freshness';
import { session } from '../viewer/state/session';
import { setInsetTop } from './windowScroll';

const ref = parsePrUrl(location.href);
// Register on every PR, including when Glide is opened after the initial page load.
if (ref) {
  injectTab(document, ref);
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('a[data-pierre-tab]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    location.assign(location.pathname + location.search + '#glide');
    location.reload();
  }, true);
}
if (ref && isGlideActive(location.href)) {
  setTabActive(document, true);
  const anchor = findContentAnchor(document);
  if (!anchor) throw new Error('Spike: PR content anchor missing');
  const host = document.createElement('div');
  host.id = 'glide-inpage-spike';
  host.dataset.glideRenderer = 'in-page';
  if (window.top !== window) throw new Error('In-page spike must run in GitHub’s top document');
  const shadow = host.attachShadow({ mode: 'open' });
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = chrome.runtime.getURL('inpage.css');
  const container = document.createElement('div');
  container.id = 'root';
  shadow.append(css, container);
  const hidden = new Map<HTMLElement, string | null>();
  for (let el = anchor.nextElementSibling; el; el = el.nextElementSibling) {
    if (el instanceof HTMLElement) {
      hidden.set(el, el.getAttribute('style'));
      el.style.setProperty('display', 'none', 'important');
    }
  }
  anchor.after(host);
  setViewerRoot(host, shadow);
  host.dataset.viewport = reachedBreakpoints(innerWidth).join(' ');
  setInsetTop(() => shadow.querySelector('.pierre-toolbar')?.getBoundingClientRect().height ?? 60);
  // A blocked worker must be visible in this spike, rather than silently claiming worker success.
  workerSpike.factory = () => new Worker(chrome.runtime.getURL('pierre-worker.js'));
  const channel = new MessageChannel();
  const rpc = createRpcClient<BridgeMethods>(channel.port1);
  window.postMessage({ type: 'pierre:bridge-port' }, location.origin, [channel.port2]);
  session.rpc = rpc;
  initSettings();
  initBatchPersistence();
  initDraftPersistence();
  initFileGroups();
  initRelatedFiles();
  startFreshness();
  useSettings.getState().setColorMode(document.documentElement.getAttribute('data-color-mode') ?? undefined);
  // Keep GitHub's letter shortcuts out of the editor; internal handlers run first.
  shadow.addEventListener('keydown', (event) => event.stopPropagation());
  createRoot(container).render(<App prRef={ref} rpc={rpc} />);
  // Deliberately use a full navigation in this prototype; production needs lifecycle-owned teardown.
  window.addEventListener('hashchange', () => location.reload());
}
