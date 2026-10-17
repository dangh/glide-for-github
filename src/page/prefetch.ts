/**
 * Route prefetch (Task 12, performance). Opening `…/pull/N#glide` used to request GitHub's route JSON
 * (`GET /o/r/pull/N/changes`, ~1 s server time on large PRs) only once the viewer iframe had booted, i.e. after
 * GitHub's page load, and once more when GitHub's React app re-rendered the layout and the iframe was remounted.
 *
 * The bridge now starts at document_start and, on a `#glide` PR URL, issues that request as soon as the page's
 * `<head>` is in (the request needs GitHub's meta tags), in parallel with GitHub's own page load. The viewer's
 * first load (`get(<that path>, {}, {dataRouter: true, prefetched: true})`, which only the viewer's initial
 * `loadPr` sends) is answered from it while it is fresh:
 * - in flight, or settled less than `ttlMs` ago (default 10 s), so each viewer boot of this page load, including a
 *   remounted iframe, shares it. Every other read of the route (thread refreshes after a comment, reloads, "Try
 *   again") omits `prefetched` and goes to GitHub, so nothing after a write (bridge or api.github.com) can be
 *   answered with the pre-write route;
 * - a failed prefetch is never served (the caller makes its own request, with its own error handling);
 * - any write through the bridge drops it, so nothing after a write can see the older route.
 *
 * Diff requests are shared the same way during the page load: GitHub replaces its layout ~0.5 s after the load
 * event, which remounts the viewer while the first viewer's first `diff_entries` requests are in flight, and the
 * second viewer asks for the same chunks again. Identical `page_data/diff_entries` requests (same path and query;
 * the query pins `range` to commit oids, so the answer cannot change) share one request while in flight and for
 * `ttlMs` after it succeeded. Failures are not shared. The bridge lives as long as the tab, so each entry is deleted
 * when its window ends (`ttlMs` after success; `RPC_TIMEOUT_MS` after the request started, if it never settles, so a
 * later identical request goes to the network instead of waiting on a lost one).
 */
import { isGlideActive, parsePrUrl } from '../shared/pr-url';
import { RPC_TIMEOUT_MS, type BridgeMethods, type RpcImpl } from '../shared/rpc';

export const PREFETCH_TTL_MS = 10_000;

/** Bridge methods that only read: everything else may change the PR and drops the prefetched route. */
const READS: ReadonlySet<keyof BridgeMethods> = new Set<keyof BridgeMethods>(['get', 'getText', 'preview']);

/** The route path to prefetch for `url`, or null when the URL is not a PR page showing Glide. */
export function prefetchPath(url: string): string | null {
  const ref = parsePrUrl(url);
  if (!ref || !isGlideActive(url)) return null;
  return `/${ref.owner}/${ref.repo}/pull/${ref.number}/changes`;
}

type GetResult = Awaited<ReturnType<RpcImpl<BridgeMethods>['get']>>;

export interface RoutePrefetch {
  /** `impl` with `get(path, {}, {dataRouter: true})` served from the prefetch while it is fresh. */
  readonly impl: RpcImpl<BridgeMethods>;
  /** Issues the request now (once). */
  start(): void;
  /** How many `diff_entries` requests are held (in flight or inside their window). */
  diffEntryCount(): number;
}

const isEmptyQuery = (q: unknown) =>
  q === undefined || q === null || (typeof q === 'object' && !Array.isArray(q) && Object.keys(q as object).length === 0);

export function createRoutePrefetch(
  base: RpcImpl<BridgeMethods>,
  path: string,
  opts: { ttlMs?: number; now?: () => number } = {},
): RoutePrefetch {
  const ttlMs = opts.ttlMs ?? PREFETCH_TTL_MS;
  const now = opts.now ?? (() => performance.now());
  let pending: Promise<GetResult> | undefined;
  let settledAt: number | undefined;
  let failed = false;
  let dropped = false;

  const fresh = () => pending !== undefined && !dropped && !failed && (settledAt === undefined || now() - settledAt <= ttlMs);

  const impl = { ...base } as RpcImpl<BridgeMethods>;
  for (const name of Object.keys(base) as (keyof BridgeMethods)[]) {
    if (READS.has(name)) continue;
    const method = base[name] as (...args: unknown[]) => unknown;
    (impl as Record<string, unknown>)[name] = (...args: unknown[]) => {
      dropped = true;
      return method(...args);
    };
  }
  /** In-flight and recent `diff_entries` requests by path + raw query. */
  interface DiffEntry {
    promise: Promise<GetResult>;
    startedAt: number;
    settledAt?: number;
    timer?: ReturnType<typeof setTimeout>;
  }
  const diffs = new Map<string, DiffEntry>();
  const usable = (e: DiffEntry) => (e.settledAt === undefined ? now() - e.startedAt <= RPC_TIMEOUT_MS : now() - e.settledAt <= ttlMs);
  const shareDiffs = (p: string, query: unknown, o: unknown): Promise<GetResult> | undefined => {
    const raw = (query as { raw?: unknown } | null | undefined)?.raw;
    if (!p.endsWith('/page_data/diff_entries') || typeof raw !== 'string' || !/(^|&)range=[0-9a-f.]+(&|$)/.test(raw) || o !== undefined) {
      return undefined;
    }
    const key = `${p}?${raw}`;
    const hit = diffs.get(key);
    if (hit && usable(hit)) return hit.promise;
    if (hit) clearTimeout(hit.timer);
    const entry: DiffEntry = { promise: Promise.resolve(base.get(p, query as Parameters<BridgeMethods['get']>[1])), startedAt: now() };
    diffs.set(key, entry);
    /** Deletes `entry` after `ms`, unless a newer entry has replaced it. */
    const expireIn = (ms: number) => {
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        if (diffs.get(key) === entry) diffs.delete(key);
      }, ms);
    };
    expireIn(RPC_TIMEOUT_MS);
    entry.promise.then(
      () => {
        entry.settledAt = now();
        if (diffs.get(key) === entry) expireIn(ttlMs);
      },
      () => {
        clearTimeout(entry.timer);
        if (diffs.get(key) === entry) diffs.delete(key);
      },
    );
    return entry.promise;
  };

  impl.get = (p, query, o) => {
    const sharedDiff = shareDiffs(p, query, o);
    if (sharedDiff) return sharedDiff;
    const opts = o as { dataRouter?: unknown; prefetched?: unknown } | undefined;
    const served = p === path && isEmptyQuery(query) && opts?.dataRouter === true && opts.prefetched === true;
    // The network request never carries `prefetched` (it only selects this cache).
    const forward = opts?.prefetched !== undefined ? { dataRouter: opts.dataRouter === true } : o;
    if (served && fresh()) return pending!.catch(() => base.get(p, query, forward));
    return base.get(p, query, forward);
  };

  return {
    impl,
    diffEntryCount: () => diffs.size,
    start() {
      if (pending) return;
      const request = Promise.resolve(base.get(path, {}, { dataRouter: true }));
      pending = request;
      request.then(
        () => (settledAt = now()),
        () => {
          settledAt = now();
          failed = true;
        },
      );
    },
  };
}

/**
 * Calls `start` once GitHub's `<head>` has been parsed (`<body>` exists, or the document is past `loading`): the
 * request headers come from its meta tags. For document_start scripts.
 */
export function startWhenHeadReady(doc: Document, start: () => void): void {
  const ready = () => doc.readyState !== 'loading' || doc.body !== null;
  if (ready()) return start();
  const observer = new MutationObserver(() => {
    if (!ready()) return;
    observer.disconnect();
    start();
  });
  observer.observe(doc, { childList: true, subtree: true });
  doc.addEventListener(
    'DOMContentLoaded',
    () => {
      observer.disconnect();
      start();
    },
    { once: true },
  );
}
