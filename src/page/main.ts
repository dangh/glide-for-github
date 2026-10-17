// MAIN-world entry (built to dist/bridge.js and injected with world MAIN at document_start).
import { createBridgeImpl, startBridge } from './bridge';
import { createRoutePrefetch, prefetchPath, startWhenHeadReady } from './prefetch';

// On `…/pull/N#pierre`, GitHub's route JSON is requested while GitHub's page is still loading (see prefetch.ts).
const path = prefetchPath(location.href);
if (path) {
  const prefetch = createRoutePrefetch(createBridgeImpl({ doc: document }), path);
  startBridge(window, {}, prefetch.impl);
  startWhenHeadReady(document, () => prefetch.start());
} else {
  startBridge(window);
}
