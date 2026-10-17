/**
 * Route prefetch (Task 12, performance). Opening `…/pull/N#pierre` used to request GitHub's route JSON
 * (`GET /o/r/pull/N/changes`, ~1 s server time on large PRs) only once the viewer iframe had booted, i.e. after
 * GitHub's page load, and once more when GitHub's React app re-rendered the layout and the iframe was remounted.
 *
 * The bridge now starts at document_start and, on a `#pierre` PR URL, issues that request as soon as the page's
 * `<head>` is in (the request needs GitHub's meta tags), in parallel with GitHub's own page load. The viewer's
 * identical request (`get(<that path>, {}, {dataRouter: true})`) is answered from it while it is fresh:
 * - in flight, or settled less than `ttlMs` ago (default 10 s), so every viewer boot of this page load, including a
 *   remounted iframe, shares it; later reads (the freshness poll, reloads) go to the network as before;
 * - a failed prefetch is never served (the caller makes its own request, with its own error handling);
 * - any write through the bridge drops it, so nothing after a write can see the older route.
 */
import { isPierreActive, parsePrUrl } from '../shared/pr-url';
import type { BridgeMethods, RpcImpl } from '../shared/rpc';

export const PREFETCH_TTL_MS = 10_000;

/** Bridge methods that only read: everything else may change the PR and drops the prefetched route. */
const READS: ReadonlySet<keyof BridgeMethods> = new Set<keyof BridgeMethods>(['get', 'getText', 'preview']);

/** The route path to prefetch for `url`, or null when the URL is not a PR page showing Pierre. */
export function prefetchPath(url: string): string | null {
  const ref = parsePrUrl(url);
  if (!ref || !isPierreActive(url)) return null;
  return `/${ref.owner}/${ref.repo}/pull/${ref.number}/changes`;
}

type GetResult = Awaited<ReturnType<RpcImpl<BridgeMethods>['get']>>;

export interface RoutePrefetch {
  /** `impl` with `get(path, {}, {dataRouter: true})` served from the prefetch while it is fresh. */
  readonly impl: RpcImpl<BridgeMethods>;
  /** Issues the request now (once). */
  start(): void;
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
  impl.get = (p, query, o) => {
    const served = p === path && isEmptyQuery(query) && (o as { dataRouter?: unknown } | undefined)?.dataRouter === true;
    if (served && fresh()) return pending!.catch(() => base.get(p, query, o));
    return base.get(p, query, o);
  };

  return {
    impl,
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
