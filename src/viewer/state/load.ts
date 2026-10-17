/**
 * Loading (and reloading) a pull request into the store: PR data, then the viewer's pending review and the
 * threads in the background. Used on start (App) and after a write that changes the PR (applying suggestions).
 */
import type { PrRef } from '../../shared/pr-url';
import { fetchPrData, fetchThreads, type Rpc } from '../github/private';
import { toThreadModels } from '../github/threads';
import { initPendingReview, resetReviewCaches } from './review';
import { usePr } from './store';

/**
 * Fetches the PR and puts it in the store (diffs reload, viewed state and pending review come fresh from GitHub).
 * `isCurrent` lets a caller drop a result that arrives after it moved on. Thread failures are not fatal.
 */
export async function loadPr(rpc: Rpc, ref: PrRef, isCurrent: () => boolean = () => true): Promise<void> {
  const data = await fetchPrData(rpc, ref);
  if (!isCurrent()) return;
  resetReviewCaches();
  usePr.getState().setPr(data);
  void initPendingReview(data);
  fetchThreads(rpc, ref, { markers: data.threadMarkers })
    .then((raw) => {
      if (isCurrent() && usePr.getState().pr === data) usePr.getState().setThreads(toThreadModels(raw));
    })
    .catch((err: unknown) => console.warn('[pierre] threads', err));
}
