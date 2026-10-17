/**
 * Suggestion rules and the suggestion batch's lifetime (apply suggestion, R§5):
 * - which comments can be applied (`canApply`), their suggestion blocks (`suggestionCount`, `suggestionRefs`);
 * - the batch is persisted per PR in `sessionStorage` (next to the idempotency key), so a real page reload keeps it
 *   (`initBatchPersistence`);
 * - after threads (re)load, refs that no longer pass `canApply` (applied → outdated, deleted, …) are dropped
 *   (`pruneBatch`).
 */
import { prKey, type PrRef } from '../../shared/pr-url';
import type { PrData } from '../github/private';
import type { CommentModel, ThreadModel } from '../github/threads';
import { usePr, type PrState, type SuggestionRef } from './store';

type SessionStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const memory = new Map<string, string>(); // when sessionStorage is unavailable

/** `sessionStorage`, or an in-memory stand-in when it is blocked. */
export function sessionStore(): SessionStore {
  try {
    if (typeof sessionStorage !== 'undefined') return sessionStorage;
  } catch {
    // blocked storage
  }
  return {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => void memory.set(k, v),
    removeItem: (k) => void memory.delete(k),
  };
}

/** `sessionStorage` key holding the PR's suggestion batch. */
export const batchKeyName = (ref: PrRef): string => `pierre.applySuggestions.batch:${prKey(ref)}`;

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

/** Drops batch refs whose comment is gone or no longer passes `canApply` (call with a complete thread list). */
export function pruneBatch(store = usePr): void {
  const s = store.getState();
  if (s.suggestionBatch.length === 0) return;
  const keep = s.suggestionBatch.filter((r) => {
    for (const t of s.threads) {
      const c = t.comments.find((x) => x.databaseId === r.commentId);
      if (c) return canApply(s.pr, t, c) && r.suggestionIndex < suggestionCount(c.body);
    }
    return false;
  });
  if (keep.length !== s.suggestionBatch.length) s.setBatch(keep);
}

const isRef = (v: unknown): v is SuggestionRef => {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    Number.isSafeInteger(r.commentId) && (r.commentId as number) > 0 &&
    Number.isSafeInteger(r.suggestionIndex) && (r.suggestionIndex as number) >= 0 &&
    typeof r.path === 'string' &&
    typeof r.url === 'string' && r.url.startsWith('https://github.com/')
  );
};

function readBatch(name: string): SuggestionRef[] {
  try {
    const parsed: unknown = JSON.parse(sessionStore().getItem(name) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter(isRef).map((r) => ({ commentId: r.commentId, suggestionIndex: r.suggestionIndex, path: r.path, url: r.url }))
      : [];
  } catch {
    return [];
  }
}

/**
 * Keeps the PR's batch in `sessionStorage`: restored when the PR is set (empty batch only), written on every
 * batch change. Returns the unsubscribe function.
 */
export function initBatchPersistence(store = usePr): () => void {
  let name: string | null = null;
  const sync = (s: PrState, prev?: PrState) => {
    const next = s.pr ? batchKeyName(s.pr.ref) : null;
    if (next !== name) {
      name = next;
      if (name && s.suggestionBatch.length === 0) {
        const saved = readBatch(name);
        if (saved.length > 0) {
          s.setBatch(saved);
          return;
        }
      }
    }
    if (!name || (prev && s.suggestionBatch === prev.suggestionBatch)) return;
    try {
      if (s.suggestionBatch.length === 0) sessionStore().removeItem(name);
      else sessionStore().setItem(name, JSON.stringify(s.suggestionBatch));
    } catch {
      // quota / blocked storage: the batch still works for this page
    }
  };
  sync(store.getState());
  return store.subscribe(sync);
}
