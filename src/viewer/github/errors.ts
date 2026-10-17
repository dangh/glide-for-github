/**
 * Classification of GitHub write failures into a small set of kinds the UI can act on
 * (`no-token`/`unauthorized`/`forbidden-*` re-open the token prompt; `validation`/`conflict`/... show inline).
 *
 * Messages are built from our own text plus GitHub's `message`/`errors[].message`, passed through `redact` so a
 * server (or fetch error) that echoes the Authorization header can never put the token in an Error.
 */

export type WriteErrorKind =
  | 'no-token'
  | 'unauthorized'
  | 'forbidden-sso'
  | 'forbidden-scope'
  | 'not-found'
  | 'conflict'
  | 'validation'
  | 'rate-limited'
  | 'network'
  | 'unknown';

export interface WriteErrorInit {
  status?: number;
  owner: string;
  /** SAML SSO authorization URL from `X-GitHub-SSO` (forbidden-sso). */
  ssoUrl?: string;
  /** Seconds until the rate limit resets, when GitHub said so (rate-limited). */
  retryAfter?: number;
}

export class WriteError extends Error {
  kind: WriteErrorKind;
  status?: number;
  owner: string;
  ssoUrl?: string;
  retryAfter?: number;

  constructor(kind: WriteErrorKind, message: string, init: WriteErrorInit) {
    super(message);
    this.name = 'WriteError';
    this.kind = kind;
    this.owner = init.owner;
    if (init.status !== undefined) this.status = init.status;
    if (init.ssoUrl !== undefined) this.ssoUrl = init.ssoUrl;
    if (init.retryAfter !== undefined) this.retryAfter = init.retryAfter;
  }
}

export function isWriteError(err: unknown): err is WriteError {
  return err instanceof WriteError;
}

/** Kinds for which a (new) token fixes the problem, so the caller should open the token prompt and retry. */
export function isAuthError(err: unknown): err is WriteError {
  return isWriteError(err) && (err.kind === 'no-token' || err.kind === 'unauthorized' || err.kind === 'forbidden-sso' || err.kind === 'forbidden-scope');
}

export type Redact = (text: string) => string;
const identity: Redact = (s) => s;

const SCOPE_MESSAGE = /resource not accessible by (personal access token|integration)/i;
const RATE_MESSAGE = /rate limit/i;
const MAX_DETAIL = 300;

/** GitHub's own explanation: `message` plus `errors[]` (strings or `{message}`), also accepts a plain string body. */
function detailOf(body: unknown): string {
  if (typeof body === 'string') return body.trim();
  if (typeof body !== 'object' || body === null) return '';
  const b = body as { message?: unknown; errors?: unknown };
  const parts: string[] = [];
  if (typeof b.message === 'string') parts.push(b.message);
  if (Array.isArray(b.errors)) {
    for (const e of b.errors) {
      if (typeof e === 'string') parts.push(e);
      else if (typeof e === 'object' && e !== null && typeof (e as { message?: unknown }).message === 'string') parts.push((e as { message: string }).message);
    }
  }
  return parts.join('; ');
}

const clip = (s: string): string => (s.length > MAX_DETAIL ? `${s.slice(0, MAX_DETAIL)}…` : s);

function messageFor(kind: WriteErrorKind, owner: string, detail: string, status?: number, retryAfter?: number): string {
  const suffix = detail ? ` GitHub said: ${detail}` : '';
  switch (kind) {
    case 'no-token':
      return `A GitHub token for ${owner} is needed.`;
    case 'unauthorized':
      return `GitHub rejected the token for ${owner} (invalid, expired or revoked). Save a new token and try again.`;
    case 'forbidden-sso':
      return `The token for ${owner} is not authorized for the organization's SAML SSO. Authorize it on GitHub, then try again.`;
    case 'forbidden-scope':
      return `The token for ${owner} does not have permission for this. Fine-grained tokens need Pull requests: read and write and Contents: read on the repository; classic tokens need the repo scope.`;
    case 'not-found':
      return 'GitHub could not find this item. It may have been deleted or moved.';
    case 'conflict':
      return `GitHub reported a conflict; the item changed in the meantime. Reload and try again.${suffix}`;
    case 'validation':
      return `GitHub rejected the request.${suffix}`;
    case 'rate-limited':
      return `GitHub rate limit reached.${retryAfter !== undefined ? ` Try again in ${retryAfter} s.` : ' Try again in a moment.'}`;
    case 'network':
      return 'Could not reach api.github.com. Check your connection and try again.';
    case 'unknown':
      return `GitHub request failed${status ? ` (HTTP ${status})` : ''}.${suffix}`;
  }
}

function build(kind: WriteErrorKind, owner: string, redact: Redact, init: Omit<WriteErrorInit, 'owner'>, detail: string): WriteError {
  const message = messageFor(kind, owner, clip(redact(detail)), init.status, init.retryAfter);
  return new WriteError(kind, message, { owner, ...init });
}

/** Seconds from `Retry-After`, or until `X-RateLimit-Reset` (epoch seconds), if present. */
function retryAfterOf(res: Response): number | undefined {
  const retry = Number(res.headers.get('retry-after'));
  if (res.headers.get('retry-after') !== null && Number.isFinite(retry)) return Math.max(0, Math.round(retry));
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  if (res.headers.get('x-ratelimit-reset') !== null && Number.isFinite(reset)) return Math.max(0, Math.round(reset - Date.now() / 1000));
  return undefined;
}

/**
 * Classifies a non-2xx REST/GraphQL HTTP response. `body` is the parsed JSON (or text) already read from `res`.
 * SSO: 403 + `X-GitHub-SSO`. Scope: 403/404 carrying `X-Accepted-GitHub-Permissions` or GitHub's
 * "Resource not accessible by personal access token" message.
 */
export function classifyResponse(res: Response, body: unknown, owner: string, redact: Redact = identity): WriteError {
  const status = res.status;
  const detail = detailOf(body);
  const init = { status };
  const sso = res.headers.get('x-github-sso');

  if (status === 401) return build('unauthorized', owner, redact, init, detail);
  if (status === 403 || status === 404) {
    if (status === 403 && sso !== null) {
      const url = /url=(\S+)/.exec(sso)?.[1];
      return build('forbidden-sso', owner, redact, { ...init, ...(url ? { ssoUrl: url } : {}) }, detail);
    }
    if (SCOPE_MESSAGE.test(detail)) return build('forbidden-scope', owner, redact, init, detail);
    if (status === 403 && (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.has('retry-after') || RATE_MESSAGE.test(detail))) {
      const retryAfter = retryAfterOf(res);
      return build('rate-limited', owner, redact, { ...init, ...(retryAfter !== undefined ? { retryAfter } : {}) }, detail);
    }
    if (res.headers.has('x-accepted-github-permissions')) return build('forbidden-scope', owner, redact, init, detail);
    return build(status === 404 ? 'not-found' : 'unknown', owner, redact, init, detail);
  }
  if (status === 409) return build('conflict', owner, redact, init, detail);
  if (status === 422) return build('validation', owner, redact, init, detail);
  if (status === 429) {
    const retryAfter = retryAfterOf(res);
    return build('rate-limited', owner, redact, { ...init, ...(retryAfter !== undefined ? { retryAfter } : {}) }, detail);
  }
  return build('unknown', owner, redact, init, detail);
}

export interface GraphqlError {
  type?: string;
  message?: string;
}

/** Classifies the `errors` array of a GraphQL response (GitHub answers HTTP 200 for most of these). */
export function classifyGraphqlErrors(errors: GraphqlError[], owner: string, redact: Redact = identity, status?: number): WriteError {
  const detail = errors.map((e) => e.message ?? '').filter(Boolean).join('; ');
  const types = new Set(errors.map((e) => e.type));
  const init = status !== undefined ? { status } : {};
  if (types.has('FORBIDDEN') || types.has('INSUFFICIENT_SCOPES') || SCOPE_MESSAGE.test(detail)) return build('forbidden-scope', owner, redact, init, detail);
  if (types.has('RATE_LIMITED')) return build('rate-limited', owner, redact, init, detail);
  if (types.has('NOT_FOUND')) return build('not-found', owner, redact, init, detail);
  if (types.has('UNPROCESSABLE')) return build('validation', owner, redact, init, detail);
  return build('unknown', owner, redact, init, detail);
}

export function networkError(owner: string): WriteError {
  return new WriteError('network', messageFor('network', owner, ''), { owner });
}

export function noTokenError(owner: string): WriteError {
  return new WriteError('no-token', messageFor('no-token', owner, ''), { owner });
}
