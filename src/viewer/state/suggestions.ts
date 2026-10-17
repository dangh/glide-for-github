/**
 * Apply suggestion (R§5): commit one suggestion block, or a batch, from the PR with the user's GitHub session
 * (`page_data/apply_review_suggestions` through the bridge; no token, the spec's one session write).
 *
 * - `Idempotency-Key`: a UUID kept per PR in `sessionStorage` until GitHub answered. It is reused when a commit is
 *   retried after a failure whose outcome is unknown (network, closed port, 5xx), so a request that did reach GitHub
 *   is not applied twice; it is cleared after success and after a definite refusal (4xx), so the next commit (other
 *   suggestions, or after a reload) never collides with a finished request.
 * - 409 `HEAD_OID_MISMATCH` ("head moved"): the store's `headMoved` is set (the "This pull request was updated" banner)
 *   and the batch is kept. Recovery is a soft reload (`reloadPr`: new PR data, `headMoved` reset, batch kept and
 *   pruned); the batch also survives a real page reload (sessionStorage, see batch.ts).
 * - Success: the committed suggestions leave the batch and the PR data is reloaded (new head, threads marked applied).
 */
import { prKey, type PrRef } from '../../shared/pr-url';
import { BridgeError } from '../../shared/rpc';
import { WriteError } from '../github/errors';
import { applySuggestions } from '../github/private';
import { sessionStore } from './batch';
import { noteWrite } from './freshness';
import { loadPr } from './load';
import { sessionError } from './review';
import { session } from './session';
import { usePr, type SuggestionRef } from './store';

export { canApply, commentUrl, suggestionCount, suggestionRefs } from './batch';

export const DEFAULT_COMMIT_MESSAGE = 'Apply suggestions from code review';

/** `sessionStorage` key holding the PR's idempotency key. */
export const applyKeyName = (ref: PrRef): string => `pierre.applySuggestions.key:${prKey(ref)}`;

function idempotencyKey(ref: PrRef): string {
  const name = applyKeyName(ref);
  const store = sessionStore();
  let key = store.getItem(name);
  if (!key) {
    key = crypto.randomUUID();
    store.setItem(name, key);
  }
  return key;
}

const clearKey = (ref: PrRef) => sessionStore().removeItem(applyKeyName(ref));

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
        'The pull request has new commits (head moved). Reload the pull request (your batch is kept), then commit again.',
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
  noteWrite(); // the only write that moves the head: confirm the shown head is current (coalesced)
}
