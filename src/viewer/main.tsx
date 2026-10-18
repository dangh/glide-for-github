import { createRoot } from 'react-dom/client';
import { BRAND } from '../shared/brand';
import { parseScrollLayout, restoreKey } from '../shared/page-scroll';
import { prKey } from '../shared/pr-url';
import { reachedBreakpoints, type Breakpoint } from '../shared/viewport';
import { App } from './App';
import { createConnection, parsePrParam, watchPort } from './connection';
import { createPageScrollView, type PageScrollView } from './pageScroll';
import { initBatchPersistence } from './state/batch';
import { initDraftPersistence } from './state/drafts';
import { initFileGroups, useFileGroups } from './state/fileGroups';
import { startFreshness } from './state/freshness';
import * as review from './state/review';
import { session } from './state/session';
import { initSettings, useSettings } from './state/settings';
import { usePr } from './state/store';

declare global {
  interface Window {
    /** Inspection hooks for e2e/perf tests (extension page only; never reachable from github.com). */
    __pierre?: { store: typeof usePr; settings: typeof useSettings; session: typeof session; review: typeof review; fileGroups: typeof useFileGroups };
  }
}
window.__pierre = { store: usePr, settings: useSettings, session, review, fileGroups: useFileGroups };

const root = createRoot(document.getElementById('root')!);
const prRef = parsePrParam(location.search);
if (!prRef) {
  root.render(<div className="fatal">{BRAND.short}: missing pull request.</div>);
} else {
  const layout = parseScrollLayout(location.search);
  let pageScroll: PageScrollView | undefined;
  if (layout !== 'frame') {
    document.documentElement.dataset.scrollLayout = layout;
    pageScroll = session.pageScroll = createPageScrollView(window, layout, restoreKey(prKey(prRef)));
  }
  // viewer.css follows GitHub's viewport; until the page reports it, the iframe's width is the best guess.
  const showViewport = (reached: Breakpoint[]) => (document.documentElement.dataset.viewport = reached.join(' '));
  showViewport(reachedBreakpoints(window.innerWidth));
  // Without page scrolling, a scroll port is closed unused (src/viewer/connection.ts).
  const connection = createConnection(window, {
    onViewport: showViewport,
    onScrollPort: pageScroll && ((port) => pageScroll.setPort(port)),
  });
  session.rpc = connection.rpc;
  initSettings();
  initBatchPersistence();
  initDraftPersistence();
  initFileGroups();
  startFreshness();
  // No port from the content script (extension updated, content script gone): say so instead of loading forever.
  watchPort(connection.ready, (message) => {
    if (!usePr.getState().pr) usePr.getState().setFatal(message);
  });
  void connection.ready.then((colorMode) => useSettings.getState().setColorMode(colorMode));
  root.render(<App prRef={prRef} rpc={connection.rpc} />);
}
