import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createConnection, parsePrParam, watchPort } from './connection';
import { initBatchPersistence } from './state/batch';
import { initDraftPersistence } from './state/drafts';
import { startFreshness } from './state/freshness';
import * as review from './state/review';
import { session } from './state/session';
import { initSettings, useSettings } from './state/settings';
import { usePr } from './state/store';

declare global {
  interface Window {
    /** Inspection hooks for e2e/perf tests (extension page only; never reachable from github.com). */
    __pierre?: { store: typeof usePr; settings: typeof useSettings; session: typeof session; review: typeof review };
  }
}
window.__pierre = { store: usePr, settings: useSettings, session, review };

const root = createRoot(document.getElementById('root')!);
const prRef = parsePrParam(location.search);
if (!prRef) {
  root.render(<div className="fatal">Pierre: missing pull request.</div>);
} else {
  const connection = createConnection(window);
  session.rpc = connection.rpc;
  initSettings();
  initBatchPersistence();
  initDraftPersistence();
  startFreshness();
  // No port from the content script (extension updated, content script gone): say so instead of loading forever.
  watchPort(connection.ready, (message) => {
    if (!usePr.getState().pr) usePr.getState().setFatal(message);
  });
  void connection.ready.then((colorMode) => useSettings.getState().setColorMode(colorMode));
  root.render(<App prRef={prRef} rpc={connection.rpc} />);
}
