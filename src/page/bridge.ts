/**
 * MAIN-world bridge. Runs in github.com's own JS world so its requests carry GitHub's cookies and the
 * same headers GitHub's client sends (R§0.1). It serves a small, allowlisted set of requests to the
 * viewer iframe over a MessagePort; nothing else on github.com is reachable through it.
 *
 * Handshake (see also src/content/host.ts):
 * - The content script posts `{type: 'pierre:bridge-port'}` with exactly one transferred port. It is
 *   accepted only from a `message` event whose `source` is this window and whose `origin` is
 *   `location.origin`. While a port is active further `pierre:bridge-port` messages are ignored, until
 *   `{type: 'pierre:bridge-reset'}` arrives (the old port is then closed and the next one accepted).
 * - Once listening, the bridge posts `{type: 'pierre:bridge-ready'}` so a content script that mounted
 *   first can re-send its port. All posts use `location.origin` as the target, never '*'.
 */
import {
  serveRpc,
  sortSuggestionComments,
  type ApplySuggestionsBody,
  type BridgeErrorPayload,
  type BridgeMethods,
  type BridgeQuery,
  type Json,
  type PreviewContext,
  type RpcImpl,
} from '../shared/rpc';

const NAME = '[A-Za-z0-9_.-]+';
const GET_PATH = new RegExp(
  `^/(${NAME})/(${NAME})/pull/\\d+(/changes|/page_data/(diff_entries|diff_entry_lines|threads|thread_previews|thread_preview_positioning|review_menu|header))?$`,
);
const RAW_PATH = new RegExp(`^/(${NAME})/(${NAME})/raw/[0-9a-f]{7,64}/.*[^/]$`);
const NAME_ONLY = new RegExp(`^${NAME}$`);
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{1,128}$/;
const THREAD_ID = /^\d+$/;
const OID = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const DOT_NAMES = new Set(['.', '..']);
/** Longest repo file path accepted by `markViewed` / `unmarkViewed`. */
const MAX_FILE_PATH = 4096;

const notAllowed = (message: string): BridgeErrorPayload => ({ status: 0, code: 'not_allowed', message });
const badRequest = (message: string): BridgeErrorPayload => ({ status: 0, code: 'bad_request', message });

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isPosInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const isName = (v: unknown): v is string => typeof v === 'string' && NAME_ONLY.test(v) && !DOT_NAMES.has(v);

/**
 * Headers GitHub's own client sends (R§0.1), minus Accept/Content-Type, which depend on the request.
 * The nonce and client version are read from the current `<meta>` tags on EVERY call: GitHub rotates
 * the nonce, and a stale value makes writes fail. A header whose meta tag is missing is omitted.
 */
export function githubHeaders(doc: Document): Record<string, string> {
  const meta = (name: string) => doc.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content;
  const nonce = meta('fetch-nonce');
  const release = meta('release');
  return {
    'GitHub-Verified-Fetch': 'true',
    'X-Requested-With': 'XMLHttpRequest',
    ...(nonce ? { 'X-Fetch-Nonce': nonce } : {}),
    ...(release ? { 'X-GitHub-Client-Version': release } : {}),
    'GitHub-Is-React': 'true',
  };
}

export interface BridgeDeps {
  doc?: Document;
  /** Defaults to the page's global `fetch`, resolved at call time (so GitHub's own fetch wrapper applies). */
  fetch?: typeof fetch;
}

/** The request, mapping transport failures to `{status: 0, code: 'network'}`. */
async function send(deps: BridgeDeps, url: string, init: RequestInit): Promise<Response> {
  try {
    return await (deps.fetch ?? fetch)(url, init);
  } catch (err) {
    throw { status: 0, code: 'network', message: err instanceof Error ? err.message : 'Network error' } satisfies BridgeErrorPayload;
  }
}

/** Builds `{status, code?, message}` from a non-2xx response, using GitHub's JSON error when present. */
async function errorFrom(res: Response): Promise<BridgeErrorPayload> {
  let body: unknown;
  try {
    body = JSON.parse(await res.text());
  } catch {
    body = undefined; // 5xx responses may be HTML
  }
  const o = isObject(body) ? body : {};
  const message = typeof o.error === 'string' ? o.error : typeof o.message === 'string' ? o.message : `HTTP ${res.status}`;
  return { status: res.status, ...(typeof o.code === 'string' ? { code: o.code } : {}), message };
}

async function readJson(res: Response): Promise<Json> {
  const text = await res.text();
  if (text.trim() === '') return null;
  try {
    return JSON.parse(text) as Json;
  } catch {
    throw { status: res.status, code: 'bad_json', message: 'Response was not valid JSON' } satisfies BridgeErrorPayload;
  }
}

function buildQuery(query: unknown): string {
  if (query === undefined || query === null) return '';
  if (!isObject(query) || Array.isArray(query)) throw badRequest('query must be an object');
  if (typeof query.raw === 'string') {
    if (/[#\r\n\t]/.test(query.raw)) throw badRequest('raw query must not contain "#" or line breaks');
    return query.raw;
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (typeof v !== 'string') throw badRequest(`query value for "${key}" must be a string or string[]`);
      params.append(key, v);
    }
  }
  return params.toString();
}

function checkGetPath(path: unknown): string {
  const m = typeof path === 'string' ? GET_PATH.exec(path) : null;
  if (!m || DOT_NAMES.has(m[1]!) || DOT_NAMES.has(m[2]!)) throw notAllowed('Path is not allowlisted');
  return path as string;
}

/** Only `https://github.com/<o>/<r>/raw/<sha>/<file>`; the URL is normalized before checking. */
function checkRawUrl(input: unknown): string {
  let u: URL;
  try {
    u = new URL(String(input));
  } catch {
    throw notAllowed('Not an absolute URL');
  }
  const m = RAW_PATH.exec(u.pathname);
  if (
    typeof input !== 'string' ||
    u.protocol !== 'https:' || u.host !== 'github.com' || u.username || u.password ||
    u.search || u.hash || !m || DOT_NAMES.has(m[1]!) || DOT_NAMES.has(m[2]!)
  ) {
    throw notAllowed('URL is not an allowlisted raw file URL');
  }
  return u.href;
}

function previewForm(text: unknown, ctx: unknown): FormData {
  if (typeof text !== 'string') throw badRequest('text must be a string');
  if (!isObject(ctx) || !isName(ctx.owner) || !isName(ctx.repo)) throw notAllowed('Invalid repository');
  const c = ctx as unknown as PreviewContext;
  const form = new FormData();
  form.append('text', text);
  const field = (name: string, value: unknown) => {
    if (value === undefined) return;
    if (typeof value !== 'string' && typeof value !== 'number') throw badRequest(`${name} must be a string or number`);
    form.append(name, String(value));
  };
  field('issue', c.issueId);
  field('project', c.issueId);
  field('repository', c.repositoryId);
  if (c.number !== undefined || c.issueId !== undefined) form.append('subject_type', 'PullRequest');
  field('subject', c.number);
  field('path', c.path);
  field('line_number', c.line);
  field('start_line_number', c.startLine);
  field('start_commit_oid', c.baseOid);
  field('base_commit_oid', c.baseOid);
  field('end_commit_oid', c.headOid);
  return form;
}

function applyRequest(body: unknown, key: unknown): { path: string; json: string } {
  if (typeof key !== 'string' || !IDEMPOTENCY_KEY.test(key)) throw badRequest('Invalid idempotency key');
  if (!isObject(body)) throw badRequest('Invalid body');
  const b = body as Partial<ApplySuggestionsBody> & Record<string, unknown>;
  if (!isName(b.owner) || !isName(b.repo) || !isPosInt(b.number)) throw badRequest('Invalid pull request');
  const comments = b.comments;
  if (
    !Array.isArray(comments) || comments.length === 0 ||
    !comments.every(
      (c) => isObject(c) && isPosInt(c.id) &&
        (c.suggestionIndex === undefined || (Number.isSafeInteger(c.suggestionIndex) && (c.suggestionIndex as number) >= 0)),
    )
  ) {
    throw badRequest('comments must be a non-empty list of {id, suggestionIndex?}');
  }
  if (typeof b.message !== 'string') throw badRequest('message must be a string');
  if (typeof b.expectedHeadOid !== 'string' || !OID.test(b.expectedHeadOid)) throw badRequest('expectedHeadOid must be a commit sha');
  const rebuilt = comments.map((c) => ({ id: c.id as number, ...(c.suggestionIndex !== undefined ? { suggestionIndex: c.suggestionIndex as number } : {}) }));
  return {
    path: `/${b.owner}/${b.repo}/pull/${b.number}/page_data/apply_review_suggestions`,
    json: JSON.stringify({
      comments: sortSuggestionComments(rebuilt),
      message: b.message,
      expectedHeadOid: b.expectedHeadOid,
    }),
  };
}

/** `page_data/resolve_thread` / `unresolve_thread`: path from validated parts, body rebuilt field by field. */
function threadRequest(endpoint: 'resolve_thread' | 'unresolve_thread', owner: unknown, repo: unknown, number: unknown, threadId: unknown) {
  if (!isName(owner) || !isName(repo) || !isPosInt(number)) throw badRequest('Invalid pull request');
  if (typeof threadId !== 'string' || !THREAD_ID.test(threadId)) throw badRequest('threadId must be a numeric thread id');
  return { path: `/${owner}/${repo}/pull/${number}/page_data/${endpoint}`, json: JSON.stringify({ threadId }) };
}

/**
 * `file_review` (R§3): path from validated parts; the file path goes verbatim into the JSON body, which is rebuilt
 * field by field exactly as GitHub's client sends it (`viewed: "viewed"` to mark, `_method: "delete"` to unmark).
 */
function fileReviewRequest(viewed: boolean, owner: unknown, repo: unknown, number: unknown, path: unknown) {
  if (!isName(owner) || !isName(repo) || !isPosInt(number)) throw badRequest('Invalid pull request');
  if (typeof path !== 'string' || path === '' || path.length > MAX_FILE_PATH || /[\0\r\n]/.test(path)) throw badRequest('Invalid file path');
  return {
    path: `/${owner}/${repo}/pull/${number}/file_review`,
    json: JSON.stringify(viewed ? { path, viewed: 'viewed' } : { path, _method: 'delete' }),
  };
}

/** How long one `waitForGitUpdate` waits before answering false (below the RPC timeout). */
export const GIT_UPDATE_WAIT_MS = 25_000;
/** Cap on GitHub's own per-message `wait` (its jitter before refetching, ~0.4 s seen). */
const MAX_GITHUB_WAIT_MS = 5_000;

/** A pull request's alive channel, subscribed GitHub's way, and the `waitForGitUpdate` calls waiting on it. */
interface Subscription {
  el: HTMLElement;
  waiting: Set<() => void>;
}

export function createBridgeImpl(deps: BridgeDeps = {}): RpcImpl<BridgeMethods> {
  const doc = () => deps.doc ?? document;
  const origin = () => doc().location.origin;
  const subscriptions = new Map<string, Promise<Subscription>>();

  /**
   * GitHub's live updates (R§1.5): `page_data/header` names the PR's alive channel (`aliveChannel`), and GitHub's page
   * script subscribes any `.js-socket-channel[data-channel]` element to it, dispatching `socket:message` on it.
   * `event_updates.git_updated` is the event GitHub's Files changed page shows its Refresh button for (a push);
   * comments only send `timeline_updated`.
   */
  async function subscribe(prPath: string): Promise<Subscription> {
    const header = (await getJson(`${prPath}/page_data/header`)) as { aliveChannel?: unknown } | null;
    const channel = header?.aliveChannel;
    if (typeof channel !== 'string' || channel === '') throw { status: 0, code: 'unsupported', message: 'GitHub sent no live update channel' } satisfies BridgeErrorPayload;
    const sub: Subscription = { el: doc().createElement('div'), waiting: new Set() };
    sub.el.className = 'js-socket-channel';
    sub.el.hidden = true;
    sub.el.dataset.channel = channel;
    sub.el.addEventListener('socket:message', (event) => {
      const data = (event as CustomEvent<{ data?: { event_updates?: { git_updated?: unknown }; wait?: unknown } } | null>).detail?.data;
      if (!data?.event_updates?.git_updated) return;
      const wait = typeof data.wait === 'number' ? Math.min(Math.max(data.wait, 0), MAX_GITHUB_WAIT_MS) : 0;
      setTimeout(() => {
        for (const wake of [...sub.waiting]) wake();
      }, wait);
    });
    return sub;
  }

  async function getJson(path: string): Promise<Json> {
    const headers = { ...githubHeaders(doc()), Accept: 'application/json' };
    const res = await send(deps, origin() + path, { method: 'GET', headers, credentials: 'same-origin' });
    if (!res.ok) throw await errorFrom(res);
    return readJson(res);
  }

  return {
    async get(path, query, opts) {
      const checked = checkGetPath(path);
      const q = buildQuery(query);
      const headers: Record<string, string> = { ...githubHeaders(doc()), Accept: 'application/json' };
      if (isObject(opts) && opts.dataRouter === true) headers['X-GitHub-App-Type'] = 'dataRouter';
      const res = await send(deps, origin() + checked + (q ? '?' + q : ''), { method: 'GET', headers, credentials: 'same-origin' });
      if (!res.ok) throw await errorFrom(res);
      return { data: await readJson(res), link: res.headers.get('Link') };
    },

    async getText(url) {
      // No custom headers: GitHub answers with a 302 to raw.githubusercontent.com, which must stay a CORS-simple request.
      const res = await send(deps, checkRawUrl(url), { method: 'GET', credentials: 'same-origin' });
      if (!res.ok) throw await errorFrom(res);
      return res.text();
    },

    async preview(text, context) {
      const body = previewForm(text, context);
      // multipart/form-data: no Content-Type (the browser adds the boundary) and no JSON Accept (R§6).
      const res = await send(deps, origin() + '/preview', { method: 'POST', headers: githubHeaders(doc()), body, credentials: 'same-origin' });
      if (!res.ok) throw await errorFrom(res);
      return res.text();
    },

    async applySuggestions(body, idempotencyKey) {
      const { path, json } = applyRequest(body, idempotencyKey);
      const headers = {
        ...githubHeaders(doc()),
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      };
      const res = await send(deps, origin() + path, { method: 'POST', headers, body: json, credentials: 'same-origin' });
      if (!res.ok) throw await errorFrom(res);
      return readJson(res);
    },

    async resolveThread(owner, repo, number, threadId) {
      return postJson(threadRequest('resolve_thread', owner, repo, number, threadId));
    },

    async unresolveThread(owner, repo, number, threadId) {
      return postJson(threadRequest('unresolve_thread', owner, repo, number, threadId));
    },

    async markViewed(owner, repo, number, path) {
      return postJson(fileReviewRequest(true, owner, repo, number, path));
    },

    async unmarkViewed(owner, repo, number, path) {
      return postJson(fileReviewRequest(false, owner, repo, number, path), 'DELETE');
    },

    async waitForGitUpdate(owner, repo, number) {
      if (!isName(owner) || !isName(repo) || !isPosInt(number)) throw badRequest('Invalid pull request');
      const prPath = `/${owner}/${repo}/pull/${number}`;
      let pending = subscriptions.get(prPath);
      if (!pending) {
        pending = subscribe(prPath);
        subscriptions.set(prPath, pending);
        // A failed subscription is not cached: the next call tries again.
        pending.catch(() => subscriptions.delete(prPath));
      }
      const sub = await pending;
      // GitHub may replace the body on a navigation; the element must be in the document to stay subscribed.
      if (!sub.el.isConnected) doc().body.append(sub.el);
      return new Promise<boolean>((resolve) => {
        const done = (updated: boolean) => {
          clearTimeout(timer);
          sub.waiting.delete(wake);
          resolve(updated);
        };
        const wake = () => done(true);
        const timer = setTimeout(() => done(false), GIT_UPDATE_WAIT_MS);
        sub.waiting.add(wake);
      });
    },
  };

  async function postJson({ path, json }: { path: string; json: string }, method: 'POST' | 'DELETE' = 'POST'): Promise<Json> {
    const headers = { ...githubHeaders(doc()), Accept: 'application/json', 'Content-Type': 'application/json' };
    const res = await send(deps, origin() + path, { method, headers, body: json, credentials: 'same-origin' });
    if (!res.ok) throw await errorFrom(res);
    return readJson(res);
  }
}

/** Starts the handshake listener on `win`. Returns a stop function that also closes any active port. */
export function startBridge(
  win: Window,
  deps: Omit<BridgeDeps, 'doc'> = {},
  impl: RpcImpl<BridgeMethods> = createBridgeImpl({ ...deps, doc: win.document }),
): () => void {
  let active: MessagePort | null = null;

  const release = () => {
    if (!active) return;
    active.onmessage = null;
    active.close();
    active = null;
  };

  const onMessage = (event: MessageEvent) => {
    if (event.source !== win || event.origin !== win.location.origin) return;
    const type = isObject(event.data) ? event.data.type : undefined;
    if (type === 'pierre:bridge-reset') {
      release();
    } else if (type === 'pierre:bridge-port') {
      if (active || event.ports.length !== 1) return;
      active = event.ports[0]!;
      serveRpc<BridgeMethods>(active, impl);
    }
  };

  win.addEventListener('message', onMessage);
  win.postMessage({ type: 'pierre:bridge-ready' }, win.location.origin);

  return () => {
    win.removeEventListener('message', onMessage);
    release();
  };
}
