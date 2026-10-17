/**
 * Read client for GitHub's private pull-request endpoints, called through the MAIN-world bridge
 * (src/page/bridge.ts). Endpoint shapes: research/github-internal-endpoints.md (R§1 reading, R§2 threads).
 * Verified against dangh/pierre-sandbox#1 (fixtures in tests/fixtures/sandbox, scripts/capture-fixtures.mjs).
 */
import type { PrRef } from '../../shared/pr-url';
import { BridgeError, diffEntriesRaw, sortSuggestionComments, type BridgeMethods, type BridgeQuery, type Json, type RpcClient } from '../../shared/rpc';

/** The part of the RPC client this module needs (a fake in tests). */
export type Rpc = Pick<RpcClient<BridgeMethods>, 'call'>;

// ---------------------------------------------------------------------------------------------------------
// Public types

export interface CommitInfo {
  oid: string;
  shortOid: string;
  message: string;
}

export interface FileSummary {
  path: string;
  /**
   * Old path of a rename. Known up front only for files embedded in the route's `diffContents`;
   * otherwise undefined until `applyDiffEntry` with the file's `DiffEntry` (the tree shows the rename
   * once the entry has loaded).
   */
  prevPath?: string;
  digest: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  viewed: boolean;
  tooLarge: boolean;
  binary: boolean;
}

export interface PrData {
  ref: PrRef;
  nodeId?: string;
  /** `pullRequest.id` (database id), for `/preview` (`issue`, `project`). */
  databaseId?: number;
  /** `repository.id`, for `/preview`. */
  repositoryId?: number;
  /** Comments in the viewer's pending review, when the route says one exists (`viewerPendingReview`). */
  pendingReviewComments?: number;
  /** PR author login (Ruling 2). */
  author: string;
  baseOid: string;
  headOid: string;
  commits: CommitInfo[];
  files: FileSummary[];
  viewer: { login: string; canApplySuggestion: boolean; canReview: boolean };
  /** Thread data embedded in the route; pass to `fetchThreads(rpc, ref, {markers})` to skip a route refetch. */
  threadMarkers: ThreadMarkers;
}

/** The route's embedded thread data (R§1.1). */
export interface ThreadMarkers {
  /** `markers.threads` (first `reviewThreadsLimit` threads, with comments). */
  threads: GithubThread[];
  /** `diffSummaries[].markersMap`, keyed by file path (files without markers omitted). */
  byPath: Record<string, Record<string, GithubMarker>>;
}

export type GithubDiffLineType = 'HUNK' | 'CONTEXT' | 'ADDITION' | 'DELETION' | 'INJECTED_CONTEXT';

/**
 * One row of `diffLines` / `diffEntryLines` (R§1.2). `text` starts with a marker character:
 * `+` ADDITION, `-` DELETION, ` ` CONTEXT, `~` INJECTED_CONTEXT; HUNK rows carry the `@@ … @@` header.
 * `left`/`right` are old/new line numbers (only the side matching the type is meaningful; `right` is
 * null on the HUNK of a deleted file). `html` is GitHub's syntax-highlighted, HTML-escaped line.
 */
export interface GithubDiffLine {
  type: GithubDiffLineType;
  text: string;
  html: string;
  left: number | null;
  right: number | null;
  blobLineNumber?: number;
  position?: number;
  displayNoNewLineWarning?: boolean;
}

/** One `diff_entries` result, reduced to what the viewer needs. */
export interface DiffEntry {
  path: string;
  /** `oldTreeEntry.path` when it differs from `path` (renames). */
  prevPath?: string;
  /** `isBinary`. */
  binary: boolean;
  /** `isTooBig` (GitHub returns such files with empty lines; "Load diff" = `loadEntryLines`). */
  tooLarge: boolean;
  /**
   * Collapsed entry: empty lines although lines changed, neither binary nor too large (GitHub does this
   * for deleted files). Its lines are NOT fetched by `fetchDiffEntries`; load them with
   * `loadEntryLines` (on demand or lazily, under the caller's in-flight limit).
   */
  needsLines: boolean;
  /** `linesAdded` / `linesDeleted` for the requested `w`/`range`. */
  additions: number;
  deletions: number;
  lines: GithubDiffLine[];
}

export interface DiffOptions {
  /** GitHub's `w` flag: true sends `w=1` (hide whitespace changes), false sends `w=0`. */
  whitespace: boolean;
  /** The PR head shown (`PrData.headOid`): the `range` sent when `range` is omitted, as GitHub's client does. */
  headOid: string;
  /** GitHub's `range` param (R§1.2): `<headOid>` (PR base..head) or `<baseOid>..<headOid>`. Defaults to `headOid`. */
  range?: string;
}

// Raw GitHub payloads (only the fields this module reads are typed).

/** `diffSummaries[].markersMap[key]`. Keys are `R<line>`, `L<line>` or `FILE` (R§1.1). */
export interface GithubMarker {
  /** `start` (e.g. `"R8"`) is present on multi-line threads. */
  threads: { id: number | string; start?: string }[];
  annotations?: unknown[];
  ctx?: number[];
}

export interface GithubReactionGroup {
  reaction: { content: string; viewerHasReacted: boolean };
  totalCount: number;
}

export interface GithubComment {
  id: string;
  relayId?: string;
  databaseId: number;
  author: { login: string; avatarUrl: string } | null;
  body: string;
  bodyHTML: string;
  bodyVersion: string;
  createdAt: string;
  state: string;
  reactionGroups?: GithubReactionGroup[];
  viewerCanUpdate?: boolean;
  viewerCanDelete?: boolean;
  /** `https://github.com/<o>/<r>/pull/<n>#discussion_r<databaseId>`. */
  url?: string;
}

/** Thread from the route's `markers.threads` or `page_data/threads` (no positioning). */
export interface GithubThread {
  /** Numeric string: the thread database id. */
  id: string;
  subjectType: 'LINE' | 'FILE' | string;
  isResolved: boolean;
  viewerCanReply: boolean;
  commentsData?: { comments: GithubComment[] };
}

export type GithubDiffSide = 'LEFT' | 'RIGHT';

/** `page_data/thread_previews` item (positioned, R§2). */
export interface GithubThreadPreview {
  id: string;
  isOutdated: boolean;
  path: string;
  subject?: {
    startLine?: number | null;
    endLine?: number | null;
    startDiffSide?: GithubDiffSide | null;
    endDiffSide?: GithubDiffSide | null;
    originalStartLine?: number | null;
    originalEndLine?: number | null;
  } | null;
  diffSide?: GithubDiffSide | null;
  subjectType?: 'LINE' | 'FILE' | string;
  line?: number | null;
  startLine?: number | null;
  startDiffSide?: GithubDiffSide | null;
  commentsData?: { comments: GithubComment[] };
}

/** `page_data/thread_preview_positioning` value (proto-JSON; absent keys mean unset). */
export interface GithubThreadPositioning {
  path?: string;
  commitOid?: string;
  isOutdated?: boolean;
  endLine?: number | null;
  endDiffSide?: GithubDiffSide | null;
  startLine?: number | null;
  startDiffSide?: GithubDiffSide | null;
}

/** Everything needed to position threads; see `toThreadModels` in threads.ts. */
export interface RawThreads {
  /** Route `markers.threads` merged with every `page_data/threads` page (the latter wins), one per id. */
  threads: GithubThread[];
  /** Route `diffSummaries[].markersMap`, keyed by file path (files without markers omitted). */
  markers: Record<string, Record<string, GithubMarker>>;
  /** `page_data/thread_previews`. */
  previews: GithubThreadPreview[];
  /** `page_data/thread_preview_positioning` for threads with neither a marker nor a preview, by id. */
  positioning: Record<string, GithubThreadPositioning>;
}

interface GithubDiffSummary {
  path: string;
  pathDigest: string;
  changeType: string;
  linesAdded: number;
  linesDeleted: number;
  markedAsViewed: boolean;
  markersMap?: Record<string, GithubMarker>;
}

interface GithubDiffEntry {
  path: string;
  isBinary?: boolean;
  isTooBig?: boolean;
  diffLines?: GithubDiffLine[];
  linesAdded?: number;
  linesDeleted?: number;
  oldTreeEntry?: { path: string } | null;
}

interface ChangesRoute {
  pullRequest: {
    id?: number;
    globalRelayId?: string;
    author?: { login: string } | null;
    comparison?: { baseOid: string; headOid: string };
  };
  repository?: { id?: number };
  viewerPendingReview?: { id?: number | string | null; comments?: unknown[] } | null;
  comparison?: { fullDiff?: { baseOid: string; headOid: string } };
  commits?: { oid: string; shortOid: string; messageHeadline: string }[];
  user: { currentUserLogin: string; canApplySuggestion?: boolean; canComment?: boolean };
  diffSummaries: GithubDiffSummary[];
  diffContents?: GithubDiffEntry[];
  markers?: { threads?: Record<string, GithubThread> };
}

// ---------------------------------------------------------------------------------------------------------
// Limits

/** At most this many paths per `diff_entries` request. */
export const MAX_PATHS_PER_REQUEST = 20;
/** At most this many characters in the encoded `paths` value (GitHub answers 414 above ~8 KB of URL). */
export const MAX_PATHS_QUERY_LENGTH = 6000;
/** At most this many `diff_entries` requests in flight. */
export const MAX_IN_FLIGHT = 6;
/** `thread_preview_positioning` ids per request (GitHub's UI pages 40 at a time). */
const POSITIONING_BATCH = 40;
const MAX_THREAD_PAGES = 100;

// ---------------------------------------------------------------------------------------------------------
// Helpers

const prPath = (ref: PrRef) => `/${ref.owner}/${ref.repo}/pull/${ref.number}`;
const badPayload = (what: string) => new BridgeError({ status: 0, code: 'bad_payload', message: `Unexpected ${what} payload` });

async function fetchRoute(rpc: Rpc, ref: PrRef): Promise<ChangesRoute> {
  const { data } = await rpc.call('get', `${prPath(ref)}/changes`, {}, { dataRouter: true });
  const route = (data as { payload?: { pullRequestsChangesRoute?: ChangesRoute } } | null)?.payload?.pullRequestsChangesRoute;
  if (!route || !Array.isArray(route.diffSummaries) || !route.user) throw badPayload('route');
  return route;
}

function mapStatus(changeType: string): FileSummary['status'] {
  switch (changeType.toUpperCase().replace(/^CHANGE_TYPE_/, '')) {
    case 'ADDED':
    case 'COPIED':
      return 'added';
    case 'REMOVED':
    case 'DELETED':
      return 'deleted';
    case 'RENAMED':
      return 'renamed';
    default:
      return 'modified';
  }
}

function prevPathOf(entry: GithubDiffEntry): string | undefined {
  const old = entry.oldTreeEntry?.path;
  return old && old !== entry.path ? old : undefined;
}

function toDiffEntry(path: string, raw: GithubDiffEntry | undefined): DiffEntry {
  const prevPath = raw ? prevPathOf(raw) : undefined;
  return {
    path,
    ...(prevPath !== undefined ? { prevPath } : {}),
    binary: raw?.isBinary === true,
    tooLarge: raw?.isTooBig === true,
    additions: raw?.linesAdded ?? 0,
    deletions: raw?.linesDeleted ?? 0,
    lines: raw?.diffLines ?? [],
    needsLines: isCollapsed(raw),
  };
}

function isCollapsed(raw: GithubDiffEntry | undefined): boolean {
  if (!raw || raw.isBinary === true || raw.isTooBig === true) return false;
  return (raw.diffLines ?? []).length === 0 && (raw.linesAdded ?? 0) + (raw.linesDeleted ?? 0) > 0;
}

/**
 * Updates a summary with the explicit flags of its diff entry: `binary` = `isBinary`, `tooLarge` =
 * `isTooBig`, `prevPath` = `oldTreeEntry.path` (renames). Counts stay the summary's (full PR diff).
 */
export function applyDiffEntry(summary: FileSummary, entry: DiffEntry): FileSummary {
  return {
    ...summary,
    binary: entry.binary,
    tooLarge: entry.tooLarge,
    ...(entry.prevPath !== undefined ? { prevPath: entry.prevPath } : {}),
  };
}

/** Length of one path inside the `paths` value: `encodeURIComponent` twice (R§1.2). */
const encodedLength = (path: string) => encodeURIComponent(encodeURIComponent(path)).length;
/** The `,` separator after the second encoding. */
const SEPARATOR_LENGTH = '%2C'.length;

/**
 * Splits paths, in order, into `diff_entries` requests of at most `MAX_PATHS_PER_REQUEST` paths whose
 * encoded `paths` value stays within `MAX_PATHS_QUERY_LENGTH` characters. A single path longer than the
 * limit gets a request of its own.
 */
export function chunkPaths(paths: string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let length = 0;
  for (const path of paths) {
    const add = encodedLength(path) + (current.length > 0 ? SEPARATOR_LENGTH : 0);
    if (current.length > 0 && (current.length >= MAX_PATHS_PER_REQUEST || length + add > MAX_PATHS_QUERY_LENGTH)) {
      chunks.push(current);
      current = [];
      length = 0;
    }
    length += encodedLength(path) + (current.length > 0 ? SEPARATOR_LENGTH : 0);
    current.push(path);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Runs `fn` once more if it fails; the second failure propagates. */
async function retryOnce<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    return fn();
  }
}

/** Maps `items` with at most `limit` calls in flight; rejects on the first failure and starts nothing after it. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i]!);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const wFlag = (opts: DiffOptions) => (opts.whitespace ? '1' : '0');
const rangeOf = (opts: DiffOptions) => opts.range || opts.headOid;

// ---------------------------------------------------------------------------------------------------------
// Reading

/**
 * PR metadata and file list from the route JSON (`GET /o/r/pull/n/changes`, R§1.1). Field sources, all
 * under `payload.pullRequestsChangesRoute`:
 * - `nodeId`  ← `pullRequest.globalRelayId` ("PR_…")
 * - `author`  ← `pullRequest.author.login`
 * - `baseOid` ← `comparison.fullDiff.baseOid` (fallback `pullRequest.comparison.baseOid`)
 * - `headOid` ← `comparison.fullDiff.headOid` (fallback `pullRequest.comparison.headOid`)
 * - `commits` ← `commits[]`: `oid`, `shortOid`, `message` ← `messageHeadline` (only the headline is sent)
 * - `viewer.login` ← `user.currentUserLogin`; `viewer.canApplySuggestion` ← `user.canApplySuggestion`;
 *   `viewer.canReview` ← `user.canComment` (may comment / submit a COMMENT review; approve and request
 *   changes are further limited by `pullRequest.viewerAllowedNonCommentReviewTypes`)
 * - `files[]` ← `diffSummaries[]` in GitHub's order: `path`, `digest` ← `pathDigest` (sha256 of the path),
 *   `status` ← `changeType` (ADDED/COPIED → added, REMOVED/DELETED → deleted, RENAMED → renamed, else
 *   modified), `additions` ← `linesAdded`, `deletions` ← `linesDeleted`, `viewed` ← `markedAsViewed`.
 *   `binary` ← `isBinary` and `tooLarge` ← `isTooBig` of the file's entry in `diffContents[]` (only the
 *   first few files are embedded; the rest stay false until `applyDiffEntry` with the entry from
 *   `fetchDiffEntries`). `prevPath` ← `oldTreeEntry.path` of the file's entry in `diffContents[]`:
 *   summaries do not carry the old path, so for other renamed files it stays undefined until
 *   `applyDiffEntry` (no extra request here).
 * - `threadMarkers` ← `markers.threads` and `diffSummaries[].markersMap` (for `fetchThreads`).
 * One request: the route JSON.
 */
export async function fetchPrData(rpc: Rpc, ref: PrRef): Promise<PrData> {
  const route = await fetchRoute(rpc, ref);
  const embedded = new Map((route.diffContents ?? []).map((e) => [e.path, e]));

  const files = route.diffSummaries.map((s): FileSummary => {
    const entry = embedded.get(s.path);
    const prevPath = entry ? prevPathOf(entry) : undefined;
    return {
      path: s.path,
      ...(prevPath !== undefined ? { prevPath } : {}),
      digest: s.pathDigest,
      status: mapStatus(s.changeType),
      additions: s.linesAdded,
      deletions: s.linesDeleted,
      viewed: s.markedAsViewed === true,
      tooLarge: entry?.isTooBig === true,
      binary: entry?.isBinary === true,
    };
  });

  const full = route.comparison?.fullDiff ?? route.pullRequest.comparison;
  if (!full) throw badPayload('route comparison');
  return {
    ref,
    ...(route.pullRequest.globalRelayId ? { nodeId: route.pullRequest.globalRelayId } : {}),
    ...(typeof route.pullRequest.id === 'number' ? { databaseId: route.pullRequest.id } : {}),
    ...(typeof route.repository?.id === 'number' ? { repositoryId: route.repository.id } : {}),
    ...(route.viewerPendingReview?.id != null ? { pendingReviewComments: route.viewerPendingReview.comments?.length ?? 0 } : {}),
    author: route.pullRequest.author?.login ?? '',
    baseOid: full.baseOid,
    headOid: full.headOid,
    commits: (route.commits ?? []).map((c) => ({ oid: c.oid, shortOid: c.shortOid, message: c.messageHeadline })),
    files,
    viewer: {
      login: route.user.currentUserLogin,
      canApplySuggestion: route.user.canApplySuggestion === true,
      canReview: route.user.canComment === true,
    },
    threadMarkers: markersOf(route),
  };
}

function markersOf(route: ChangesRoute): ThreadMarkers {
  const byPath: ThreadMarkers['byPath'] = {};
  for (const s of route.diffSummaries) {
    if (s.markersMap && Object.keys(s.markersMap).length > 0) byPath[s.path] = s.markersMap;
  }
  return { threads: Object.values(route.markers?.threads ?? {}), byPath };
}

/**
 * `GET page_data/diff_entries` for `paths` (R§1.2), keyed by the exact requested paths, in request order.
 * Every requested path is present (paths GitHub omits, i.e. without changes in that range, get an empty
 * entry). Requests are chunked (`chunkPaths`), at most `MAX_IN_FLIGHT` at a time; a failed chunk is
 * retried once, then the whole call rejects (never a partial map). One request per chunk, nothing else:
 * collapsed entries (`needsLines`, e.g. deleted files) and too-large entries keep empty lines; load
 * them with `loadEntryLines`.
 */
export async function fetchDiffEntries(rpc: Rpc, ref: PrRef, paths: string[], opts: DiffOptions): Promise<Map<string, DiffEntry>> {
  const path = `${prPath(ref)}/page_data/diff_entries`;
  const extra: Record<string, string> = { w: wFlag(opts), range: rangeOf(opts) };

  const chunkResults = await mapLimit(chunkPaths(paths), MAX_IN_FLIGHT, (chunk) =>
    retryOnce(async () => {
      const { data } = await rpc.call('get', path, { raw: diffEntriesRaw(chunk, extra) });
      if (!Array.isArray(data)) throw badPayload('diff_entries');
      const byPath = new Map<string, GithubDiffEntry>();
      for (const e of data as unknown as GithubDiffEntry[]) {
        byPath.set(e.path, e);
        byPath.set(e.path.normalize('NFC'), e);
      }
      return chunk.map((p) => toDiffEntry(p, byPath.get(p) ?? byPath.get(p.normalize('NFC'))));
    }),
  );

  const result = new Map<string, DiffEntry>();
  for (const entries of chunkResults) for (const e of entries) result.set(e.path, e);
  return result;
}

/**
 * The full lines of one entry (`diff_entry_lines` without ranges, retried once): the on-demand load
 * for `needsLines` (collapsed, e.g. deleted) entries and the "Load diff" of `tooLarge` ones. Returns
 * the entry with `lines` filled and `needsLines: false`. GitHub may still return no lines for a
 * too-large file ("Diff is too big to render").
 */
export async function loadEntryLines(rpc: Rpc, ref: PrRef, entry: DiffEntry, opts: DiffOptions): Promise<DiffEntry> {
  const lines = await retryOnce(() => fetchDiffEntryLines(rpc, ref, entry.path, opts));
  return { ...entry, lines, needsLines: false };
}

/**
 * Diff lines per path; see `fetchDiffEntries` for batching, retry and completeness rules. Collapsed
 * and too-large files map to `[]` here: use `fetchDiffEntries` to see their flags.
 */
export async function fetchDiffs(rpc: Rpc, ref: PrRef, paths: string[], opts: DiffOptions): Promise<Map<string, GithubDiffLine[]>> {
  const entries = await fetchDiffEntries(rpc, ref, paths, opts);
  return new Map([...entries].map(([p, e]) => [p, e.lines]));
}

/**
 * `GET page_data/diff_entry_lines` (R§1.3): the whole diff of one file, with `contextRanges` injected as
 * INJECTED_CONTEXT rows. With no ranges this is the "Load diff" request for too-large and collapsed files.
 */
export async function fetchDiffEntryLines(
  rpc: Rpc,
  ref: PrRef,
  path: string,
  opts: DiffOptions & { contextRanges?: { start: number; end: number }[] },
): Promise<GithubDiffLine[]> {
  const query: Record<string, string | string[]> = { path, w: wFlag(opts), range: rangeOf(opts) };
  if (opts.contextRanges?.length) {
    query['context_line_ranges[]'] = opts.contextRanges.map((r) => JSON.stringify({ start: r.start, end: r.end }));
  }
  const { data } = await rpc.call('get', `${prPath(ref)}/page_data/diff_entry_lines`, query);
  const lines = (data as { diffEntryLines?: GithubDiffLine[] } | null)?.diffEntryLines;
  if (!Array.isArray(lines)) throw badPayload('diff_entry_lines');
  return lines;
}

/**
 * Full file contents at `oid` via `https://github.com/<o>/<r>/raw/<oid>/<path>` (R§1.4), each path
 * segment percent-encoded. Verified on the private sandbox: the redirect to raw.githubusercontent.com
 * is readable from the page.
 */
export function fetchFullFile(rpc: Rpc, ref: PrRef, path: string, oid: string): Promise<string> {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return rpc.call('getText', `https://github.com/${ref.owner}/${ref.repo}/raw/${oid}/${encoded}`);
}

/**
 * The query of the `rel="next"` link in a `Link` header, only if it points at `expectedPath` on
 * github.com (anything else is ignored). Returns null when there is no next page.
 */
export function nextLink(link: string | null, expectedPath: string): string | null {
  if (!link) return null;
  for (const m of link.matchAll(/<([^>]*)>((?:\s*;\s*[^;,]*)*)/g)) {
    if (!/;\s*rel\s*=\s*"?(?:[^"]*\s)?next(?:\s[^"]*)?"?/i.test(m[2] ?? '')) continue;
    let url: URL;
    try {
      url = new URL(m[1]!, 'https://github.com');
    } catch {
      return null;
    }
    if (url.origin !== 'https://github.com' || url.pathname !== expectedPath) return null;
    return url.search.slice(1) || null;
  }
  return null;
}

async function fetchThreadPages(rpc: Rpc, path: string): Promise<GithubThread[]> {
  const threads: GithubThread[] = [];
  const seen = new Set<string>();
  let query: BridgeQuery | undefined;
  for (let page = 0; page < MAX_THREAD_PAGES; page++) {
    const { data, link } = query === undefined ? await rpc.call('get', path) : await rpc.call('get', path, query);
    const list = (data as { threads?: GithubThread[] } | null)?.threads;
    if (!Array.isArray(list)) throw badPayload('threads');
    threads.push(...list);
    const next = nextLink(link, path);
    if (!next || seen.has(next)) break;
    seen.add(next);
    query = { raw: next };
  }
  return threads;
}

/**
 * All review threads of the PR (R§2): the route's embedded `markers.threads` and per-file `markersMap`,
 * every page of `page_data/threads` (following the `Link: rel="next"` header), and
 * `page_data/thread_previews`. Threads that have neither a marker nor a preview are positioned with
 * `page_data/thread_preview_positioning` (40 ids per request). Pass `opts.markers` (`PrData.threadMarkers`)
 * to reuse an already-fetched route; without it the route is fetched again.
 */
export async function fetchThreads(rpc: Rpc, ref: PrRef, opts: { markers?: ThreadMarkers } = {}): Promise<RawThreads> {
  const base = prPath(ref);
  const [embedded, pages, previewsRes] = await Promise.all([
    opts.markers ?? fetchRoute(rpc, ref).then(markersOf),
    fetchThreadPages(rpc, `${base}/page_data/threads`),
    rpc.call('get', `${base}/page_data/thread_previews`),
  ]);

  const byId = new Map<string, GithubThread>();
  for (const t of embedded.threads) byId.set(String(t.id), t);
  for (const t of pages) byId.set(String(t.id), t);

  const markers: RawThreads['markers'] = embedded.byPath;
  const located = new Set<string>();
  for (const map of Object.values(markers)) {
    for (const marker of Object.values(map)) for (const t of marker.threads ?? []) located.add(String(t.id));
  }

  const previews = Array.isArray(previewsRes.data) ? (previewsRes.data as unknown as GithubThreadPreview[]) : [];
  for (const p of previews) located.add(String(p.id));

  const positioning: RawThreads['positioning'] = {};
  const missing = [...byId.keys()].filter((id) => !located.has(id) && /^\d+$/.test(id));
  for (let i = 0; i < missing.length; i += POSITIONING_BATCH) {
    const ids = missing.slice(i, i + POSITIONING_BATCH);
    const { data } = await rpc.call('get', `${base}/page_data/thread_preview_positioning`, { raw: `thread_ids=${ids.join(',')}` });
    Object.assign(positioning, (data as { threads?: Record<string, GithubThreadPositioning> } | null)?.threads ?? {});
  }

  return { threads: [...byId.values()], markers, previews, positioning };
}

// ---------------------------------------------------------------------------------------------------------
// Writing (the one session write of the spec, plus the session fallbacks of Ruling 13)

export interface ApplySuggestionsParams {
  /** `id` = comment database id; `suggestionIndex` = the block (0-based), required by GitHub even for one block. */
  comments: { id: number; suggestionIndex: number }[];
  message: string;
  /** The PR head the suggestions were made against; GitHub answers 409 `HEAD_OID_MISMATCH` when it moved. */
  expectedHeadOid: string;
}

/**
 * Commits suggestions with the user's GitHub session (R§5): `POST page_data/apply_review_suggestions` through the
 * bridge, `Idempotency-Key: idempotencyKey`. Comments are sent sorted by (id, suggestionIndex), as GitHub's client does.
 */
export function applySuggestions(rpc: Rpc, ref: PrRef, params: ApplySuggestionsParams, idempotencyKey: string): Promise<Json> {
  return rpc.call(
    'applySuggestions',
    {
      owner: ref.owner,
      repo: ref.repo,
      number: ref.number,
      comments: sortSuggestionComments(params.comments),
      message: params.message,
      expectedHeadOid: params.expectedHeadOid,
    },
    idempotencyKey,
  );
}
