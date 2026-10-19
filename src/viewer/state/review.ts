/**
 * Thread and comment writes (Task 9): single comments, review comments, replies, edits, deletes, reactions,
 * resolve / unresolve. Every write goes through `withApi`, which gets a token via `requireToken` and, on an auth
 * failure only (`isAuthError`), re-opens the token prompt (`force`) and retries with the new token. Other
 * `WriteError`s propagate to the caller (shown inline with Retry, draft kept).
 *
 * After a write the store is updated locally right away (provisional comments/threads, optimistic reactions and
 * resolve state), then threads are refetched in the background and merged (`mergeThreads`) so a refetch that
 * does not have the new comment yet never makes it disappear.
 */
import { isNoTokenError, requireToken, type RequireTokenOptions } from '../auth/requireToken';
import { getToken } from '../auth/tokens';
import { GithubApi, type ReactionContent, type ReviewEvent } from '../github/api';
import { isAuthError, WriteError } from '../github/errors';
import { fetchThreads, type PrData } from '../github/private';
import { toThreadModels, type CommentModel, type ThreadModel } from '../github/threads';
import { targetOfDraft, type CommentTarget } from './compose';
import { rangeOids } from './range';
import { session } from './session';
import { BridgeError } from '../../shared/rpc';
import { draftKey, threadByKey, threadKey, usePr, type DraftKey } from './store';

/**
 * Whether "Add single comment" stays available while the viewer has a pending review. Verified on the sandbox
 * (e2e, 2026-10-17): REST `POST /pulls/{n}/comments` then fails with 422 "user_id can only have one pending review
 * per pull request", so the composer offers only "Add review comment" while a review is pending (as GitHub's UI does).
 */
export const SINGLE_COMMENT_WHILE_PENDING = false;

export const REACTIONS: { content: ReactionContent; emoji: string; label: string }[] = [
  { content: 'THUMBS_UP', emoji: '👍', label: '+1' },
  { content: 'THUMBS_DOWN', emoji: '👎', label: '-1' },
  { content: 'LAUGH', emoji: '😄', label: 'Laugh' },
  { content: 'HOORAY', emoji: '🎉', label: 'Hooray' },
  { content: 'CONFUSED', emoji: '😕', label: 'Confused' },
  { content: 'HEART', emoji: '❤️', label: 'Heart' },
  { content: 'ROCKET', emoji: '🚀', label: 'Rocket' },
  { content: 'EYES', emoji: '👀', label: 'Eyes' },
];

const MAX_AUTH_ATTEMPTS = 3;
const REFRESH_DELAY_MS = 800;

function currentPr(): PrData {
  const pr = usePr.getState().pr;
  if (!pr) throw new WriteError('unknown', 'The pull request is not loaded yet.', { owner: '' });
  return pr;
}

/** The head commit currently shown (the selected range's head, else the PR head): `commit_id` / `commitOID` of writes. */
export function shownHeadOid(): string {
  const s = usePr.getState();
  return rangeOids(currentPr(), s.range).newOid;
}

/**
 * Runs `fn` with an API client; an auth failure re-opens the token prompt and retries with the new token.
 * `first`: options for the first `requireToken` (e.g. `force` when the stored token is known to be refused).
 */
export async function withApi<T>(reason: string, fn: (api: GithubApi) => Promise<T>, first: RequireTokenOptions = {}): Promise<T> {
  const owner = currentPr().ref.owner;
  let api = await requireToken(owner, reason, first);
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(api);
    } catch (err) {
      if (!isAuthError(err) || attempt >= MAX_AUTH_ATTEMPTS) throw err;
      api = await requireToken(owner, reason, { force: true, problem: err.message });
    }
  }
}

// ---- per-PR caches -----------------------------------------------------------------------------------

let caches: { prNodeId?: string; threadNodeIds?: Map<number, string> } = {};
/** Comments deleted in this session: a refetch that still lists them does not bring them back. */
let deleted = new Set<number>();

export function resetReviewCaches(): void {
  caches = {};
  deleted = new Set();
  clearTimeout(refreshTimer);
}

async function prNodeId(api: GithubApi): Promise<string> {
  caches.prNodeId ??= currentPr().nodeId ?? (await api.prNodeId());
  return caches.prNodeId;
}

/** GraphQL thread node id (resolve, review replies), via `threadNodeIds()` fetched lazily and cached (refetched on a miss). */
async function threadNodeId(api: GithubApi, thread: ThreadModel): Promise<string> {
  const first = thread.comments[0]?.databaseId;
  if (first === undefined) throw new WriteError('not-found', 'This thread has no comments.', { owner: currentPr().ref.owner });
  let id = caches.threadNodeIds?.get(first);
  if (!id) {
    caches.threadNodeIds = await api.threadNodeIds();
    id = caches.threadNodeIds.get(first);
  }
  if (!id) throw new WriteError('not-found', 'GitHub did not find this thread. Reload the page to refresh it.', { owner: currentPr().ref.owner });
  return id;
}

/** The viewer's pending review node id: the known one, else GitHub's, else (when `create`) a new pending review. */
async function reviewNodeId(api: GithubApi, create: boolean): Promise<string> {
  const known = usePr.getState().pendingReview;
  if (known?.nodeId) return known.nodeId;
  const found = await api.pendingReview();
  if (found) {
    usePr.getState().setPendingReview(found);
    return found.nodeId;
  }
  if (!create) throw new WriteError('conflict', 'The pending review no longer exists on GitHub.', { owner: currentPr().ref.owner });
  const id = await api.startReview(await prNodeId(api), shownHeadOid());
  usePr.getState().setPendingReview({ nodeId: id, count: 0 });
  return id;
}

function bumpPending(delta: number) {
  const s = usePr.getState();
  if (s.pendingReview) s.setPendingReview({ ...s.pendingReview, count: Math.max(0, s.pendingReview.count + delta) });
}

/**
 * Pending review state on load: the route tells whether one exists (`pendingReviewComments`); its node id comes
 * from GitHub when a token is already stored (never prompts). Failures are ignored (the first review write asks again).
 */
export async function initPendingReview(pr: PrData): Promise<void> {
  if (pr.pendingReviewComments !== undefined && !usePr.getState().pendingReview) {
    usePr.getState().setPendingReview({ nodeId: '', count: pr.pendingReviewComments });
  }
  try {
    const token = await getToken(pr.ref.owner);
    if (!token || usePr.getState().pr !== pr) return;
    const found = await new GithubApi(token, pr.ref).pendingReview();
    if (usePr.getState().pr === pr) usePr.getState().setPendingReview(found);
  } catch {
    // not fatal
  }
}

// ---- local store updates -----------------------------------------------------------------------------

function provisionalComment(databaseId: number, nodeId: string, body: string, state: CommentModel['state']): CommentModel {
  const login = currentPr().viewer.login;
  return {
    databaseId,
    nodeId,
    author: { login, avatarUrl: login ? `https://github.com/${encodeURIComponent(login)}.png?size=40` : '' },
    body,
    bodyHTML: '',
    bodyVersion: '',
    createdAt: new Date().toISOString(),
    state,
    reactions: [],
    viewerCanUpdate: true,
    viewerCanDelete: true,
    provisional: true,
  };
}

function addProvisionalThread(target: CommentTarget, comment: CommentModel) {
  usePr.getState().upsertThread({
    id: `local:${comment.databaseId}`,
    path: target.path,
    side: target.side,
    line: target.subject === 'file' ? 0 : target.line,
    ...(target.startLine !== undefined ? { startLine: target.startLine, startSide: target.startSide ?? target.side } : {}),
    subject: target.subject,
    isOutdated: false,
    isResolved: false,
    comments: [comment],
    viewerCanReply: true,
    provisional: true,
  });
}

/** Updates the thread with stable key `key` (its current copy, provisional or server). */
function updateThread(key: string, fn: (t: ThreadModel) => ThreadModel) {
  const t = threadByKey(usePr.getState().threads, key);
  if (t) usePr.getState().upsertThread(fn(t));
}

function findComment(databaseId: number): { thread: ThreadModel; comment: CommentModel } | undefined {
  for (const thread of usePr.getState().threads) {
    const comment = thread.comments.find((c) => c.databaseId === databaseId);
    if (comment) return { thread, comment };
  }
  return undefined;
}

function updateComment(databaseId: number, fn: (c: CommentModel) => CommentModel) {
  const found = findComment(databaseId);
  if (!found) return;
  updateThread(threadKey(found.thread), (t) => ({ ...t, comments: t.comments.map((c) => (c.databaseId === databaseId ? fn(c) : c)) }));
}

/**
 * Merges a thread refetch into the current threads: the server's copy wins, except that provisional comments and
 * threads it does not list yet are kept, and comments deleted in this session stay deleted.
 */
export function mergeThreads(fetched: ThreadModel[], current: ThreadModel[], deletedIds: ReadonlySet<number>): ThreadModel[] {
  const known = new Set<number>();
  for (const t of fetched) for (const c of t.comments) known.add(c.databaseId);
  const currentById = new Map(current.map((t) => [t.id, t]));
  const out: ThreadModel[] = [];
  for (const t of fetched) {
    let comments = deletedIds.size > 0 ? t.comments.filter((c) => !deletedIds.has(c.databaseId)) : t.comments;
    const local = currentById.get(t.id);
    const extra = local?.comments.filter((c) => c.provisional && !known.has(c.databaseId)) ?? [];
    if (extra.length > 0) comments = [...comments, ...extra];
    if (comments.length === 0) continue;
    out.push(comments === t.comments ? t : { ...t, comments });
  }
  for (const t of current) {
    if (t.provisional && !t.comments.some((c) => known.has(c.databaseId))) out.push(t);
  }
  return out;
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined;

/** Refetches threads (bodies rendered by GitHub, real ids, permissions) shortly after a write. */
export function scheduleRefresh(delay = REFRESH_DELAY_MS): void {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshThreads().catch((err: unknown) => console.warn('[pierre] thread refresh', err));
  }, delay);
}

export async function refreshThreads(): Promise<void> {
  const rpc = session.rpc;
  const pr = usePr.getState().pr;
  if (!rpc || !pr) return;
  // With the route (no cached markers): the viewer's PENDING review threads are only in the route's embedded
  // `markers` (page_data/threads lists submitted threads), and markers carry the current positions.
  const raw = await fetchThreads(rpc, pr.ref);
  if (usePr.getState().pr !== pr) return;
  usePr.getState().setThreads(mergeThreads(toThreadModels(raw), usePr.getState().threads, deleted));
}

// ---- writes ------------------------------------------------------------------------------------------

export type NewCommentMode = 'single' | 'review';

/** Posts a new-thread composer's comment (`key` = its draft) as a single comment or as part of the pending review. */
export async function submitNewComment(key: DraftKey, body: string, mode: NewCommentMode): Promise<void> {
  const target = targetOfDraft(usePr.getState().drafts.get(key));
  if (!target) throw new WriteError('unknown', 'This comment box is no longer open.', { owner: currentPr().ref.owner });
  const line = target.subject === 'line';
  if (mode === 'single') {
    const res = await withApi('comment', (api) =>
      api.createComment({
        path: target.path,
        ...(line
          ? { line: target.line, side: target.side, ...(target.startLine !== undefined ? { startLine: target.startLine, startSide: target.startSide ?? target.side } : {}) }
          : { subjectType: 'file' as const }),
        body,
        commitId: shownHeadOid(),
      }),
    );
    addProvisionalThread(target, provisionalComment(res.id, res.nodeId, body, 'submitted'));
  } else {
    const res = await withApi('start a review', async (api) => {
      const review = await reviewNodeId(api, true);
      return api.addReviewThread(review, {
        path: target.path,
        side: target.side,
        subjectType: target.subject,
        ...(line ? { line: target.line, ...(target.startLine !== undefined ? { startLine: target.startLine, startSide: target.startSide ?? target.side } : {}) } : {}),
        body,
      });
    });
    (caches.threadNodeIds ??= new Map()).set(res.commentDatabaseId, res.threadNodeId);
    addProvisionalThread(target, provisionalComment(res.commentDatabaseId, res.commentNodeId, body, 'pending'));
    bumpPending(1);
  }
  usePr.getState().clearDraft(key);
  scheduleRefresh();
}

/** Replies to a thread (by `threadKey`): REST reply, or a pending review reply while the viewer has a pending review. */
export async function submitReply(key: string, body: string): Promise<void> {
  const thread = threadByKey(usePr.getState().threads, key);
  const first = thread?.comments[0];
  if (!thread || !first) throw new WriteError('not-found', 'This thread is no longer available.', { owner: currentPr().ref.owner });
  let comment: CommentModel;
  if (usePr.getState().pendingReview) {
    const res = await withApi('reply', async (api) => api.addReviewReply(await reviewNodeId(api, true), await threadNodeId(api, thread), body));
    comment = provisionalComment(res.databaseId, res.nodeId, body, 'pending');
    bumpPending(1);
  } else {
    const res = await withApi('reply', (api) => api.reply(first.databaseId, body));
    comment = provisionalComment(res.id, res.nodeId, body, 'submitted');
  }
  updateThread(key, (t) => ({ ...t, comments: [...t.comments, comment] }));
  usePr.getState().clearDraft(draftKey.reply(key));
  scheduleRefresh();
}

export async function submitEdit(databaseId: number, body: string): Promise<void> {
  await withApi('edit a comment', (api) => api.editComment(databaseId, body));
  updateComment(databaseId, (c) => ({ ...c, body, bodyHTML: '', provisional: true }));
  usePr.getState().clearDraft(draftKey.edit(databaseId));
  scheduleRefresh();
}

export async function deleteComment(databaseId: number): Promise<void> {
  const found = findComment(databaseId);
  await withApi('delete a comment', (api) => api.deleteComment(databaseId));
  deleted.add(databaseId);
  usePr.getState().removeComment(databaseId);
  usePr.getState().clearDraft(draftKey.edit(databaseId));
  if (found?.comment.state === 'pending') bumpPending(-1);
  scheduleRefresh();
}

function setReaction(databaseId: number, content: ReactionContent, on: boolean) {
  updateComment(databaseId, (c) => {
    const reactions = [...c.reactions];
    const i = reactions.findIndex((r) => r.content === content);
    const prev = i >= 0 ? reactions[i]! : { content, count: 0, viewerHasReacted: false };
    if (prev.viewerHasReacted === on) return c;
    const next = { ...prev, viewerHasReacted: on, count: Math.max(0, prev.count + (on ? 1 : -1)) };
    if (i >= 0) reactions[i] = next;
    else reactions.push(next);
    return { ...c, reactions };
  });
}

/** Adds or removes the viewer's reaction (per `viewerHasReacted`), optimistically; reverted on failure. */
export async function toggleReaction(databaseId: number, content: ReactionContent): Promise<void> {
  const found = findComment(databaseId);
  if (!found) return;
  const had = found.comment.reactions.find((r) => r.content === content)?.viewerHasReacted === true;
  setReaction(databaseId, content, !had);
  try {
    await withApi('react', (api) => (had ? api.removeReaction(found.comment.nodeId, content) : api.addReaction(found.comment.nodeId, content)));
  } catch (err) {
    setReaction(databaseId, content, had);
    throw err;
  }
}

// ---- token first, GitHub session second ------------------------------------------------------------

/** A bridge (session) failure as a `WriteError` for inline display. */
export function sessionError(err: unknown, owner: string): WriteError {
  if (err instanceof WriteError) return err;
  const status = err instanceof BridgeError ? err.status : 0;
  const code = err instanceof BridgeError ? err.code : undefined;
  const detail = err instanceof Error && err.message ? ` GitHub said: ${err.message}` : '';
  const init = { owner, ...(status ? { status } : {}) };
  if (status === 401 || status === 403) return new WriteError('forbidden', `GitHub refused this action for your session.${detail}`, init);
  if (status === 404) return new WriteError('not-found', `GitHub did not find this conversation.${detail}`, init);
  if (status === 409) return new WriteError('conflict', `GitHub reported a conflict.${detail}`, init);
  if (status === 422) return new WriteError('validation', `GitHub rejected the request.${detail}`, init);
  if (status === 429) return new WriteError('rate-limited', 'GitHub is rate limiting requests. Try again shortly.', init);
  if (status === 0 && (code === 'network' || code === 'closed' || code === 'timeout'))
    return new WriteError('network', 'Could not reach GitHub. Check your connection and retry.', init);
  return new WriteError('unknown', `The action failed.${detail}`, init);
}

/** The session path was refused for lack of authorization (logged out, no permission). */
const sessionRefused = (err: unknown) => err instanceof BridgeError && (err.status === 401 || err.status === 403);

/**
 * Token first, then the user's GitHub session (Ruling: option C). Runs `tokenAction` with the stored token, without
 * prompting. If there is no token, or GitHub refuses the token for this action (an auth error, e.g. fine-grained
 * tokens and `resolveReviewThread`), runs `sessionAction` (GitHub's own page_data endpoint through the bridge).
 * Only when the session is refused too does it ask for a token (`withApi`, forced when the stored one was refused).
 * Other failures of either path propagate (as `WriteError`). Reusable for Viewed (Task 10).
 */
export async function withSessionFallback<T>(reason: string, tokenAction: (api: GithubApi) => Promise<T>, sessionAction: () => Promise<T>): Promise<T> {
  const pr = currentPr();
  const owner = pr.ref.owner;
  let refused: WriteError | undefined;
  const token = await getToken(owner);
  if (token) {
    try {
      return await tokenAction(new GithubApi(token, pr.ref));
    } catch (err) {
      if (!isAuthError(err)) throw err;
      refused = err;
    }
  }
  try {
    return await sessionAction();
  } catch (err) {
    if (!sessionRefused(err)) throw sessionError(err, owner);
    return withApi(reason, tokenAction, refused ? { force: true, problem: refused.message } : {});
  }
}

/** The thread's numeric id (page_data endpoints); a just-posted provisional thread gets it from a refresh first. */
async function numericThreadId(key: string): Promise<string> {
  const numeric = () => {
    const id = threadByKey(usePr.getState().threads, key)?.id;
    return id && /^\d+$/.test(id) ? id : undefined;
  };
  let id = numeric();
  if (!id) {
    await refreshThreads();
    id = numeric();
  }
  if (!id) throw new WriteError('conflict', 'This conversation is still being saved on GitHub. Try again in a moment.', { owner: currentPr().ref.owner });
  return id;
}

/**
 * Resolves or unresolves a thread (by `threadKey`), optimistically; reverted on failure. Token (GraphQL) first,
 * then GitHub's session (`page_data/resolve_thread`), see `withSessionFallback`.
 */
export async function setResolved(key: string, resolved: boolean): Promise<void> {
  const thread = threadByKey(usePr.getState().threads, key);
  if (!thread || thread.isResolved === resolved) return;
  const apply = (value: boolean) => updateThread(key, (t) => (t.isResolved === value ? t : { ...t, isResolved: value }));
  apply(resolved);
  const { owner, repo, number } = currentPr().ref;
  try {
    await withSessionFallback(
      resolved ? 'resolve a conversation' : 'unresolve a conversation',
      async (api) => {
        const id = await threadNodeId(api, threadByKey(usePr.getState().threads, key) ?? thread);
        await (resolved ? api.resolve(id) : api.unresolve(id));
      },
      async () => {
        const rpc = session.rpc;
        if (!rpc) throw new WriteError('network', 'Not connected to the GitHub page.', { owner });
        const id = await numericThreadId(key);
        await rpc.call(resolved ? 'resolveThread' : 'unresolveThread', owner, repo, number, id);
      },
    );
    apply(resolved); // a refresh in between may have brought the old state back
  } catch (err) {
    apply(!resolved);
    throw err;
  }
}

// ---- review submission (Task 10) --------------------------------------------------------------------

/** Marks the viewer's pending comments as submitted (until the refetch brings GitHub's copy). */
function markPendingSubmitted() {
  const s = usePr.getState();
  if (!s.threads.some((t) => t.comments.some((c) => c.state === 'pending'))) return;
  s.setThreads(
    s.threads.map((t) =>
      t.comments.some((c) => c.state === 'pending') ? { ...t, comments: t.comments.map((c) => (c.state === 'pending' ? { ...c, state: 'submitted' as const } : c)) } : t,
    ),
  );
}

/** Drops the viewer's pending comments (and threads left empty) after the pending review was discarded. */
function dropPendingComments() {
  const s = usePr.getState();
  if (!s.threads.some((t) => t.comments.some((c) => c.state === 'pending'))) return;
  const threads: ThreadModel[] = [];
  for (const t of s.threads) {
    const comments = t.comments.filter((c) => c.state !== 'pending');
    if (comments.length === t.comments.length) threads.push(t);
    else if (comments.length > 0) threads.push({ ...t, comments });
    else for (const c of t.comments) deleted.add(c.databaseId);
  }
  s.setThreads(threads);
}

/**
 * Submits the viewer's review as Comment / Approve / Request changes with an optional summary (GraphQL
 * `submitPullRequestReview`). With no pending review, an empty one is started first (at the shown head), as GitHub
 * does for a review without inline comments. On success the pending count goes away, pending comments become
 * submitted and the summary draft is cleared; on failure everything is kept.
 */
export async function submitReview(event: ReviewEvent, body: string): Promise<void> {
  await withApi('submit a review', async (api) => api.submitReview(await reviewNodeId(api, true), event, body));
  const s = usePr.getState();
  s.setPendingReview(null);
  s.clearDraft(draftKey.reviewSummary);
  markPendingSubmitted();
  scheduleRefresh();
}

/** Discards the viewer's pending review and its comments (GraphQL `deletePullRequestReview`). */
export async function discardReview(): Promise<void> {
  await withApi('discard a review', async (api) => {
    const known = usePr.getState().pendingReview?.nodeId || (await api.pendingReview())?.nodeId;
    if (known) await api.deleteReview(known); // none on GitHub: already gone, just clear it here
  });
  usePr.getState().setPendingReview(null);
  dropPendingComments();
  scheduleRefresh();
}

// ---- viewed (Task 10, Ruling 13: token first, GitHub session second) --------------------------------

/** Latest viewed toggle per path: an older toggle that fails must not revert a newer one. */
const viewedOps = new Map<string, number>();
let viewedSeq = 0;

/**
 * Marks a file viewed / not viewed: optimistic (the file collapses or expands at once), then GraphQL
 * `markFileAsViewed` / `unmarkFileAsViewed` with a stored token, else (no token, or GitHub refuses the token) GitHub's
 * own `file_review` endpoint with the user's session through the bridge (no token prompt when that works). Reverted
 * and rethrown on failure.
 */
export async function setFileViewed(path: string, viewed: boolean): Promise<void> {
  const pr = currentPr();
  if (usePr.getState().viewed.has(path) === viewed) return;
  const op = ++viewedSeq;
  viewedOps.set(path, op);
  usePr.getState().setViewedLocal(path, viewed);
  const { owner, repo, number } = pr.ref;
  try {
    await withSessionFallback(
      viewed ? 'mark files as viewed' : 'unmark files as viewed',
      async (api) => {
        const id = await prNodeId(api);
        await (viewed ? api.markViewed(id, path) : api.unmarkViewed(id, path));
      },
      async () => {
        const rpc = session.rpc;
        if (!rpc) throw new WriteError('network', 'Not connected to the GitHub page.', { owner });
        await rpc.call(viewed ? 'markViewed' : 'unmarkViewed', owner, repo, number, path);
      },
    );
  } catch (err) {
    if (viewedOps.get(path) === op && usePr.getState().pr === pr) usePr.getState().setViewedLocal(path, !viewed);
    throw err;
  } finally {
    if (viewedOps.get(path) === op) viewedOps.delete(path);
  }
}

/** Some files of a group could not be marked (or unmarked) viewed; `paths` are those files, already reverted. */
export class FilesViewedError extends Error {
  constructor(
    readonly paths: string[],
    cause: unknown,
  ) {
    super(errorMessage(cause), { cause });
  }
}

/**
 * Marks every file of `paths` viewed / not viewed (a group of related files), each through `setFileViewed` (so GitHub's
 * page follows) and all at once. Files already in that state are left alone. A file GitHub refuses is reverted alone;
 * the rest stay. Rejects with a `FilesViewedError` naming the files that failed, or with the token prompt's cancel
 * error when that is every failure.
 */
export async function setFilesViewed(paths: readonly string[], viewed: boolean): Promise<void> {
  const results = await Promise.allSettled(paths.map((path) => setFileViewed(path, viewed)));
  const failed = paths.filter((_, i) => results[i]!.status === 'rejected');
  if (failed.length === 0) return;
  const reasons = results.flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []));
  if (reasons.every(isNoTokenError)) throw reasons[0];
  throw new FilesViewedError(failed, reasons.find((r) => !isNoTokenError(r)));
}

/** Message for an error shown inline. */
export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));
