/**
 * Apply suggestion (R§5): commit one suggestion block, or a batch, from the PR with the user's GitHub session
 * (`page_data/apply_review_suggestions` through the bridge; no token, the spec's one session write).
 *
 * - `Idempotency-Key`: a UUID kept per PR in `sessionStorage` until GitHub answered. It is reused when a commit is
 *   retried after a failure whose outcome is unknown (network, closed port, 5xx), so a request that did reach GitHub
 *   is not applied twice; it is cleared after success and after a definite refusal (4xx), so the next commit (other
 *   suggestions, or after a reload) never collides with a finished request.
 * - 409 `HEAD_OID_MISMATCH` ("head moved"): the store's `headMoved` is set (the "This pull request was updated" banner)
 *   and the batch is kept.
 * - Success: the committed suggestions leave the batch and the PR data is reloaded (new head, threads marked applied).
 */
import { prKey, type PrRef } from '../../shared/pr-url';
import { BridgeError } from '../../shared/rpc';
import { WriteError } from '../github/errors';
import { applySuggestions, type PrData } from '../github/private';
import type { CommentModel, ThreadModel } from '../github/threads';
import { loadPr } from './load';
import { sessionError } from './review';
import { session } from './session';
import { usePr, type SuggestionRef } from './store';

export const DEFAULT_COMMIT_MESSAGE = 'Apply suggestions from code review';

/** `sessionStorage` key holding the PR's idempotency key. */
export const applyKeyName = (ref: PrRef): string => `pierre.applySuggestions.key:${prKey(ref)}`;

const memoryKeys = new Map<string, string>(); // when sessionStorage is unavailable
function storage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  try {
    if (typeof sessionStorage !== 'undefined') return sessionStorage;
  } catch {
    // blocked storage
  }
  return {
    getItem: (k) => memoryKeys.get(k) ?? null,
    setItem: (k, v) => void memoryKeys.set(k, v),
    removeItem: (k) => void memoryKeys.delete(k),
  };
}

function idempotencyKey(ref: PrRef): string {
  const name = applyKeyName(ref);
  const store = storage();
  let key = store.getItem(name);
  if (!key) {
    key = crypto.randomUUID();
    store.setItem(name, key);
  }
  return key;
}

const clearKey = (ref: PrRef) => storage().removeItem(applyKeyName(ref));

/** Fence opener: up to 3 spaces, then ``` or ~~~ (3+), then the info string. */
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;

/** Number of ```` ```suggestion ```` blocks in a comment body (fences inside other fences do not count). */
export function suggestionCount(body: string): number {
  let count = 0;
  let open: string | null = null;
  for (const line of body.split('\n')) {
    const m = FENCE.exec(line.replace(/\r$/, ''));
    if (open === null) {
      if (!m) continue;
      open = m[1]!;
      if (m[2]!.toLowerCase() === 'suggestion') count++;
    } else if (m && m[1]![0] === open[0] && m[1]!.length >= open.length && m[2] === '' && line.trim() === m[1]) {
      open = null;
    }
  }
  return count;
}

/**
 * Whether "Commit suggestion" / "Add suggestion to batch" apply to a comment: the viewer may apply suggestions
 * (`canApplySuggestion`, i.e. write access), the comment is published (not pending), its thread is a current
 * (not outdated) line thread on the new side, and the body has a suggestion block.
 */
export function canApply(pr: Pick<PrData, 'viewer'> | null, thread: ThreadModel, comment: CommentModel): boolean {
  return (
    pr?.viewer.canApplySuggestion === true &&
    comment.state === 'submitted' &&
    !thread.isOutdated &&
    thread.subject === 'line' &&
    thread.side === 'additions' &&
    suggestionCount(comment.body) > 0
  );
}

/** The comment's URL on GitHub (GitHub's own, else the standard `#discussion_r<id>` anchor). */
export function commentUrl(ref: PrRef, comment: Pick<CommentModel, 'databaseId' | 'url'>): string {
  return comment.url ?? `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}#discussion_r${comment.databaseId}`;
}

/** The suggestion refs of one comment, one per block (`suggestionIndex` 0, 1, …; GitHub requires it even for one). */
export function suggestionRefs(ref: PrRef, path: string, comment: CommentModel): SuggestionRef[] {
  const n = suggestionCount(comment.body);
  const url = commentUrl(ref, comment);
  return Array.from({ length: n }, (_, i) => ({ commentId: comment.databaseId, suggestionIndex: i, path, url }));
}

/** A definite answer from GitHub (it handled the request and refused it): the idempotency key is finished. */
const definite = (err: unknown) => err instanceof BridgeError && err.status >= 400 && err.status < 500;

/**
 * Commits `refs` with `message` against the PR head (`expectedHeadOid`), see the module comment. Rejects with a
 * `WriteError` (`conflict` + "head moved" for `HEAD_OID_MISMATCH`); the batch is kept on any failure.
 */
export async function commitSuggestions(refs: readonly SuggestionRef[], message: string): Promise<void> {
  const pr = usePr.getState().pr;
  if (!pr) throw new WriteError('unknown', 'The pull request is not loaded yet.', { owner: '' });
  const owner = pr.ref.owner;
  const rpc = session.rpc;
  if (!rpc) throw new WriteError('network', 'Not connected to the GitHub page.', { owner });
  if (refs.length === 0) return;
  const key = idempotencyKey(pr.ref);
  try {
    await applySuggestions(
      rpc,
      pr.ref,
      {
        comments: refs.map((r) => ({ id: r.commentId, suggestionIndex: r.suggestionIndex })),
        message,
        expectedHeadOid: pr.headOid,
      },
      key,
    );
  } catch (err) {
    if (definite(err)) clearKey(pr.ref);
    if (err instanceof BridgeError && err.status === 409 && err.code === 'HEAD_OID_MISMATCH') {
      usePr.getState().setHeadMoved(true);
      throw new WriteError(
        'conflict',
        'The pull request has new commits (head moved). Reload to see them, then commit the suggestions again.',
        { owner, status: 409 },
      );
    }
    const e = sessionError(err, owner);
    const detail = err instanceof Error && err.message ? ` GitHub said: ${err.message}` : '';
    throw e.kind === 'network' || e.kind === 'rate-limited'
      ? e
      : new WriteError(e.kind, `Could not commit the ${refs.length === 1 ? 'suggestion' : 'suggestions'}.${detail}`, { owner, ...(e.status ? { status: e.status } : {}) });
  }
  clearKey(pr.ref);
  usePr.getState().removeFromBatch(refs);
  try {
    await loadPr(rpc, pr.ref, () => usePr.getState().pr === pr);
  } catch {
    usePr.getState().setNotice({ kind: 'info', message: 'Suggestions committed. Reload to see the new commit.' });
  }
}
