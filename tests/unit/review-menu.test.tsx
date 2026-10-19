// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BridgeError } from '../../src/shared/rpc';
import { setToken, setTokenStorage, type TokenStorageArea } from '../../src/viewer/auth/tokens';
import type { FileSummary, PrData } from '../../src/viewer/github/private';
import type { CommentModel, ThreadModel } from '../../src/viewer/github/threads';
import { resetReviewCaches } from '../../src/viewer/state/review';
import { session } from '../../src/viewer/state/session';
import { draftKey, usePr } from '../../src/viewer/state/store';
import { BatchBar, CommitDialogHost } from '../../src/viewer/ui/ApplySuggestions';
import { FileHeader } from '../../src/viewer/ui/FileHeader';
import { ReviewMenu } from '../../src/viewer/ui/ReviewMenu';
import { Thread } from '../../src/viewer/ui/Thread';
import { TokenPromptHost } from '../../src/viewer/ui/TokenPrompt';
import { Notice, RefreshButton } from '../../src/viewer/ui/Notice';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TOKEN = 'ghp_ReviewMenuToken0123456789';
const HEAD = 'c'.repeat(40);
const file = (path: string): FileSummary => ({ path, digest: path, status: 'modified', additions: 1, deletions: 1, viewed: false, tooLarge: false, binary: false });
const basePr: PrData = {
  ref: { owner: 'dangh', repo: 'pierre-sandbox', number: 1, page: 'changes' },
  nodeId: 'PR_node',
  author: 'dangh',
  baseOid: 'b'.repeat(40),
  headOid: HEAD,
  commits: [],
  files: [file('src/a.ts')],
  viewer: { login: 'dangh', canApplySuggestion: true, canReview: true },
  threadMarkers: { threads: [], byPath: {} },
};
const SUGGEST = 'Please:\n```suggestion\nconst a = 2;\n```\n';
const comment = (databaseId: number, extra: Partial<CommentModel> = {}): CommentModel => ({
  databaseId,
  nodeId: `PRRC_${databaseId}`,
  author: { login: 'octo', avatarUrl: '' },
  body: SUGGEST,
  bodyHTML: '<p>Please:</p>',
  bodyVersion: 'v',
  createdAt: '2026-10-17T06:26:18Z',
  state: 'submitted',
  reactions: [],
  viewerCanUpdate: false,
  viewerCanDelete: false,
  url: `https://github.com/dangh/pierre-sandbox/pull/1#discussion_r${databaseId}`,
  ...extra,
});
const thread = (id: string, extra: Partial<ThreadModel> = {}): ThreadModel => ({
  id,
  path: 'src/a.ts',
  side: 'additions',
  line: 4,
  subject: 'line',
  isOutdated: false,
  isResolved: false,
  comments: [comment(Number(id) * 10)],
  viewerCanReply: true,
  ...extra,
});

function fakeArea(): TokenStorageArea {
  const data: Record<string, unknown> = {};
  return {
    get: async (key) => (key in data ? { [key]: structuredClone(data[key]) } : {}),
    set: async (items) => void Object.assign(data, structuredClone(items)),
  };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  setTokenStorage(fakeArea());
  await setToken('dangh', TOKEN, { login: 'dangh' });
  resetReviewCaches();
  session.rpc = undefined;
  usePr.getState().setPr(basePr);
  usePr.setState({ drafts: new Map(), threads: [], pendingReview: null, headMoved: false, suggestionBatch: [], notice: null });
  sessionStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  setTokenStorage(undefined);
  session.rpc = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const render = (el: React.ReactNode) => act(async () => root.render(el));
const buttons = (scope: ParentNode = document) => [...scope.querySelectorAll('button')];
const button = (name: string | RegExp, scope: ParentNode = document) =>
  buttons(scope).find((b) => (typeof name === 'string' ? b.textContent?.trim() === name : name.test(b.textContent ?? '')));
const click = (el: Element) => act(async () => (el as HTMLElement).click());
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const type = (el: HTMLTextAreaElement | HTMLInputElement, value: string) =>
  act(async () => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const panel = () => document.querySelector<HTMLElement>('.review-panel')!;
const reviewButton = () => document.querySelector<HTMLButtonElement>('[data-testid="review-button"]')!;
const radio = (value: string) => document.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`)!;
const gql = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body)) as { query: string; variables: { input: Record<string, unknown> } });

describe('ReviewMenu', () => {
  it('labels the button "Submit review" like GitHub ("Submit comments" on a closed PR), or "Review (N pending)"', async () => {
    await render(<ReviewMenu />);
    expect(reviewButton().textContent).toBe('Submit review');
    await act(async () => usePr.getState().setPr({ ...usePr.getState().pr!, state: 'closed' }));
    expect(reviewButton().textContent).toBe('Submit comments');
    await act(async () => usePr.getState().setPr({ ...usePr.getState().pr!, state: 'merged' }));
    expect(reviewButton().textContent).toBe('Submit review');
    await act(async () => usePr.getState().setPendingReview({ nodeId: 'PRR_1', count: 2 }));
    expect(reviewButton().textContent).toContain('Review (2 pending)');
  });

  it('closes when focus leaves the frame for the GitHub page (window blur)', async () => {
    await render(<ReviewMenu />);
    await click(reviewButton());
    expect(document.querySelector('.review-panel')).not.toBeNull();
    await act(async () => void window.dispatchEvent(new Event('blur')));
    expect(document.querySelector('.review-panel')).toBeNull();
  });

  it('the PR author cannot Approve or Request changes (GitHub\'s wording); Comment stays available', async () => {
    await render(<ReviewMenu />);
    await click(reviewButton());
    expect(radio('COMMENT').disabled).toBe(false);
    expect(radio('COMMENT').checked).toBe(true);
    expect(radio('APPROVE').disabled).toBe(true);
    expect(radio('REQUEST_CHANGES').disabled).toBe(true);
    expect(document.body.textContent).toContain("Pull request authors can't approve their own pull requests.");
    expect(document.body.textContent).toContain("Pull request authors can't request changes on their own pull requests.");
  });

  it('another reviewer can Approve: submit sends APPROVE with the summary (an empty review started first)', async () => {
    usePr.getState().setPr({ ...basePr, author: 'someone-else' });
    fetchMock.mockImplementation(async (_u: string, init: RequestInit) => {
      const q = String(JSON.parse(String(init.body)).query);
      if (q.includes('PendingReview')) return json(200, { data: { repository: { pullRequest: { reviews: { nodes: [] } } } } });
      if (q.includes('StartReview')) return json(200, { data: { addPullRequestReview: { pullRequestReview: { id: 'PRR_9' } } } });
      return json(200, { data: { submitPullRequestReview: { pullRequestReview: { id: 'PRR_9' } } } });
    });
    await render(<ReviewMenu />);
    await click(reviewButton());
    expect(radio('APPROVE').disabled).toBe(false);
    await click(radio('APPROVE'));
    await type(document.querySelector<HTMLTextAreaElement>('.review-menu textarea')!, 'Ship it');
    await click(button('Submit review', panel())!);
    await settle();
    await settle();
    expect(gql().at(-1)!.variables.input).toEqual({ pullRequestReviewId: 'PRR_9', event: 'APPROVE', body: 'Ship it' });
    expect(document.querySelector('.review-panel')).toBeNull(); // closed after success
    expect(usePr.getState().drafts.has(draftKey.reviewSummary)).toBe(false);
  });

  it('a summary typed less than a debounce ago is saved on pagehide (a real reload)', async () => {
    await render(<ReviewMenu />);
    await click(reviewButton());
    await type(document.querySelector<HTMLTextAreaElement>('.review-menu textarea')!, 'half typed summary');
    expect(usePr.getState().drafts.has(draftKey.reviewSummary)).toBe(false); // still inside the debounce
    window.dispatchEvent(new Event('pagehide'));
    expect(usePr.getState().drafts.get(draftKey.reviewSummary)?.body).toBe('half typed summary');
  });

  it('Comment needs a summary or pending comments; the summary is kept as the review-summary draft', async () => {
    await render(<ReviewMenu />);
    await click(reviewButton());
    expect(button('Submit review', panel())!.disabled).toBe(true);
    const ta = document.querySelector<HTMLTextAreaElement>('.review-menu textarea')!;
    await type(ta, 'Some notes');
    expect(button('Submit review', panel())!.disabled).toBe(false);
    await act(async () => void ta.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(usePr.getState().drafts.get(draftKey.reviewSummary)?.body).toBe('Some notes');
    // Closing and reopening keeps the text.
    await click(reviewButton());
    await click(reviewButton());
    expect(document.querySelector<HTMLTextAreaElement>('.review-menu textarea')!.value).toBe('Some notes');
  });

  it('a failed submit keeps the menu, the text, and shows the error with Retry', async () => {
    usePr.getState().setPendingReview({ nodeId: 'PRR_1', count: 1 });
    fetchMock.mockResolvedValue(json(200, { data: null, errors: [{ type: 'UNPROCESSABLE', message: 'Something went wrong' }] }));
    await render(<ReviewMenu />);
    await click(reviewButton());
    await type(document.querySelector<HTMLTextAreaElement>('.review-menu textarea')!, 'Keep me');
    await click(button('Submit review', panel())!);
    await settle();
    expect(document.querySelector('.review-menu [role="alert"]')!.textContent).toContain('Something went wrong');
    expect(button('Retry')).toBeDefined();
    expect(document.querySelector<HTMLTextAreaElement>('.review-menu textarea')!.value).toBe('Keep me');
    expect(usePr.getState().pendingReview).toEqual({ nodeId: 'PRR_1', count: 1 });
  });

  it('changing the choice or the summary clears a failed submit\'s error', async () => {
    usePr.getState().setPr({ ...basePr, author: 'someone-else' });
    usePr.getState().setPendingReview({ nodeId: 'PRR_1', count: 1 });
    fetchMock.mockResolvedValue(json(200, { data: null, errors: [{ type: 'UNPROCESSABLE', message: 'Something went wrong' }] }));
    await render(<ReviewMenu />);
    await click(reviewButton());
    const ta = () => document.querySelector<HTMLTextAreaElement>('.review-menu textarea')!;
    await click(radio('APPROVE'));
    await type(ta(), 'Looks good');
    await click(button('Submit review', panel())!);
    await settle();
    expect(gql().at(-1)!.variables.input).toMatchObject({ event: 'APPROVE', body: 'Looks good' });
    expect(button('Retry')).toBeDefined();

    // Changing the choice clears the stale error (and Retry with it).
    await click(radio('REQUEST_CHANGES'));
    expect(document.querySelector('.review-menu [role="alert"]')).toBeNull();

    // Fail again, then edit the summary: also clears the error.
    await click(button('Submit review', panel())!);
    await settle();
    expect(button('Retry')).toBeDefined();
    await type(ta(), 'Needs work');
    expect(document.querySelector('.review-menu [role="alert"]')).toBeNull();
  });

  it('Retry itself re-reads the radio and textarea (a click on a stale Retry cannot send old values)', async () => {
    usePr.getState().setPr({ ...basePr, author: 'someone-else' });
    usePr.getState().setPendingReview({ nodeId: 'PRR_1', count: 1 });
    let fail = true;
    fetchMock.mockImplementation(async () =>
      fail ? json(200, { data: null, errors: [{ type: 'UNPROCESSABLE', message: 'Something went wrong' }] }) : json(200, { data: { submitPullRequestReview: { pullRequestReview: { id: 'PRR_1' } } } }),
    );
    await render(<ReviewMenu />);
    await click(reviewButton());
    await click(radio('APPROVE'));
    await type(document.querySelector<HTMLTextAreaElement>('.review-menu textarea')!, 'First');
    await click(button('Submit review', panel())!);
    await settle();
    fail = false;
    // Edit without an input event (programmatic change): the error stays, so Retry is clickable.
    document.querySelector<HTMLTextAreaElement>('.review-menu textarea')!.value = 'Second';
    await click(button('Retry')!);
    await settle();
    await settle();
    expect(gql().at(-1)!.variables.input).toMatchObject({ event: 'APPROVE', body: 'Second' });
  });

  it('Discard pending review asks to confirm, then deletes the pending review', async () => {
    usePr.getState().setPendingReview({ nodeId: 'PRR_1', count: 3 });
    fetchMock.mockResolvedValue(json(200, { data: { deletePullRequestReview: { pullRequestReview: { id: 'PRR_1' } } } }));
    await render(<ReviewMenu />);
    await click(reviewButton());
    await click(button('Discard pending review')!);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('3 pending comments');
    await click(button('Discard review')!);
    await settle();
    expect(gql()[0]!.query).toContain('deletePullRequestReview');
    expect(gql()[0]!.variables.input).toEqual({ pullRequestReviewId: 'PRR_1' });
    expect(usePr.getState().pendingReview).toBeNull();
    expect(reviewButton().textContent).not.toContain('pending');
  });
});

describe('FileHeader Viewed', () => {
  it('does not show the previous PR Viewed failure after navigation', async () => {
    let fail!: (e: unknown) => void;
    session.rpc = { call: (() => new Promise((_, reject) => { fail = reject; })) as never };
    setTokenStorage(fakeArea());
    await render(<><FileHeader path="src/a.ts" /><Notice /></>);
    await click(container.querySelector<HTMLInputElement>('.fh-viewed input')!);
    await act(async () => usePr.getState().setPr({ ...basePr, ref: { ...basePr.ref, number: 2 } }));
    await act(async () => fail(new BridgeError({ status: 422, message: 'Old PR failure' })));
    await settle();
    expect(usePr.getState().notice).toBeNull();
    expect(document.querySelector('.toast-error')).toBeNull();
  });

  it('toggles at once and reverts with an error notice when GitHub and the session both fail', async () => {
    let fail!: (e: unknown) => void;
    session.rpc = { call: (() => new Promise((_, reject) => (fail = reject))) as never };
    setTokenStorage(fakeArea()); // no token: session path
    await render(
      <>
        <FileHeader path="src/a.ts" />
        <Notice />
        <TokenPromptHost />
      </>,
    );
    const box = container.querySelector<HTMLInputElement>('.fh-viewed input')!;
    await click(box);
    expect(box.checked).toBe(true);
    expect(usePr.getState().viewed.has('src/a.ts')).toBe(true);
    await act(async () => fail(new BridgeError({ status: 422, message: 'Nope' })));
    await settle();
    expect(box.checked).toBe(false);
    expect(document.querySelector('.toast-error')!.textContent).toContain('Nope');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('apply suggestion', () => {
  function fakeRpc(apply: () => Promise<unknown>) {
    const calls: unknown[][] = [];
    session.rpc = {
      call: (async (method: string, ...args: unknown[]) => {
        calls.push([method, ...args]);
        if (method === 'applySuggestions') return apply();
        throw new BridgeError({ status: 0, code: 'network', message: 'not in this test' });
      }) as never,
    };
    return calls;
  }
  const ui = () =>
    render(
      <>
        <Thread threadKey="10" />
        <Thread threadKey="20" />
        <BatchBar />
        <CommitDialogHost />
      </>,
    );

  it('does not reopen the previous PR suggestion dialog after remount', async () => {
    usePr.getState().setThreads([thread('1')]);
    await ui();
    await click(button('Commit suggestion')!);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await render(null);
    usePr.getState().setPr({ ...basePr, ref: { ...basePr.ref, number: 2 } });
    await ui();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('an old suggestion response cannot close a new dialog or show a success notice', async () => {
    let release!: () => void;
    fakeRpc(() => new Promise<void>(resolve => { release = resolve; }));
    usePr.getState().setThreads([thread('1')]);
    await ui();
    await click(button('Commit suggestion')!);
    await click(button('Commit changes')!);
    await render(null);
    usePr.getState().setPr({ ...basePr, ref: { ...basePr.ref, number: 2 } });
    usePr.getState().setThreads([thread('1')]);
    await ui();
    await click(button('Commit suggestion')!);
    await act(async () => release());
    await settle();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(usePr.getState().notice).toBeNull();
  });

  it('shows "Commit suggestion" and "Add suggestion to batch" only when the viewer can apply suggestions', async () => {
    usePr.getState().setThreads([thread('1'), thread('2', { comments: [comment(20, { body: 'no suggestion here' })] })]);
    await ui();
    expect(buttons().filter((b) => b.textContent === 'Commit suggestion')).toHaveLength(1);
    expect(buttons().filter((b) => b.textContent === 'Add suggestion to batch')).toHaveLength(1);
    await act(async () => usePr.getState().setPr({ ...basePr, viewer: { ...basePr.viewer, canApplySuggestion: false } }));
    await act(async () => usePr.getState().setThreads([thread('1')]));
    expect(button('Commit suggestion')).toBeUndefined();
  });

  it('commits one suggestion with the default message', async () => {
    usePr.getState().setThreads([thread('1')]);
    const calls = fakeRpc(async () => ({}));
    await ui();
    await click(button('Commit suggestion')!);
    const message = document.querySelector<HTMLInputElement>('[role="dialog"] input[name="commit-message"]')!;
    expect(message.value).toBe('Apply suggestions from code review');
    await click(button('Commit changes')!);
    await settle();
    const apply = calls.find((c) => c[0] === 'applySuggestions')!;
    expect(apply[1]).toMatchObject({ comments: [{ id: 10, suggestionIndex: 0 }], message: 'Apply suggestions from code review', expectedHeadOid: HEAD });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('batch: the bar shows the count and "Commit suggestions" sends them all; a head moved (409) keeps the batch', async () => {
    usePr.getState().setThreads([thread('1'), thread('2')]);
    const calls = fakeRpc(async () => {
      throw new BridgeError({ status: 409, code: 'HEAD_OID_MISMATCH', message: 'HTTP 409' });
    });
    await ui();
    for (const b of buttons().filter((x) => x.textContent === 'Add suggestion to batch')) await click(b);
    expect(document.querySelector('.batch-bar')!.textContent).toContain('2 suggestions');
    expect(buttons().filter((b) => b.textContent === 'Remove from batch')).toHaveLength(2);
    await click(button('Commit suggestions')!);
    await type(document.querySelector<HTMLInputElement>('[role="dialog"] input[name="commit-message"]')!, 'Tidy up');
    await click(button('Commit changes')!);
    await settle();
    expect(calls.find((c) => c[0] === 'applySuggestions')![1]).toMatchObject({ comments: [{ id: 10, suggestionIndex: 0 }, { id: 20, suggestionIndex: 0 }], message: 'Tidy up' });
    expect(usePr.getState().headMoved).toBe(true);
    expect(document.querySelector('[role="dialog"] [role="alert"]')!.textContent).toMatch(/head moved/i);
    expect(usePr.getState().suggestionBatch).toHaveLength(2);
    // While the head moved, committing again is pointless; the dialog offers the soft reload instead.
    expect(button('Commit changes')!.disabled).toBe(true);
    await click(button('Reload pull request')!);
    await settle();
    expect(calls.some((c) => c[0] === 'get' && c[1] === '/dangh/pierre-sandbox/pull/1/changes')).toBe(true);
    expect(usePr.getState().suggestionBatch).toHaveLength(2); // a soft reload never drops the batch
  });

  it("GitHub's Refresh button, shown once the pull request was pushed to, reloads softly (PR data via the bridge), keeping the batch", async () => {
    usePr.getState().setThreads([thread('1')]);
    const calls = fakeRpc(async () => ({}));
    usePr.getState().addToBatch({ commentId: 10, suggestionIndex: 0, path: 'src/a.ts', url: 'https://github.com/dangh/pierre-sandbox/pull/1#discussion_r10' });
    await render(<RefreshButton />);
    expect(button('Refresh')).toBeUndefined();
    await act(async () => usePr.getState().setHeadMoved(true));
    const refresh = document.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!;
    expect(refresh.textContent).toBe('Refresh');
    await click(refresh);
    await settle();
    expect(calls.some((c) => c[0] === 'get' && c[1] === '/dangh/pierre-sandbox/pull/1/changes')).toBe(true);
    expect(usePr.getState().suggestionBatch).toHaveLength(1);
  });

  it('any other failure shows the error and an "Open on GitHub" link to the comment', async () => {
    usePr.getState().setThreads([thread('1')]);
    fakeRpc(async () => {
      throw new BridgeError({ status: 422, message: 'Suggestion could not be applied' });
    });
    await ui();
    await click(button('Commit suggestion')!);
    await click(button('Commit changes')!);
    await settle();
    const alert = document.querySelector('[role="dialog"] [role="alert"]')!;
    expect(alert.textContent).toContain('Suggestion could not be applied');
    const link = alert.querySelector<HTMLAnchorElement>('a')!;
    expect(link.textContent).toBe('Open on GitHub');
    expect(link.href).toBe('https://github.com/dangh/pierre-sandbox/pull/1#discussion_r10');
  });
});
