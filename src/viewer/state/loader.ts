/**
 * Batched diff loading queue.
 *
 * - Paths are fetched with `diff_entries` in file order, at most `concurrency` requests in flight, each
 *   request one chunk (`chunkPaths` limits; the first request is small so the first diff shows fast).
 * - `prioritize(paths)` (the files in or near the viewport, top first) moves those paths to the front, and
 *   lazily loads the lines of collapsed entries (`needsLines`, e.g. deleted files) among them.
 * - Too-large files only load on `loadLines(path)` ("Load diff").
 * - Conversion to Pierre metadata is time-sliced (`sliceMs`), results are delivered in batches through
 *   `onResults`, so the main thread never runs one long task per chunk.
 * - A failed chunk (after `fetchDiffEntries`' own retry) marks its files `error`; `retry(path)` re-queues.
 */
import type { FileDiffMetadata } from '@pierre/diffs';
import { toFileDiff } from '../github/convert';
import {
  applyDiffEntry,
  chunkPaths,
  fetchDiffEntries,
  loadEntryLines,
  MAX_IN_FLIGHT,
  MAX_PATHS_PER_REQUEST,
  type DiffEntry,
  type DiffOptions,
  type FileSummary,
  type GithubDiffLine,
  type PrData,
  type Rpc,
} from '../github/private';
import { rangeParam, type CommitRange } from './range';
import type { FileLoadResult, FileLoadState } from './store';

export interface LoaderOptions {
  rpc: Rpc;
  pr: PrData;
  /** Current summaries (the store's `files`). */
  getSummary(path: string): FileSummary | undefined;
  whitespace: boolean;
  range: CommitRange;
  onResults(results: FileLoadResult[]): void;
  /** Paths whose request just started (`loading` / `loadingLines`). */
  onLoading?(paths: string[], load: FileLoadState): void;
  concurrency?: number;
  /** Paths in the first request (default 3). */
  firstChunkSize?: number;
  convert?: (summary: FileSummary, lines: GithubDiffLine[], ctx: { headOid: string; whitespace: boolean }) => FileDiffMetadata;
  /**
   * Fallback for "Load diff" when GitHub returns no lines (its own UI then says "Diff is too big to render"):
   * build the diff from the full old/new files. Without it such files stay empty.
   */
  fullFileDiff?: (summary: FileSummary) => Promise<FileDiffMetadata>;
  yieldToMain?: () => Promise<void>;
  /** Conversion budget per slice in ms before yielding (default 8). */
  sliceMs?: number;
  now?: () => number;
}

export interface LoaderStats {
  startedAt: number;
  /** First file with lines delivered. */
  firstDiffAt?: number;
  /** Every queued path has a result (lazy line loads excluded). */
  doneAt?: number;
  requests: number;
}

export interface Loader {
  start(): void;
  prioritize(paths: readonly string[]): void;
  /** Loads the full lines of a collapsed or too-large file. */
  loadLines(path: string): Promise<void>;
  /** Re-queues a file that failed. */
  retry(path: string): void;
  cancel(): void;
  readonly stats: LoaderStats;
  /** Resolves when every path has a result (or the loader was cancelled). */
  readonly done: Promise<void>;
}

const defaultYield = (): Promise<void> => {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (s?.yield) return s.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
};

export function createLoader(opts: LoaderOptions): Loader {
  const concurrency = Math.max(1, opts.concurrency ?? MAX_IN_FLIGHT);
  const firstChunkSize = Math.max(1, opts.firstChunkSize ?? 3);
  const convert = opts.convert ?? toFileDiff;
  const yieldToMain = opts.yieldToMain ?? defaultYield;
  const sliceMs = opts.sliceMs ?? 8;
  const now = opts.now ?? (() => performance.now());
  const { pr, rpc } = opts;
  const diffOptions: DiffOptions = { whitespace: opts.whitespace, headOid: pr.headOid, range: rangeParam(pr, opts.range) };
  // Cache key context: the range string (not just the head) so that two ranges ending at one commit never share highlights.
  const convertCtx = { headOid: diffOptions.range!, whitespace: opts.whitespace };

  const order = pr.files.map((f) => f.path);
  /** Paths not requested yet, in file order (consumed via `cursor`). */
  const queued = new Set(order);
  let cursor = 0;
  let priority: string[] = [];
  /** Entries waiting for lines; requested lazily (`needsLines`) or on demand (too large). */
  const entries = new Map<string, DiffEntry>();
  const linesQueue: string[] = [];
  const linesRequested = new Set<string>();
  const linesWaiters = new Map<string, { resolve(): void; reject(e: unknown): void }[]>();
  /** Paths without a result yet. */
  const outstanding = new Set(order);

  let inFlight = 0;
  let started = false;
  let cancelled = false;
  let requestsStarted = 0;
  const stats: LoaderStats = { startedAt: now(), requests: 0 };
  let resolveDone!: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));

  const finishPaths = (paths: Iterable<string>) => {
    for (const p of paths) outstanding.delete(p);
    if (outstanding.size === 0 && stats.doneAt === undefined) {
      stats.doneAt = now();
      resolveDone();
    }
  };

  function nextChunk(): string[] {
    const candidates: string[] = [];
    const limit = requestsStarted === 0 ? Math.min(firstChunkSize, MAX_PATHS_PER_REQUEST) : MAX_PATHS_PER_REQUEST;
    const take = (p: string) => {
      if (queued.has(p) && !candidates.includes(p)) candidates.push(p);
    };
    for (const p of priority) {
      if (candidates.length >= limit) break;
      take(p);
    }
    for (let i = cursor; candidates.length < limit && i < order.length; i++) take(order[i]!);
    if (candidates.length === 0) return [];
    const chunk = chunkPaths(candidates)[0]!;
    for (const p of chunk) queued.delete(p);
    while (cursor < order.length && !queued.has(order[cursor]!)) cursor++;
    return chunk;
  }

  function pump() {
    if (cancelled || !started) return;
    while (inFlight < concurrency) {
      const linePath = linesQueue.shift();
      if (linePath !== undefined) {
        void runLines(linePath);
        continue;
      }
      const chunk = nextChunk();
      if (chunk.length === 0) return;
      void runChunk(chunk);
    }
  }

  function resultFor(path: string, entry: DiffEntry): { result: FileLoadResult; lazy: boolean } | undefined {
    const current = opts.getSummary(path);
    if (!current) return undefined;
    const summary = applyDiffEntry(current, entry);
    const counts = { additions: entry.additions, deletions: entry.deletions };
    if (entry.binary) return { result: { path, summary, load: { status: 'binary', ...counts } }, lazy: false };
    if (entry.tooLarge && entry.lines.length === 0) {
      entries.set(path, entry);
      return { result: { path, summary, load: { status: 'too-large', ...counts } }, lazy: false };
    }
    if (entry.needsLines) {
      entries.set(path, entry);
      return { result: { path, summary, load: { status: 'needs-lines', ...counts } }, lazy: true };
    }
    if (entry.lines.length === 0) return { result: { path, summary, load: { status: 'loaded', empty: true, ...counts } }, lazy: false };
    let diff: FileDiffMetadata;
    try {
      diff = convert(summary, entry.lines, convertCtx);
    } catch (err) {
      // One unparseable file must not fail its whole chunk.
      const message = err instanceof Error ? err.message : 'Could not read this diff';
      return { result: { path, summary, load: { status: 'error', message, ...counts } }, lazy: false };
    }
    if (stats.firstDiffAt === undefined) stats.firstDiffAt = now();
    return { result: { path, summary, load: { status: 'loaded', ...counts }, diff }, lazy: false };
  }

  /** Converts entries in time slices, delivering each slice's results. */
  async function deliver(list: DiffEntry[]) {
    let batch: FileLoadResult[] = [];
    let sliceStart = now();
    for (const entry of list) {
      if (cancelled) return;
      const r = resultFor(entry.path, entry);
      if (r) {
        batch.push(r.result);
        if (r.lazy && priority.includes(entry.path)) queueLines(entry.path);
      }
      if (now() - sliceStart >= sliceMs) {
        opts.onResults(batch);
        finishPaths(batch.map((b) => b.path));
        batch = [];
        await yieldToMain();
        sliceStart = now();
      }
    }
    if (cancelled) return;
    if (batch.length > 0) opts.onResults(batch);
    finishPaths(list.map((e) => e.path));
  }

  async function runChunk(chunk: string[]) {
    inFlight++;
    requestsStarted++;
    stats.requests++;
    opts.onLoading?.(chunk, { status: 'loading' });
    try {
      const result = await fetchDiffEntries(rpc, pr.ref, chunk, diffOptions);
      if (cancelled) return;
      await deliver(chunk.map((p) => result.get(p)!).filter(Boolean));
    } catch (err) {
      if (cancelled) return;
      const message = err instanceof Error ? err.message : 'Failed to load';
      const results: FileLoadResult[] = [];
      for (const path of chunk) {
        const summary = opts.getSummary(path);
        if (summary) results.push({ path, summary, load: { status: 'error', message } });
      }
      opts.onResults(results);
      finishPaths(chunk);
    } finally {
      inFlight--;
      pump();
    }
  }

  function queueLines(path: string) {
    if (linesRequested.has(path) || !entries.has(path)) return;
    linesRequested.add(path);
    linesQueue.push(path);
  }

  async function runLines(path: string) {
    inFlight++;
    stats.requests++;
    const entry = entries.get(path)!;
    const waiters = () => {
      const list = linesWaiters.get(path) ?? [];
      linesWaiters.delete(path);
      return list;
    };
    const status: FileLoadState['status'] = entry.tooLarge ? 'too-large' : 'needs-lines';
    opts.onLoading?.([path], { status, additions: entry.additions, deletions: entry.deletions, loadingLines: true });
    try {
      const full = await loadEntryLines(rpc, pr.ref, entry, diffOptions);
      if (cancelled) return;
      const summary = opts.getSummary(path);
      if (!summary) return;
      const counts = { additions: entry.additions, deletions: entry.deletions };
      const next = applyDiffEntry(summary, entry);
      if (full.lines.length === 0 && entry.tooLarge && opts.fullFileDiff) {
        const diff = await opts.fullFileDiff(next);
        if (cancelled) return;
        opts.onResults([{ path, summary: next, load: { status: 'loaded', ...counts }, diff }]);
      } else if (full.lines.length === 0) {
        opts.onResults([
          { path, summary: next, load: { status: 'loaded', empty: true, ...counts, message: 'GitHub did not return this diff.' } },
        ]);
      } else {
        const diff = convert(next, full.lines, convertCtx);
        if (stats.firstDiffAt === undefined) stats.firstDiffAt = now();
        opts.onResults([{ path, summary: next, load: { status: 'loaded', ...counts }, diff }]);
      }
      entries.delete(path);
      for (const w of waiters()) w.resolve();
    } catch (err) {
      linesRequested.delete(path);
      if (cancelled) return;
      const summary = opts.getSummary(path);
      const message = err instanceof Error ? err.message : 'Failed to load';
      if (summary) {
        opts.onResults([
          { path, summary, load: { status, additions: entry.additions, deletions: entry.deletions, message } },
        ]);
      }
      for (const w of waiters()) w.reject(err);
    } finally {
      inFlight--;
      pump();
    }
  }

  return {
    stats,
    done,
    start() {
      if (started) return;
      started = true;
      if (order.length === 0) finishPaths([]);
      pump();
    },
    prioritize(paths) {
      priority = [...paths];
      for (const p of priority) {
        const entry = entries.get(p);
        if (entry && entry.needsLines && !entry.tooLarge) queueLines(p);
      }
      pump();
    },
    loadLines(path) {
      if (!entries.has(path)) return Promise.resolve();
      const promise = new Promise<void>((resolve, reject) => {
        const list = linesWaiters.get(path) ?? [];
        list.push({ resolve, reject });
        linesWaiters.set(path, list);
      });
      if (!linesRequested.has(path)) {
        linesRequested.add(path);
        linesQueue.unshift(path);
      }
      pump();
      return promise;
    },
    retry(path) {
      if (entries.has(path)) {
        void this.loadLines(path).catch(() => undefined);
        return;
      }
      if (cancelled || !order.includes(path) || queued.has(path)) return;
      queued.add(path);
      outstanding.add(path);
      priority = [path, ...priority];
      pump();
    },
    cancel() {
      cancelled = true;
      resolveDone();
      for (const [, list] of linesWaiters) for (const w of list) w.resolve();
      linesWaiters.clear();
    },
  };
}
