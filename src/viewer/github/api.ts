/**
 * GitHub write client (REST + GraphQL) used with a user-supplied personal access token.
 *
 * Security: the token goes only to `https://api.github.com` (fixed origin below), in the Authorization header,
 * with `credentials: 'omit'` so no cookies ride along. It is never logged and never put in an Error: every
 * message that includes server/fetch text is passed through `redact`.
 *
 * REST version header: `X-GitHub-Api-Version: 2022-11-28` (supported until 2028-03-10 per
 * docs.github.com/en/rest/about-the-rest-api/api-versions; 2026-03-10 is newer but not needed by these endpoints).
 */
import type { PrRef } from '../../shared/pr-url';
import type { DiffSide } from './threads';
import { classifyGraphqlErrors, classifyResponse, networkError, WriteError, type GraphqlError, type Redact } from './errors';

const API = 'https://api.github.com';
export const REST_API_VERSION = '2022-11-28';

export type ReactionContent = 'THUMBS_UP' | 'THUMBS_DOWN' | 'LAUGH' | 'HOORAY' | 'CONFUSED' | 'HEART' | 'ROCKET' | 'EYES';
export type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';
export type SubjectType = 'line' | 'file';

export interface CommentTarget {
  path: string;
  /** End line on `side`; omit for a file-level comment. */
  line?: number;
  side?: DiffSide;
  startLine?: number;
  startSide?: DiffSide;
  subjectType?: SubjectType;
}

export interface CreateCommentParams extends CommentTarget {
  body: string;
  commitId: string;
}

export interface ThreadParams {
  path: string;
  line?: number;
  side: DiffSide;
  startLine?: number;
  startSide?: DiffSide;
  subjectType: SubjectType;
  body: string;
}

export interface RestComment {
  id: number;
  nodeId: string;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** `additions` → `RIGHT`, `deletions` → `LEFT`. */
const apiSide = (side: DiffSide): 'RIGHT' | 'LEFT' => (side === 'additions' ? 'RIGHT' : 'LEFT');

type Json = Record<string, unknown>;
const asObj = (v: unknown): Json => (typeof v === 'object' && v !== null ? (v as Json) : {});
const MAX_PAGES = 50;

const Q_PR_ID = `query PrNodeId($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) { pullRequest(number: $number) { id } }
}`;

const Q_THREADS = `query ThreadNodeIds($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) { pullRequest(number: $number) {
    reviewThreads(first: 100, after: $after) {
      nodes { id comments(first: 1) { nodes { databaseId } } }
      pageInfo { hasNextPage endCursor }
    }
  } }
}`;

const Q_PENDING = `query PendingReview($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) { pullRequest(number: $number) {
    reviews(states: [PENDING], first: 10) { nodes { id viewerDidAuthor comments { totalCount } } }
  } }
}`;

const M_ADD_REACTION = `mutation AddReaction($input: AddReactionInput!) {
  addReaction(input: $input) { reaction { content } }
}`;
const M_REMOVE_REACTION = `mutation RemoveReaction($input: RemoveReactionInput!) {
  removeReaction(input: $input) { reaction { content } }
}`;
const M_START_REVIEW = `mutation StartReview($input: AddPullRequestReviewInput!) {
  addPullRequestReview(input: $input) { pullRequestReview { id } }
}`;
const M_ADD_THREAD = `mutation AddReviewThread($input: AddPullRequestReviewThreadInput!) {
  addPullRequestReviewThread(input: $input) { thread { id comments(first: 1) { nodes { id databaseId } } } }
}`;
const M_ADD_REPLY = `mutation AddReviewReply($input: AddPullRequestReviewThreadReplyInput!) {
  addPullRequestReviewThreadReply(input: $input) { comment { id databaseId } }
}`;
const M_SUBMIT_REVIEW = `mutation SubmitReview($input: SubmitPullRequestReviewInput!) {
  submitPullRequestReview(input: $input) { pullRequestReview { id } }
}`;
const M_DELETE_REVIEW = `mutation DeleteReview($input: DeletePullRequestReviewInput!) {
  deletePullRequestReview(input: $input) { pullRequestReview { id } }
}`;
const M_MARK_VIEWED = `mutation MarkViewed($input: MarkFileAsViewedInput!) {
  markFileAsViewed(input: $input) { pullRequest { id } }
}`;
const M_UNMARK_VIEWED = `mutation UnmarkViewed($input: UnmarkFileAsViewedInput!) {
  unmarkFileAsViewed(input: $input) { pullRequest { id } }
}`;
const M_RESOLVE = `mutation ResolveThread($input: ResolveReviewThreadInput!) {
  resolveReviewThread(input: $input) { thread { id isResolved } }
}`;
const M_UNRESOLVE = `mutation UnresolveThread($input: UnresolveReviewThreadInput!) {
  unresolveReviewThread(input: $input) { thread { id isResolved } }
}`;

export class GithubApi {
  readonly #token: string;
  readonly #ref: PrRef;
  readonly #fetch: FetchLike;

  /** `fetchImpl` is a test seam; production uses the global `fetch` (called unbound, as browsers require). */
  constructor(token: string, ref: PrRef, fetchImpl?: FetchLike) {
    this.#token = token;
    this.#ref = ref;
    this.#fetch = fetchImpl ?? ((input, init) => fetch(input, init));
  }

  // ---- transport ---------------------------------------------------------------------------------

  readonly #redact: Redact = (text) => (this.#token ? text.split(this.#token).join('[token]') : text);

  get #repoPath(): string {
    return `/repos/${encodeURIComponent(this.#ref.owner)}/${encodeURIComponent(this.#ref.repo)}`;
  }

  async #send(path: string, method: string, body?: unknown): Promise<{ res: Response; json: unknown }> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.#token}`,
    };
    if (path !== '/graphql') headers['X-GitHub-Api-Version'] = REST_API_VERSION;
    const init: RequestInit = { method, headers, credentials: 'omit', cache: 'no-store' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let res: Response;
    try {
      res = await this.#fetch(`${API}${path}`, init);
    } catch {
      // The original error text is dropped on purpose: it can echo request headers.
      throw networkError(this.#ref.owner);
    }
    const text = await res.text().catch(() => '');
    let json: unknown = text;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        // keep text
      }
    } else json = undefined;
    if (!res.ok) throw classifyResponse(res, json, this.#ref.owner, this.#redact);
    return { res, json };
  }

  async #rest(method: string, path: string, body?: unknown): Promise<unknown> {
    return (await this.#send(path, method, body)).json;
  }

  async #graphql(query: string, variables: Record<string, unknown>): Promise<Json> {
    const { res, json } = await this.#send('/graphql', 'POST', { query, variables });
    const payload = asObj(json);
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      throw classifyGraphqlErrors(payload.errors as GraphqlError[], this.#ref.owner, this.#redact, res.status);
    }
    if (typeof payload.data !== 'object' || payload.data === null) throw this.#unexpected();
    return payload.data as Json;
  }

  #unexpected(): WriteError {
    return new WriteError('unknown', 'Unexpected response from GitHub.', { owner: this.#ref.owner });
  }

  #str(value: unknown): string {
    if (typeof value !== 'string' || !value) throw this.#unexpected();
    return value;
  }

  #restComment(json: unknown): RestComment {
    const c = asObj(json);
    if (typeof c.id !== 'number') throw this.#unexpected();
    return { id: c.id, nodeId: this.#str(c.node_id) };
  }

  get #prVars() {
    return { owner: this.#ref.owner, repo: this.#ref.repo, number: this.#ref.number };
  }

  // ---- reads / identity --------------------------------------------------------------------------

  /** GET /user. `scopes` come from `X-OAuth-Scopes` (classic tokens); null for fine-grained tokens (no such header). */
  async viewer(): Promise<{ login: string; scopes: string[] | null }> {
    const { res, json } = await this.#send('/user', 'GET');
    const header = res.headers.get('x-oauth-scopes');
    const scopes = header === null ? null : header.split(',').map((s) => s.trim()).filter(Boolean);
    return { login: this.#str(asObj(json).login), scopes };
  }

  /** GraphQL: the pull request's node id. */
  async prNodeId(): Promise<string> {
    const data = await this.#graphql(Q_PR_ID, this.#prVars);
    return this.#str(asObj(asObj(data.repository).pullRequest).id);
  }

  /** GraphQL `reviewThreads(first: 100)` paginated: first comment database id → thread node id. */
  async threadNodeIds(): Promise<Map<number, string>> {
    const map = new Map<number, string>();
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await this.#graphql(Q_THREADS, { ...this.#prVars, after });
      const threads = asObj(asObj(asObj(data.repository).pullRequest).reviewThreads);
      for (const node of Array.isArray(threads.nodes) ? threads.nodes : []) {
        const n = asObj(node);
        const first = asObj(Array.isArray(asObj(n.comments).nodes) ? (asObj(n.comments).nodes as unknown[])[0] : undefined);
        if (typeof n.id === 'string' && typeof first.databaseId === 'number') map.set(first.databaseId, n.id);
      }
      const info = asObj(threads.pageInfo);
      if (info.hasNextPage !== true || typeof info.endCursor !== 'string') break;
      after = info.endCursor;
    }
    return map;
  }

  /** GraphQL: the viewer's pending (draft) review on this PR with its comment count, or null. */
  async pendingReview(): Promise<{ nodeId: string; count: number } | null> {
    const data = await this.#graphql(Q_PENDING, this.#prVars);
    const nodes = asObj(asObj(asObj(data.repository).pullRequest).reviews).nodes;
    for (const node of Array.isArray(nodes) ? nodes : []) {
      const n = asObj(node);
      if (n.viewerDidAuthor !== true || typeof n.id !== 'string') continue;
      const total = asObj(n.comments).totalCount;
      return { nodeId: n.id, count: typeof total === 'number' ? total : 0 };
    }
    return null;
  }

  // ---- REST writes -------------------------------------------------------------------------------

  /** POST /repos/{o}/{r}/pulls/{n}/comments: a single (non-review) line, range or file comment. */
  async createComment(p: CreateCommentParams): Promise<RestComment> {
    const body: Json = { body: p.body, commit_id: p.commitId, path: p.path };
    if (p.line !== undefined) body.line = p.line;
    if (p.side) body.side = apiSide(p.side);
    if (p.startLine !== undefined) body.start_line = p.startLine;
    if (p.startSide) body.start_side = apiSide(p.startSide);
    if (p.subjectType) body.subject_type = p.subjectType;
    return this.#restComment(await this.#rest('POST', `${this.#repoPath}/pulls/${this.#ref.number}/comments`, body));
  }

  /** POST /repos/{o}/{r}/pulls/{n}/comments/{id}/replies */
  async reply(commentDbId: number, body: string): Promise<RestComment> {
    return this.#restComment(await this.#rest('POST', `${this.#repoPath}/pulls/${this.#ref.number}/comments/${commentDbId}/replies`, { body }));
  }

  /** PATCH /repos/{o}/{r}/pulls/comments/{id} */
  async editComment(dbId: number, body: string): Promise<RestComment> {
    return this.#restComment(await this.#rest('PATCH', `${this.#repoPath}/pulls/comments/${dbId}`, { body }));
  }

  /** DELETE /repos/{o}/{r}/pulls/comments/{id} (204) */
  async deleteComment(dbId: number): Promise<void> {
    await this.#rest('DELETE', `${this.#repoPath}/pulls/comments/${dbId}`);
  }

  // ---- GraphQL writes ----------------------------------------------------------------------------

  /** mutation addReaction(input: {subjectId, content}) */
  async addReaction(commentNodeId: string, content: ReactionContent): Promise<void> {
    await this.#graphql(M_ADD_REACTION, { input: { subjectId: commentNodeId, content } });
  }

  /** mutation removeReaction(input: {subjectId, content}) */
  async removeReaction(commentNodeId: string, content: ReactionContent): Promise<void> {
    await this.#graphql(M_REMOVE_REACTION, { input: { subjectId: commentNodeId, content } });
  }

  /** mutation addPullRequestReview(input: {pullRequestId, commitOID}) without `event`, i.e. a pending review. Returns its node id. */
  async startReview(prNodeId: string, commitOid: string): Promise<string> {
    const data = await this.#graphql(M_START_REVIEW, { input: { pullRequestId: prNodeId, commitOID: commitOid } });
    return this.#str(asObj(asObj(data.addPullRequestReview).pullRequestReview).id);
  }

  /** mutation addPullRequestReviewThread: a pending thread (line, range or file) in a review. */
  async addReviewThread(
    reviewNodeId: string,
    t: ThreadParams,
  ): Promise<{ threadNodeId: string; commentNodeId: string; commentDatabaseId: number }> {
    const input: Json = {
      pullRequestReviewId: reviewNodeId,
      path: t.path,
      side: apiSide(t.side),
      subjectType: t.subjectType.toUpperCase(),
      body: t.body,
    };
    if (t.line !== undefined) input.line = t.line;
    if (t.startLine !== undefined) input.startLine = t.startLine;
    if (t.startSide) input.startSide = apiSide(t.startSide);
    const data = await this.#graphql(M_ADD_THREAD, { input });
    const thread = asObj(asObj(data.addPullRequestReviewThread).thread);
    const comments = asObj(thread.comments).nodes;
    const first = asObj(Array.isArray(comments) ? comments[0] : undefined);
    if (typeof first.databaseId !== 'number') throw this.#unexpected();
    return { threadNodeId: this.#str(thread.id), commentNodeId: this.#str(first.id), commentDatabaseId: first.databaseId };
  }

  /** mutation addPullRequestReviewThreadReply: a pending reply to an existing thread. */
  async addReviewReply(reviewNodeId: string, threadNodeId: string, body: string): Promise<{ nodeId: string; databaseId: number }> {
    const data = await this.#graphql(M_ADD_REPLY, {
      input: { pullRequestReviewId: reviewNodeId, pullRequestReviewThreadId: threadNodeId, body },
    });
    const c = asObj(asObj(data.addPullRequestReviewThreadReply).comment);
    if (typeof c.databaseId !== 'number') throw this.#unexpected();
    return { nodeId: this.#str(c.id), databaseId: c.databaseId };
  }

  /** mutation submitPullRequestReview(input: {pullRequestReviewId, event, body}) */
  async submitReview(reviewNodeId: string, event: ReviewEvent, body: string): Promise<void> {
    await this.#graphql(M_SUBMIT_REVIEW, { input: { pullRequestReviewId: reviewNodeId, event, body } });
  }

  /** mutation deletePullRequestReview(input: {pullRequestReviewId}); only valid for a pending review. */
  async deleteReview(reviewNodeId: string): Promise<void> {
    await this.#graphql(M_DELETE_REVIEW, { input: { pullRequestReviewId: reviewNodeId } });
  }

  /** mutation markFileAsViewed(input: {pullRequestId, path}) */
  async markViewed(prNodeId: string, path: string): Promise<void> {
    await this.#graphql(M_MARK_VIEWED, { input: { pullRequestId: prNodeId, path } });
  }

  /** mutation unmarkFileAsViewed(input: {pullRequestId, path}) */
  async unmarkViewed(prNodeId: string, path: string): Promise<void> {
    await this.#graphql(M_UNMARK_VIEWED, { input: { pullRequestId: prNodeId, path } });
  }

  /** mutation resolveReviewThread(input: {threadId}) */
  async resolve(threadNodeId: string): Promise<void> {
    await this.#graphql(M_RESOLVE, { input: { threadId: threadNodeId } });
  }

  /** mutation unresolveReviewThread(input: {threadId}) */
  async unresolve(threadNodeId: string): Promise<void> {
    await this.#graphql(M_UNRESOLVE, { input: { threadId: threadNodeId } });
  }
}
