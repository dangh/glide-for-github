import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubApi } from '../../src/viewer/github/api';
import { classifyGraphqlErrors, classifyResponse, isAuthError, WriteError, type WriteErrorKind } from '../../src/viewer/github/errors';
import type { PrRef } from '../../src/shared/pr-url';

const TOKEN = 'ghp_SuperSecretTokenValue0123456789';
const ref: PrRef = { owner: 'dangh', repo: 'pierre-sandbox', number: 7, page: 'changes' };

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  init: RequestInit;
}
type Reply = Response | Error | { status?: number; json?: unknown; headers?: Record<string, string> };

/** Fake fetch: records every call and answers from a queue (a bare object is a JSON reply, 200 by default). */
function fakeFetch(...replies: Reply[]) {
  const calls: Call[] = [];
  const queue = [...replies];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k.toLowerCase()] = v));
    calls.push({
      url: String(input),
      method: init.method ?? 'GET',
      headers,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      init,
    });
    const reply = queue.shift();
    if (!reply) throw new Error('unexpected extra fetch');
    if (reply instanceof Error) throw reply;
    if (reply instanceof Response) return reply;
    const status = reply.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(reply.json ?? {}), { status, headers: reply.headers });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const gql = (data: unknown) => ({ json: { data } });
const gqlCall = (c: Call) => {
  const { query, variables } = c.body as { query: string; variables: Record<string, unknown> };
  const op = /\{\s*(\w+)/.exec(query.slice(query.indexOf('{')))?.[1];
  return { op, variables };
};

const consoleSpies = () =>
  (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));

beforeEach(() => {
  consoleSpies();
});
afterEach(() => vi.restoreAllMocks());

describe('GithubApi transport', () => {
  it('sends the token only to api.github.com, with the documented headers, no cookies', async () => {
    const { calls, fetchImpl } = fakeFetch({ json: { login: 'dangh' } }, gql({ repository: { pullRequest: { id: 'PR_1' } } }));
    const api = new GithubApi(TOKEN, ref, fetchImpl);
    await api.viewer();
    await api.prNodeId();
    for (const c of calls) {
      expect(new URL(c.url).origin).toBe('https://api.github.com');
      expect(c.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(c.headers.accept).toBe('application/vnd.github+json');
      expect(c.init.credentials).toBe('omit');
    }
    expect(calls[0]!.headers['x-github-api-version']).toBe('2022-11-28');
  });
});

describe('GithubApi reads', () => {
  it('viewer(): GET /user, scopes from X-OAuth-Scopes for classic tokens, null for fine-grained', async () => {
    const { calls, fetchImpl } = fakeFetch(
      { json: { login: 'dangh' }, headers: { 'X-OAuth-Scopes': 'repo, read:org' } },
      { json: { login: 'dangh' } },
      { json: { login: 'dangh' }, headers: { 'X-OAuth-Scopes': '' } },
    );
    const api = new GithubApi(TOKEN, ref, fetchImpl);
    expect(await api.viewer()).toEqual({ login: 'dangh', scopes: ['repo', 'read:org'] });
    expect(await api.viewer()).toEqual({ login: 'dangh', scopes: null });
    expect(await api.viewer()).toEqual({ login: 'dangh', scopes: [] });
    expect(calls[0]).toMatchObject({ url: 'https://api.github.com/user', method: 'GET' });
  });

  it('prNodeId(): GraphQL repository.pullRequest.id', async () => {
    const { calls, fetchImpl } = fakeFetch(gql({ repository: { pullRequest: { id: 'PR_node' } } }));
    expect(await new GithubApi(TOKEN, ref, fetchImpl).prNodeId()).toBe('PR_node');
    expect(calls[0]).toMatchObject({ url: 'https://api.github.com/graphql', method: 'POST' });
    expect((calls[0]!.body as { variables: unknown }).variables).toEqual({ owner: 'dangh', repo: 'pierre-sandbox', number: 7 });
  });

  it('threadNodeIds(): paginates reviewThreads(first:100) and keys by the first comment database id', async () => {
    const page = (nodes: unknown[], next: string | null) =>
      gql({ repository: { pullRequest: { reviewThreads: { nodes, pageInfo: { hasNextPage: next !== null, endCursor: next } } } } });
    const t = (id: string, dbId: number | null) => ({ id, comments: { nodes: dbId === null ? [] : [{ databaseId: dbId }] } });
    const { calls, fetchImpl } = fakeFetch(page([t('PRRT_1', 11), t('PRRT_2', 22)], 'cursor-1'), page([t('PRRT_3', 33), t('PRRT_x', null)], null));
    const map = await new GithubApi(TOKEN, ref, fetchImpl).threadNodeIds();
    expect([...map]).toEqual([
      [11, 'PRRT_1'],
      [22, 'PRRT_2'],
      [33, 'PRRT_3'],
    ]);
    expect(calls).toHaveLength(2);
    expect((calls[0]!.body as { query: string }).query).toContain('reviewThreads(first: 100');
    expect((calls[0]!.body as { variables: { after: unknown } }).variables.after).toBeNull();
    expect((calls[1]!.body as { variables: { after: unknown } }).variables.after).toBe('cursor-1');
  });

  it('pendingReview(): the viewer\'s pending review with its comment count, or null', async () => {
    const reviews = (nodes: unknown[]) => gql({ repository: { pullRequest: { reviews: { nodes } } } });
    const { calls, fetchImpl } = fakeFetch(
      reviews([
        { id: 'PRR_other', viewerDidAuthor: false, comments: { totalCount: 9 } },
        { id: 'PRR_mine', viewerDidAuthor: true, comments: { totalCount: 3 } },
      ]),
      reviews([]),
    );
    const api = new GithubApi(TOKEN, ref, fetchImpl);
    expect(await api.pendingReview()).toEqual({ nodeId: 'PRR_mine', count: 3 });
    expect(await api.pendingReview()).toBeNull();
    expect((calls[0]!.body as { query: string }).query).toContain('states: [PENDING]');
  });
});

describe('GithubApi REST writes', () => {
  const base = 'https://api.github.com/repos/dangh/pierre-sandbox';

  it('createComment: POST pulls/{n}/comments with snake_case body and RIGHT/LEFT sides', async () => {
    const { calls, fetchImpl } = fakeFetch({ status: 201, json: { id: 99, node_id: 'PRRC_99', body: 'hi' } });
    const api = new GithubApi(TOKEN, ref, fetchImpl);
    const created = await api.createComment({
      path: 'a.ts',
      line: 12,
      side: 'additions',
      startLine: 10,
      startSide: 'deletions',
      body: 'hi',
      commitId: 'abc123',
    });
    expect(created).toEqual({ id: 99, nodeId: 'PRRC_99' });
    expect(calls[0]).toMatchObject({ url: `${base}/pulls/7/comments`, method: 'POST' });
    expect(calls[0]!.headers['content-type']).toBe('application/json');
    expect(calls[0]!.body).toEqual({
      body: 'hi',
      commit_id: 'abc123',
      path: 'a.ts',
      line: 12,
      side: 'RIGHT',
      start_line: 10,
      start_side: 'LEFT',
    });
  });

  it('createComment: file-level comment sends subject_type and no line fields', async () => {
    const { calls, fetchImpl } = fakeFetch({ status: 201, json: { id: 1, node_id: 'n' } });
    await new GithubApi(TOKEN, ref, fetchImpl).createComment({ path: 'a.ts', subjectType: 'file', body: 'x', commitId: 'c' });
    expect(calls[0]!.body).toEqual({ body: 'x', commit_id: 'c', path: 'a.ts', subject_type: 'file' });
  });

  it('reply / editComment / deleteComment hit the documented endpoints', async () => {
    const { calls, fetchImpl } = fakeFetch(
      { status: 201, json: { id: 5, node_id: 'PRRC_5' } },
      { json: { id: 5, node_id: 'PRRC_5' } },
      { status: 204 },
    );
    const api = new GithubApi(TOKEN, ref, fetchImpl);
    expect(await api.reply(4, 'r')).toEqual({ id: 5, nodeId: 'PRRC_5' });
    expect(await api.editComment(5, 'e')).toEqual({ id: 5, nodeId: 'PRRC_5' });
    await expect(api.deleteComment(5)).resolves.toBeUndefined();
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['POST', `${base}/pulls/7/comments/4/replies`, { body: 'r' }],
      ['PATCH', `${base}/pulls/comments/5`, { body: 'e' }],
      ['DELETE', `${base}/pulls/comments/5`, undefined],
    ]);
  });
});

describe('GithubApi GraphQL mutations', () => {
  it('addReaction / removeReaction use GraphQL addReaction / removeReaction with subjectId', async () => {
    const { calls, fetchImpl } = fakeFetch(gql({ addReaction: { reaction: { content: 'EYES' } } }), gql({ removeReaction: { reaction: { content: 'EYES' } } }));
    const api = new GithubApi(TOKEN, ref, fetchImpl);
    await api.addReaction('PRRC_1', 'EYES');
    await api.removeReaction('PRRC_1', 'EYES');
    expect(calls.map(gqlCall)).toEqual([
      { op: 'addReaction', variables: { input: { subjectId: 'PRRC_1', content: 'EYES' } } },
      { op: 'removeReaction', variables: { input: { subjectId: 'PRRC_1', content: 'EYES' } } },
    ]);
    expect(calls.every((c) => (c.body as { query: string }).query.startsWith('mutation'))).toBe(true);
  });

  it('review mutations: names and variables', async () => {
    const { calls, fetchImpl } = fakeFetch(
      gql({ addPullRequestReview: { pullRequestReview: { id: 'PRR_1' } } }),
      gql({ addPullRequestReviewThread: { thread: { id: 'PRRT_1', comments: { nodes: [{ id: 'PRRC_1', databaseId: 71 }] } } } }),
      gql({ addPullRequestReviewThread: { thread: { id: 'PRRT_2', comments: { nodes: [{ id: 'PRRC_2', databaseId: 72 }] } } } }),
      gql({ addPullRequestReviewThreadReply: { comment: { id: 'PRRC_3', databaseId: 73 } } }),
      gql({ submitPullRequestReview: { pullRequestReview: { id: 'PRR_1' } } }),
      gql({ deletePullRequestReview: { pullRequestReview: { id: 'PRR_1' } } }),
    );
    const api = new GithubApi(TOKEN, ref, fetchImpl);
    expect(await api.startReview('PR_1', 'deadbeef')).toBe('PRR_1');
    expect(
      await api.addReviewThread('PRR_1', { path: 'a.ts', line: 5, side: 'deletions', startLine: 3, startSide: 'deletions', subjectType: 'line', body: 'b' }),
    ).toEqual({ threadNodeId: 'PRRT_1', commentNodeId: 'PRRC_1', commentDatabaseId: 71 });
    await api.addReviewThread('PRR_1', { path: 'a.ts', subjectType: 'file', side: 'additions', body: 'f' });
    expect(await api.addReviewReply('PRR_1', 'PRRT_1', 'rr')).toEqual({ nodeId: 'PRRC_3', databaseId: 73 });
    await api.submitReview('PRR_1', 'REQUEST_CHANGES', 'sum');
    await api.deleteReview('PRR_1');
    expect(calls.map(gqlCall)).toEqual([
      { op: 'addPullRequestReview', variables: { input: { pullRequestId: 'PR_1', commitOID: 'deadbeef' } } },
      {
        op: 'addPullRequestReviewThread',
        variables: {
          input: { pullRequestReviewId: 'PRR_1', path: 'a.ts', line: 5, side: 'LEFT', startLine: 3, startSide: 'LEFT', subjectType: 'LINE', body: 'b' },
        },
      },
      {
        op: 'addPullRequestReviewThread',
        variables: { input: { pullRequestReviewId: 'PRR_1', path: 'a.ts', side: 'RIGHT', subjectType: 'FILE', body: 'f' } },
      },
      {
        op: 'addPullRequestReviewThreadReply',
        variables: { input: { pullRequestReviewId: 'PRR_1', pullRequestReviewThreadId: 'PRRT_1', body: 'rr' } },
      },
      { op: 'submitPullRequestReview', variables: { input: { pullRequestReviewId: 'PRR_1', event: 'REQUEST_CHANGES', body: 'sum' } } },
      { op: 'deletePullRequestReview', variables: { input: { pullRequestReviewId: 'PRR_1' } } },
    ]);
  });

  it('viewed and resolve mutations: names and variables', async () => {
    const { calls, fetchImpl } = fakeFetch(
      gql({ markFileAsViewed: { pullRequest: { id: 'PR_1' } } }),
      gql({ unmarkFileAsViewed: { pullRequest: { id: 'PR_1' } } }),
      gql({ resolveReviewThread: { thread: { id: 'PRRT_1', isResolved: true } } }),
      gql({ unresolveReviewThread: { thread: { id: 'PRRT_1', isResolved: false } } }),
    );
    const api = new GithubApi(TOKEN, ref, fetchImpl);
    await api.markViewed('PR_1', 'src/a.ts');
    await api.unmarkViewed('PR_1', 'src/a.ts');
    await api.resolve('PRRT_1');
    await api.unresolve('PRRT_1');
    expect(calls.map(gqlCall)).toEqual([
      { op: 'markFileAsViewed', variables: { input: { pullRequestId: 'PR_1', path: 'src/a.ts' } } },
      { op: 'unmarkFileAsViewed', variables: { input: { pullRequestId: 'PR_1', path: 'src/a.ts' } } },
      { op: 'resolveReviewThread', variables: { input: { threadId: 'PRRT_1' } } },
      { op: 'unresolveReviewThread', variables: { input: { threadId: 'PRRT_1' } } },
    ]);
  });
});

describe('classifies auth failures', () => {
  const res = (status: number, headers: Record<string, string> = {}) => new Response(null, { status, headers });
  const kind = (r: Response, body: unknown = {}) => classifyResponse(r, body, 'dangh').kind;

  it('maps statuses and headers to kinds', () => {
    expect(kind(res(401), { message: 'Bad credentials' })).toBe('unauthorized');
    expect(kind(res(403, { 'X-GitHub-SSO': 'required; url=https://github.com/orgs/acme/sso?authorization_request=1' }), { message: 'Resource protected by organization SAML enforcement.' })).toBe('forbidden-sso');
    expect(kind(res(403), { message: 'Resource not accessible by personal access token' })).toBe('forbidden-scope');
    expect(kind(res(403, { 'X-Accepted-GitHub-Permissions': 'pull_requests=write' }), { message: 'Forbidden' })).toBe('forbidden-scope');
    // 404 is always not-found, whatever headers it has: it must not count as an auth error or re-open the prompt.
    expect(kind(res(404, { 'X-Accepted-GitHub-Permissions': 'pull_requests=read' }), { message: 'Not Found' })).toBe('not-found');
    expect(kind(res(404), { message: 'Resource not accessible by personal access token' })).toBe('not-found');
    expect(kind(res(404), { message: 'Not Found' })).toBe('not-found');
    expect(kind(res(409), { message: 'Conflict' })).toBe('conflict');
    expect(kind(res(422), { message: 'Validation Failed', errors: [{ message: 'line must be part of the diff' }] })).toBe('validation');
    expect(kind(res(429), {})).toBe('rate-limited');
    expect(kind(res(403, { 'X-RateLimit-Remaining': '0' }), { message: 'API rate limit exceeded' })).toBe('rate-limited');
    expect(kind(res(500), { message: 'oops' })).toBe('unknown');
  });

  it('carries status, owner, SSO url and validation detail', () => {
    const sso = classifyResponse(res(403, { 'X-GitHub-SSO': 'required; url=https://github.com/orgs/acme/sso?x=1' }), {}, 'acme');
    expect(sso).toBeInstanceOf(WriteError);
    expect(sso).toMatchObject({ name: 'WriteError', status: 403, owner: 'acme', ssoUrl: 'https://github.com/orgs/acme/sso?x=1' });
    const v = classifyResponse(res(422), { message: 'Validation Failed', errors: [{ message: 'line must be part of the diff' }] }, 'o');
    expect(v.message).toContain('line must be part of the diff');
  });

  it('classifies GraphQL error payloads', () => {
    const c = (type: string, message = 'm') => classifyGraphqlErrors([{ type, message }], 'o').kind;
    expect(c('NOT_FOUND')).toBe('not-found');
    expect(c('INSUFFICIENT_SCOPES')).toBe('forbidden-scope');
    expect(c('FORBIDDEN', 'Resource not accessible by personal access token')).toBe('forbidden-scope');
    // Genuine permission denials are not token problems.
    expect(c('FORBIDDEN', 'You do not have permission to resolve this thread')).toBe('forbidden');
    expect(c('RATE_LIMITED')).toBe('rate-limited');
    expect(c('UNPROCESSABLE', 'Could not resolve')).toBe('validation');
    expect(c('WHATEVER', 'Resource not accessible by personal access token')).toBe('forbidden-scope');
    expect(c('WHATEVER')).toBe('unknown');
  });

  it('GraphQL SSO: X-GitHub-SSO header or SAML message wins over FORBIDDEN', () => {
    const errors = [{ type: 'FORBIDDEN', message: 'Resource protected by organization SAML enforcement. You must grant your Personal Access token access to this organization.' }];
    const withHeader = classifyGraphqlErrors(errors, 'acme', undefined, 200, new Headers({ 'X-GitHub-SSO': 'required; url=https://github.com/orgs/acme/sso?x=1' }));
    expect(withHeader).toMatchObject({ kind: 'forbidden-sso', ssoUrl: 'https://github.com/orgs/acme/sso?x=1', status: 200 });
    expect(classifyGraphqlErrors([{ type: 'FORBIDDEN', message: 'anything' }], 'acme', undefined, 200, new Headers({ 'X-GitHub-SSO': 'required; url=https://github.com/x' })).kind).toBe('forbidden-sso');
    expect(classifyGraphqlErrors(errors, 'acme').kind).toBe('forbidden-sso'); // message alone
    // `partial-results` rides on successful responses and is not a block.
    expect(classifyGraphqlErrors([{ type: 'NOT_FOUND', message: 'x' }], 'acme', undefined, 200, new Headers({ 'X-GitHub-SSO': 'partial-results; organizations=1' })).kind).toBe('not-found');
  });

  it('isAuthError covers token problems only', () => {
    const mk = (kind: WriteError['kind']) => new WriteError(kind, 'm', { owner: 'o' });
    for (const k of ['no-token', 'unauthorized', 'forbidden-sso', 'forbidden-scope'] as const) expect(isAuthError(mk(k)), k).toBe(true);
    for (const k of ['forbidden', 'not-found', 'conflict', 'validation', 'rate-limited', 'network', 'unknown'] as const) expect(isAuthError(mk(k)), k).toBe(false);
    expect(isAuthError(new Error('x'))).toBe(false);
  });

  it('GithubApi throws WriteError with the right kind end to end', async () => {
    const cases: [Reply, WriteErrorKind][] = [
      [{ status: 401, json: { message: 'Bad credentials' } }, 'unauthorized'],
      [{ status: 403, json: { message: 'SAML' }, headers: { 'X-GitHub-SSO': 'required; url=https://github.com/orgs/o/sso' } }, 'forbidden-sso'],
      [{ status: 403, json: { message: 'Resource not accessible by personal access token' } }, 'forbidden-scope'],
      [{ status: 422, json: { message: 'Validation Failed' } }, 'validation'],
      [{ status: 409, json: { message: 'Conflict' } }, 'conflict'],
      [new TypeError('Failed to fetch'), 'network'],
      [{ status: 200, json: { data: null, errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible by personal access token' }] } }, 'forbidden-scope'],
      [
        {
          status: 200,
          json: { data: { resolveReviewThread: null }, errors: [{ type: 'FORBIDDEN', message: 'Resource protected by organization SAML enforcement.' }] },
          headers: { 'X-GitHub-SSO': 'required; url=https://github.com/orgs/o/sso' },
        },
        'forbidden-sso',
      ],
      [{ status: 200, json: { data: null, errors: [{ type: 'FORBIDDEN', message: 'You do not have permission to resolve this thread' }] } }, 'forbidden'],
      [{ status: 200, json: { data: { resolveReviewThread: null }, errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a node' }] } }, 'not-found'],
    ];
    for (const [reply, expected] of cases) {
      const { fetchImpl } = fakeFetch(reply);
      const err = await new GithubApi(TOKEN, ref, fetchImpl).resolve('PRRT_1').catch((e: unknown) => e);
      expect(err, expected).toBeInstanceOf(WriteError);
      expect((err as WriteError).kind).toBe(expected);
      expect((err as WriteError).owner).toBe('dangh');
    }
  });
});

describe('token confidentiality', () => {
  it('never appears in thrown errors or console output, even if the server or fetch echoes it', async () => {
    const spies = consoleSpies();
    const replies: Reply[] = [
      { status: 401, json: { message: `Bad credentials for ${TOKEN}` } },
      { status: 422, json: { message: 'Validation Failed', errors: [{ message: `token ${TOKEN} invalid` }] } },
      new TypeError(`request to https://api.github.com failed (Authorization: Bearer ${TOKEN})`),
      { status: 200, json: { errors: [{ type: 'FORBIDDEN', message: `nope ${TOKEN}` }] } },
    ];
    for (const reply of replies) {
      const { fetchImpl } = fakeFetch(reply);
      const err = (await new GithubApi(TOKEN, ref, fetchImpl).resolve('PRRT_1').catch((e: unknown) => e)) as WriteError;
      expect(err).toBeInstanceOf(WriteError);
      const dump = [err.message, String(err), err.stack ?? '', JSON.stringify(err), JSON.stringify(Object.entries(err))].join('\n');
      expect(dump).not.toContain(TOKEN);
      expect(dump).not.toContain(TOKEN.slice(4));
    }
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN);
  });

  it('no console output at all during successful calls', async () => {
    const spies = consoleSpies();
    const { fetchImpl } = fakeFetch({ json: { login: 'dangh' } });
    await new GithubApi(TOKEN, ref, fetchImpl).viewer();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
