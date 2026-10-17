import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createConnection, parsePrParam } from './connection';
import { initBatchPersistence } from './state/batch';
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
  void connection.ready.then((colorMode) => useSettings.getState().setColorMode(colorMode));
  root.render(<App prRef={prRef} rpc={connection.rpc} />);
}
