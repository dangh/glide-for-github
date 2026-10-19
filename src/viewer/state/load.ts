/**
 * Loading (and reloading) a pull request into the store: PR data, then the viewer's pending review and the
 * threads in the background. Used on start (App) and after a write that changes the PR (applying suggestions).
 */
import type { PrRef } from '../../shared/pr-url';
import { fetchPrData, fetchStack, fetchThreads, type Rpc } from '../github/private';
import { toThreadModels } from '../github/threads';
import { pruneBatch } from './batch';
import { initPendingReview, resetReviewCaches } from './review';
import { session } from './session';
import { usePr } from './store';

/**
 * Fetches the PR and puts it in the store (diffs reload, viewed state and pending review come fresh from GitHub;
 * `headMoved` resets; drafts and the suggestion batch stay). `isCurrent` lets a caller drop a result that arrives
 * after it moved on. Resolves once the PR data is set, with `threads`: settles when the threads are in (then the
 * batch is pruned of refs that no longer apply). Thread failures are not fatal. The PR's stack follows in the
 * background; a failure keeps the stack shown before. `initial`: the viewer's first load, which may use the route the
 * bridge prefetched during page load (never a reload).
 */
export async function loadPr(
  rpc: Rpc,
  ref: PrRef,
  isCurrent: () => boolean = () => true,
  opts: { initial?: boolean } = {},
): Promise<{ threads: Promise<void> }> {
  const data = await fetchPrData(rpc, ref, { prefetched: opts.initial === true });
  if (!isCurrent()) return { threads: Promise.resolve() };
  resetReviewCaches();
  usePr.getState().setPr(data);
  void initPendingReview(data);
  fetchStack(rpc, ref)
    .then((stack) => {
      if (isCurrent() && usePr.getState().pr === data) usePr.getState().setStack(stack);
    })
    .catch((err: unknown) => console.warn('[pierre] stack', err));
  const threads = fetchThreads(rpc, ref, { markers: data.threadMarkers })
    .then((raw) => {
      if (!isCurrent() || usePr.getState().pr !== data) return;
      usePr.getState().setThreads(toThreadModels(raw));
      pruneBatch();
    })
    .catch((err: unknown) => console.warn('[pierre] threads', err));
  return { threads };
}

/**
 * Soft reload of the current PR (the toolbar's Refresh button, and after a head move): new PR data and
 * threads without reloading the page, so the suggestion batch, drafts and open composers are kept.
 */
export async function reloadPr(): Promise<void> {
  const pr = usePr.getState().pr;
  const rpc = session.rpc;
  if (!pr || !rpc) return;
  const { threads } = await loadPr(rpc, pr.ref, () => usePr.getState().pr?.ref === pr.ref);
  await threads;
}
