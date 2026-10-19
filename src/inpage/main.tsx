/** The viewer shares GitHub's document scroll; only highlighting workers live in an extension-origin frame. */
import './windowScroll';
import { terminateWorkerPoolSingleton } from '@pierre/diffs/worker';
import { createRoot } from 'react-dom/client';
import { createLifecycle } from '../content/lifecycle';
import { storedSettings } from '../content/settings-source';
import { findContentAnchor } from '../content/host';
import { reachedBreakpoints } from '../shared/viewport';
import { App, workerSpike } from '../viewer/App';
import { createConnection } from '../viewer/connection';
import { ignoreBenignErrors } from '../viewer/benignErrors';
import { setViewerRoot } from '../viewer/rootEl';
import { initSettings, useSettings } from '../viewer/state/settings';
import { initBatchPersistence } from '../viewer/state/batch';
import { initDraftPersistence } from '../viewer/state/drafts';
import { initFileGroups } from '../viewer/state/fileGroups';
import { initRelatedFiles } from '../viewer/state/relatedFiles';
import { startFreshness } from '../viewer/state/freshness';
import { session } from '../viewer/state/session';
import { usePr } from '../viewer/state/store';
import { setInsetTop } from './windowScroll';
import { createWorkerBridge } from './workerBridge';

ignoreBenignErrors(window);
const lifecycle = createLifecycle(window, storedSettings(), (doc, ref, layout) => {
  if (window.top !== window) throw new Error('In-page spike must run in GitHub’s top document');
  const anchor = findContentAnchor(doc);
  if (!anchor) throw new Error('Glide: PR content anchor missing');
  const host = doc.createElement('div');
  host.id = 'glide-inpage-spike';
  host.dataset.glideRenderer = 'in-page';
  const shadow = host.attachShadow({ mode: 'open' });
  const css = doc.createElement('link');
  css.rel = 'stylesheet';
  css.href = chrome.runtime.getURL('inpage.css');
  const container = doc.createElement('div');
  container.id = 'root';
  shadow.append(css, container);
  setViewerRoot(host, shadow);
  setInsetTop(() => shadow.querySelector('.pierre-toolbar')?.getBoundingClientRect().height ?? 60);
  const hidden = new Map<HTMLElement, string | null>();
  let mounted = true;
  let workers: ReturnType<typeof createWorkerBridge> | undefined;
  const refresh = () => {
    const currentAnchor = findContentAnchor(doc);
    if (!mounted || !currentAnchor || (workers && !workers.isConnected())) return false;
    // GitHub may replace its layout after the initial route load. Keep the existing React root and worker pool.
    if (host.previousElementSibling !== currentAnchor) currentAnchor.after(host);
    for (let el = currentAnchor.nextElementSibling; el; el = el.nextElementSibling) {
      if (el === host || !(el instanceof HTMLElement)) continue;
      if (!hidden.has(el)) hidden.set(el, el.getAttribute('style'));
      if (el.style.display !== 'none') el.style.setProperty('display', 'none', 'important');
    }
    return true;
  };
  refresh();
  const fitMenus = () => {
    const bottom = shadow.querySelector('.pierre-toolbar')?.getBoundingClientRect().bottom
      ?? Math.max(0, host.getBoundingClientRect().top) + 60;
    host.style.setProperty('--glide-menu-space', `${Math.max(0, innerHeight - bottom - 8)}px`);
  };
  const onResize = () => {
    host.dataset.viewport = reachedBreakpoints(innerWidth).join(' ');
    fitMenus();
  };
  onResize();
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', fitMenus, { passive: true });
  shadow.addEventListener('keydown', (event) => event.stopPropagation());
  usePr.setState(usePr.getInitialState());
  const cleanups = [initSettings(), initBatchPersistence(), initDraftPersistence(), initFileGroups(), initRelatedFiles()];
  const connection = createConnection(window, { source: window });
  session.rpc = connection.rpc;
  const connect = () => {
    const channel = new MessageChannel();
    window.postMessage({ type: 'pierre:bridge-reset' }, location.origin);
    window.postMessage({ type: 'pierre:bridge-port' }, location.origin, [channel.port2]);
    window.postMessage({ type: 'pierre:port', colorMode: doc.documentElement.getAttribute('data-color-mode') }, location.origin, [channel.port1]);
  };
  const onBridgeReady = (event: MessageEvent) => {
    if (event.source === window && event.origin === location.origin && event.data?.type === 'pierre:bridge-ready') connect();
  };
  window.addEventListener('message', onBridgeReady);
  connect();
  void connection.ready.then(color => mounted && useSettings.getState().setColorMode(color));
  cleanups.push(startFreshness());
  const root = createRoot(container);
  root.render(<div className="pierre-loading">Starting highlighting workers…</div>);
  workers = createWorkerBridge(doc);
  void workers.ready.then(factory => {
    if (!mounted) return;
    workerSpike.factory = factory;
    root.render(<App prRef={ref} rpc={connection.rpc} />);
  }).catch((error: unknown) => {
    if (mounted) root.render(<div className="fatal" role="alert">{error instanceof Error ? error.message : String(error)}</div>);
  });
  return {
    layout,
    refresh,
    unmount() {
      if (!mounted) return;
      mounted = false;
      root.unmount();
      for (const cleanup of cleanups) cleanup();
      terminateWorkerPoolSingleton();
      workers?.dispose();
      connection.dispose();
      session.rpc = undefined;
      workerSpike.factory = undefined;
      window.removeEventListener('message', onBridgeReady);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', fitMenus);
      host.remove();
      for (const [el, style] of hidden) {
        if (style === null) el.removeAttribute('style');
        else el.setAttribute('style', style);
      }
      window.postMessage({ type: 'pierre:bridge-reset' }, location.origin);
    },
  };
});
if (document.body) lifecycle.start();
else document.addEventListener('DOMContentLoaded', () => lifecycle.start(), { once: true });
