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
import { requireToken } from '../auth/requireToken';
import { getToken } from '../auth/tokens';
import { GithubApi, type ReactionContent } from '../github/api';
import { isAuthError, WriteError } from '../github/errors';
import { fetchThreads, type PrData } from '../github/private';
import { toThreadModels, type CommentModel, type ThreadModel } from '../github/threads';
import { targetOfDraft, type CommentTarget } from './compose';
import { rangeOids } from './range';
import { session } from './session';
import { draftKey, threadById, usePr, type DraftKey } from './store';

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

/** Runs `fn` with an API client; an auth failure re-opens the token prompt and retries with the new token. */
export async function withApi<T>(reason: string, fn: (api: GithubApi) => Promise<T>): Promise<T> {
  const owner = currentPr().ref.owner;
  let api = await requireToken(owner, reason);
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

function updateThread(threadId: string, fn: (t: ThreadModel) => ThreadModel) {
  const t = threadById(usePr.getState().threads, threadId);
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
  updateThread(found.thread.id, (t) => ({ ...t, comments: t.comments.map((c) => (c.databaseId === databaseId ? fn(c) : c)) }));
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

/** Replies to a thread: REST reply, or a pending review reply while the viewer has a pending review. */
export async function submitReply(threadId: string, body: string): Promise<void> {
  const thread = threadById(usePr.getState().threads, threadId);
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
  updateThread(threadId, (t) => ({ ...t, comments: [...t.comments, comment] }));
  usePr.getState().clearDraft(draftKey.reply(threadId));
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

/** Resolves or unresolves a thread, optimistically; reverted on failure. */
export async function setResolved(threadId: string, resolved: boolean): Promise<void> {
  const thread = threadById(usePr.getState().threads, threadId);
  if (!thread || thread.isResolved === resolved) return;
  updateThread(threadId, (t) => ({ ...t, isResolved: resolved }));
  try {
    await withApi(resolved ? 'resolve a conversation' : 'unresolve a conversation', async (api) => {
      const id = await threadNodeId(api, thread);
      await (resolved ? api.resolve(id) : api.unresolve(id));
    });
  } catch (err) {
    updateThread(threadId, (t) => ({ ...t, isResolved: !resolved }));
    throw err;
  }
}

/** Message for an error shown inline. */
export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));
