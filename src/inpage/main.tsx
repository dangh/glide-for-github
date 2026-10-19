/** The viewer shares GitHub's document scroll; only highlighting workers live in an extension-origin frame. */
import '../viewer/inspection';
import { scrollWindowToTop } from './windowScroll';
import { terminateWorkerPoolSingleton } from '@pierre/diffs/worker';
import { createRoot } from 'react-dom/client';
import { createLifecycle } from '../content/lifecycle';
import { storedSettings } from '../content/settings-source';
import { createContentHost, findContentAnchor } from '../content/host';
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
import { resetReviewCaches } from '../viewer/state/review';
import { connectBridge } from './connectBridge';
import { createInPageLayout } from './layout';
import { createWorkerBridge } from './workerBridge';
import { createScrollPosition } from './scrollPosition';
import { restoreKey } from '../shared/page-scroll';
import { prKey } from '../shared/pr-url';
import { migrateLegacyState } from './legacyState';

ignoreBenignErrors(window);
const lifecycle = createLifecycle(window, storedSettings(), (doc, ref, layout) => {
  if (window.top !== window) throw new Error('Glide must run in GitHub’s top document');
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
  const pageLayout = createInPageLayout(doc, host, shadow, layout, anchor);
  const contentHost = createContentHost(doc, host);
  let mounted = true;
  let workers: ReturnType<typeof createWorkerBridge> | undefined;
  const refresh = () => {
    if (!mounted || (workers && !workers.isConnected())) return false;
    const currentAnchor = contentHost.refresh();
    if (!currentAnchor) return false;
    pageLayout.refresh(currentAnchor);
    return true;
  };
  refresh();
  const scrollPosition = createScrollPosition(window, restoreKey(prKey(ref)), { deferRestore: true });
  session.pageScroll = scrollPosition;
  const migration = new AbortController();
  session.scrollPageToTop = scrollWindowToTop;
  shadow.addEventListener('keydown', (event) => event.stopPropagation());
  usePr.setState(usePr.getInitialState());
  const cleanups = [initSettings()];
  const connection = createConnection(window, { source: window });
  session.rpc = connection.rpc;
  const disconnectBridge = connectBridge(window);
  void connection.ready.then(color => mounted && useSettings.getState().setColorMode(color));
  cleanups.push(startFreshness());
  const root = createRoot(container);
  root.render(<div className="pierre-loading">Starting highlighting workers…</div>);
  workers = createWorkerBridge(doc);
  void workers.ready.then(async factory => {
    if (!mounted) return;
    await migrateLegacyState(ref, migration.signal);
    if (!mounted) return;
    scrollPosition.start();
    cleanups.push(initBatchPersistence(), initDraftPersistence(), initFileGroups(), initRelatedFiles());
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
      migration.abort();
      scrollPosition.dispose();
      root.unmount();
      resetReviewCaches();
      pageLayout.dispose();
      for (const cleanup of cleanups) cleanup();
      terminateWorkerPoolSingleton();
      workers?.dispose();
      connection.dispose();
      session.rpc = undefined;
      session.scrollPageToTop = undefined;
      session.pageScroll = undefined;
      session.viewport = undefined;
      workerSpike.factory = undefined;
      disconnectBridge();
      contentHost.unmount();
    },
  };
});
if (document.body) lifecycle.start();
else document.addEventListener('DOMContentLoaded', () => lifecycle.start(), { once: true });
