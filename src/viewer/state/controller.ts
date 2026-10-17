/**
 * Wires the loader to the store: one loader per (PR, range, whitespace); a change cancels the old loader
 * and restarts loading (diffs already shown stay until their replacement arrives).
 */
import { parseDiffFromFile, type FileDiffMetadata } from '@pierre/diffs';
import { BridgeError } from '../../shared/rpc';
import { fetchFullFile, type FileSummary, type PrData, type Rpc } from '../github/private';
import { createLoader, type Loader, type LoaderStats } from './loader';
import { rangeOids, type CommitRange } from './range';
import { session } from './session';
import { usePr } from './store';

declare global {
  interface Window {
    /** Loader timings for e2e/perf checks (Task 12). */
    __pierreStats?: LoaderStats & { files: number };
  }
}

/** Full file text at `oid`, or null when the file does not exist there (404). */
async function fileAt(rpc: Rpc, pr: PrData, path: string, oid: string): Promise<string | null> {
  try {
    return await fetchFullFile(rpc, pr.ref, path, oid);
  } catch (err) {
    if (err instanceof BridgeError && err.status === 404) return null;
    throw err;
  }
}

/** A diff computed from the full old/new files (for diffs GitHub refuses to return). */
export async function fullFileDiff(
  rpc: Rpc,
  pr: PrData,
  range: CommitRange,
  whitespace: boolean,
  summary: FileSummary,
): Promise<FileDiffMetadata> {
  const { oldOid, newOid } = rangeOids(pr, range);
  const oldPath = summary.prevPath ?? summary.path;
  const [oldText, newText] = await Promise.all([
    summary.status === 'added' ? null : fileAt(rpc, pr, oldPath, oldOid),
    summary.status === 'deleted' ? null : fileAt(rpc, pr, summary.path, newOid),
  ]);
  return parseDiffFromFile(
    oldText === null ? null : { name: oldPath, contents: oldText, cacheKey: `${oldOid}:${oldPath}` },
    newText === null ? null : { name: summary.path, contents: newText, cacheKey: `${newOid}:${summary.path}` },
    whitespace ? { ignoreWhitespace: true } : undefined,
  );
}

export function startLoader(rpc: Rpc, whitespace: boolean, store = usePr): Loader | undefined {
  const state = store.getState();
  const pr = state.pr;
  if (!pr) return undefined;
  session.loader?.cancel();
  if (state.diffs.size > 0 || [...state.load.values()].some((l) => l.status !== 'pending')) {
    state.setLoad(state.order, { status: 'pending' });
  }
  const loader = createLoader({
    rpc,
    pr,
    range: state.range,
    whitespace,
    getSummary: (path) => store.getState().files.get(path),
    onResults: (results) => store.getState().applyLoads(results),
    onLoading: (paths, load) => store.getState().setLoad(paths, load),
    fullFileDiff: (summary) => fullFileDiff(rpc, pr, state.range, whitespace, summary),
  });
  session.loader = loader;
  const stats = loader.stats;
  window.__pierreStats = Object.assign(stats, { files: pr.files.length });
  loader.done.then(() => {
    if (session.loader !== loader || stats.doneAt === undefined) return;
    const first = stats.firstDiffAt !== undefined ? Math.round(stats.firstDiffAt - stats.startedAt) : '-';
    console.info(
      `[pierre] ${pr.files.length} files: first diff ${first} ms, all ${Math.round(stats.doneAt - stats.startedAt)} ms, ${stats.requests} requests`,
    );
  });
  loader.start();
  return loader;
}
