/**
 * Typed request/response RPC over a MessagePort, shared by the viewer (client side, extension origin)
 * and the MAIN-world bridge on github.com (server side).
 *
 * Handshake and port lifecycle (for the viewer, Task 7):
 * - The content script hands the viewer a port with `postMessage({type: 'pierre:port', colorMode}, extOrigin, [port])`.
 * - The viewer MUST accept a replacement `pierre:port` at ANY time, not only the first one. The content
 *   script re-creates the channel when the MAIN-world bridge announces itself after the viewer mounted
 *   (both scripts run at document_idle in unspecified order), and a re-created channel may arrive after
 *   the viewer already started calling. On each `pierre:port`: `oldClient.close()` (pending calls reject
 *   with code `closed`), then `createRpcClient(newPort)`, and retry or re-issue what failed.
 *
 * Wire format (internal, not a public contract):
 *   request:  {pierre: 'rpc', id, method, args}
 *   response: {pierre: 'rpc', id, ok: true, result} | {pierre: 'rpc', id, ok: false, error: {status, code?, message}}
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Error payload crossing the port. `status` is the HTTP status, or 0 when no HTTP response exists. */
export interface BridgeErrorPayload {
  status: number;
  code?: string;
  message: string;
}

export class BridgeError extends Error implements BridgeErrorPayload {
  readonly status: number;
  readonly code?: string;
  constructor(payload: BridgeErrorPayload) {
    super(payload.message);
    this.name = 'BridgeError';
    this.status = payload.status;
    if (payload.code !== undefined) this.code = payload.code;
  }
}

/** Body of `applySuggestions`. The bridge builds the URL from owner/repo/number and sends the rest as JSON. */
export interface ApplySuggestionsBody {
  owner: string;
  repo: string;
  /** Pull request number. */
  number: number;
  /**
   * `id` is the comment's `databaseId`; `suggestionIndex` picks the suggestion block (0-based). GitHub requires the
   * index (400 "requires a suggestion_index" without it), also when the comment has a single suggestion.
   */
  comments: { id: number; suggestionIndex?: number }[];
  /** Commit message. */
  message: string;
  /** Head commit the suggestions were made against; a moved head fails with 409 `HEAD_OID_MISMATCH`. */
  expectedHeadOid: string;
}

/**
 * Context for `preview`. Only owner/repo are required; the rest are the FormData fields GitHub's composer
 * sends (R§6) and let `suggestion` blocks render as diffs.
 */
export interface PreviewContext {
  owner: string;
  repo: string;
  /** `pullRequest.id` (database id): sent as both `issue` and `project`. */
  issueId?: number | string;
  /** `repository.id`. */
  repositoryId?: number | string;
  /** Pull request number (`subject`). */
  number?: number;
  path?: string;
  line?: number;
  startLine?: number;
  /** Sent as `start_commit_oid` and `base_commit_oid`. */
  baseOid?: string;
  /** Sent as `end_commit_oid`. */
  headOid?: string;
}

/** Query for `get`: URLSearchParams semantics (arrays repeat the key), or `{raw}` appended verbatim. */
export type BridgeQuery = Record<string, string | string[]> | { raw: string };

/**
 * Methods the MAIN-world bridge serves.
 *
 * NOTE for Task 5: `get` resolves to `{data, link}`, not the bare JSON. `link` is the response `Link`
 * header (null when absent); use it for `page_data/threads` pagination.
 *
 * `get(path, query)`: `path` must be one of the allowlisted pull-request paths (no query string).
 * `query` is encoded with URLSearchParams semantics, so a value is percent-encoded once. For
 * `diff_entries`, whose `paths` GitHub double-encodes, pass `{raw}` (build it with `diffEntriesRaw`):
 * the string is appended after `?` verbatim once checked to contain no `#` and no newline.
 * Anything not allowlisted rejects with `{status: 0, code: 'not_allowed'}`.
 */
export type BridgeMethods = {
  get(
    path: string,
    query?: BridgeQuery,
    opts?: { dataRouter?: boolean },
  ): { data: Json; link: string | null };
  getText(url: string): string;
  preview(text: string, context: PreviewContext): string /* html */;
  applySuggestions(body: ApplySuggestionsBody, idempotencyKey: string): Json;
  /**
   * Resolve / unresolve a review thread with the user's GitHub session (R§4.6): `POST page_data/resolve_thread`
   * (`unresolve_thread`) with `{threadId}`. `threadId` is the numeric thread id (`^\d+$`), not a `PRRT_` node id.
   * The session fallback when a token cannot do it (fine-grained tokens are refused `resolveReviewThread`).
   */
  resolveThread(owner: string, repo: string, number: number, threadId: string): Json;
  unresolveThread(owner: string, repo: string, number: number, threadId: string): Json;
  /**
   * Mark / unmark a file as viewed with the user's GitHub session (R§3), exactly as GitHub's client does:
   * `POST <o>/<r>/pull/<n>/file_review` with `{"path": path, "viewed": "viewed"}`, and `DELETE` to the same URL
   * with `{"path": path, "_method": "delete"}`. `path` is the repo file path (non-empty, no NUL/CR/LF, at most
   * 4096 characters), sent verbatim in the JSON body. The session fallback for `markFileAsViewed` /
   * `unmarkFileAsViewed` when no token is stored or GitHub refuses it.
   */
  markViewed(owner: string, repo: string, number: number, path: string): Json;
  unmarkViewed(owner: string, repo: string, number: number, path: string): Json;
};

/**
 * Bridge methods the viewer connection may re-issue when their port is replaced mid-call (`closed`): reads, and
 * `applySuggestions`, which carries an `Idempotency-Key` GitHub dedupes on (the retry sends the same key). Every
 * other session write (resolve/unresolve, mark/unmark viewed) may already have reached GitHub when the port
 * closed, so it is never re-sent blindly: it rejects with `closed` and the user retries.
 */
export const RETRY_ON_CLOSED: ReadonlySet<keyof BridgeMethods> = new Set<keyof BridgeMethods>(['get', 'getText', 'preview', 'applySuggestions']);

/** Orders apply-suggestion comments by (id, suggestionIndex), absent index first, as GitHub's client sends them (R§5). */
export function sortSuggestionComments<T extends { id: number; suggestionIndex?: number }>(comments: readonly T[]): T[] {
  return [...comments].sort((a, b) => a.id - b.id || (a.suggestionIndex ?? -1) - (b.suggestionIndex ?? -1));
}

/**
 * Builds the raw query for `GET .../page_data/diff_entries` exactly as GitHub does (R§1.2):
 * `paths = paths.map(encodeURIComponent).join(',')`, then URL-encoded again, i.e. each path is encoded
 * twice and the paths are joined with `%2C`. `extra` values are percent-encoded once.
 */
export function diffEntriesRaw(paths: string[], extra: Record<string, string> = {}): string {
  const joined = paths.map(encodeURIComponent).join(',');
  const parts = ['paths=' + encodeURIComponent(joined)];
  for (const [k, v] of Object.entries(extra)) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
  return parts.join('&');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMethods = Record<string, (...args: any[]) => unknown>;

export const RPC_TIMEOUT_MS = 30_000;

export interface RpcClient<M extends AnyMethods> {
  call<K extends keyof M & string>(method: K, ...args: Parameters<M[K]>): Promise<Awaited<ReturnType<M[K]>>>;
  /** Stops listening, closes the port and rejects pending calls with code `closed`. Idempotent. */
  close(): void;
}

interface Request {
  pierre: 'rpc';
  id: number;
  method: string;
  args: unknown[];
}
type Response =
  | { pierre: 'rpc'; id: number; ok: true; result: unknown }
  | { pierre: 'rpc'; id: number; ok: false; error: BridgeErrorPayload };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function toPayload(err: unknown): BridgeErrorPayload {
  if (isObject(err) && typeof err.status === 'number' && typeof err.message === 'string') {
    return {
      status: err.status,
      ...(typeof err.code === 'string' ? { code: err.code } : {}),
      message: err.message,
    };
  }
  return { status: 0, code: 'internal', message: err instanceof Error ? err.message : 'Internal error' };
}

export function createRpcClient<M extends AnyMethods>(
  port: MessagePort,
  options: { timeoutMs?: number } = {},
): RpcClient<M> {
  const timeoutMs = options.timeoutMs ?? RPC_TIMEOUT_MS;
  const pending = new Map<number, { resolve(v: never): void; reject(e: unknown): void; timer: ReturnType<typeof setTimeout> }>();
  let nextId = 1;
  let closed = false;

  port.onmessage = (event: MessageEvent) => {
    const msg: unknown = event.data;
    if (!isObject(msg) || msg.pierre !== 'rpc' || typeof msg.id !== 'number') return;
    const entry = pending.get(msg.id);
    if (!entry) return; // timed out or unknown: ignore the late reply
    pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.ok === true) entry.resolve(msg.result as never);
    else entry.reject(new BridgeError(toPayload(msg.error)));
  };

  return {
    call(method, ...args) {
      if (closed) return Promise.reject(new BridgeError({ status: 0, code: 'closed', message: 'RPC port closed' }));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new BridgeError({ status: 0, code: 'timeout', message: `RPC ${method} timed out after ${timeoutMs} ms` }));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        const request: Request = { pierre: 'rpc', id, method, args };
        try {
          port.postMessage(request);
        } catch (err) {
          pending.delete(id);
          clearTimeout(timer);
          reject(new BridgeError({ status: 0, code: 'internal', message: err instanceof Error ? err.message : 'postMessage failed' }));
        }
      });
    },
    close() {
      if (closed) return;
      closed = true;
      port.onmessage = null;
      port.close();
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(new BridgeError({ status: 0, code: 'closed', message: 'RPC port closed' }));
      }
      pending.clear();
    },
  };
}

/** What a server implements for `M`: each method may return its result directly or as a promise. */
export type RpcImpl<M extends AnyMethods> = {
  [K in keyof M]: (...args: Parameters<M[K]>) => ReturnType<M[K]> | Promise<ReturnType<M[K]>>;
};

/** Serves `impl` over `port`. Only own methods of `impl` are callable; anything else is `not_allowed`. */
export function serveRpc<M extends AnyMethods>(port: MessagePort, impl: RpcImpl<M>): void {
  port.onmessage = (event: MessageEvent) => {
    const msg: unknown = event.data;
    if (!isObject(msg) || msg.pierre !== 'rpc' || typeof msg.id !== 'number') return;
    if (typeof msg.method !== 'string' || !Array.isArray(msg.args)) return;
    const { id, method, args } = msg as unknown as Request;

    const reply = (response: Response) => {
      try {
        port.postMessage(response);
      } catch {
        // Result not structured-cloneable, or the port is gone: report what we can.
        try {
          port.postMessage({ pierre: 'rpc', id, ok: false, error: { status: 0, code: 'internal', message: 'Unserializable result' } } satisfies Response);
        } catch {
          /* port closed */
        }
      }
    };

    const fn = Object.hasOwn(impl, method) ? (impl as Record<string, unknown>)[method] : undefined;
    if (typeof fn !== 'function') {
      reply({ pierre: 'rpc', id, ok: false, error: { status: 0, code: 'not_allowed', message: `Unknown method: ${method}` } });
      return;
    }
    new Promise((resolve) => resolve(fn.apply(impl, args))).then(
      (result) => reply({ pierre: 'rpc', id, ok: true, result }),
      (err: unknown) => reply({ pierre: 'rpc', id, ok: false, error: toPayload(err) }),
    );
  };
}
