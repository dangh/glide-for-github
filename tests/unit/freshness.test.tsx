// @vitest-environment jsdom
import { getSingularPatch } from '@pierre/diffs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PORT_TIMEOUT_MESSAGE, PORT_TIMEOUT_MS, watchPort } from '../../src/viewer/connection';
import { fetchHeadOid, type FileSummary, type PrData, type Rpc } from '../../src/viewer/github/private';
import { openComposer, targetFromRange } from '../../src/viewer/state/compose';
import { draftsKeyName, initDraftPersistence } from '../../src/viewer/state/drafts';
import { createFreshness, noteWrite, POLL_INTERVAL_MS, startFreshness } from '../../src/viewer/state/freshness';
import { createPrStore, draftKey } from '../../src/viewer/state/store';
import { usePr } from '../../src/viewer/state/store';
import { Composer } from '../../src/viewer/ui/Composer';
import { FatalError } from '../../src/viewer/ui/Notice';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const file = (path: string): FileSummary => ({
  path,
  digest: `d-${path}`,
  status: 'modified',
  additions: 1,
  deletions: 1,
  viewed: false,
  tooLarge: false,
  binary: false,
});

const pr: PrData = {
  ref: { owner: 'o', repo: 'r', number: 7, page: 'changes' },
  author: 'me',
  baseOid: 'base',
  headOid: 'head1',
  commits: [],
  files: [file('a.ts')],
  viewer: { login: 'me', canApplySuggestion: false, canReview: true },
  threadMarkers: { threads: [], byPath: {} },
};

/** The route payload `fetchRoute` reads, with the given head. */
const route = (headOid: string) => ({
  data: { payload: { pullRequestsChangesRoute: { diffSummaries: [], user: { currentUserLogin: 'me' }, pullRequest: { comparison: { baseOid: 'base', headOid } } } } },
  link: null,
});

function fakeRpc(heads: () => string) {
  const calls: unknown[][] = [];
  const rpc = {
    call: vi.fn(async (...args: unknown[]) => {
      calls.push(args);
      return route(heads());
    }),
  } as unknown as Rpc;
  return { rpc, calls };
}

function fakeDoc(initial: DocumentVisibilityState = 'visible') {
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: initial,
    addEventListener: (_t: string, fn: () => void) => void listeners.add(fn),
    removeEventListener: (_t: string, fn: () => void) => void listeners.delete(fn),
  };
  return {
    doc: doc as unknown as Document,
    set(state: DocumentVisibilityState) {
      doc.visibilityState = state;
      for (const fn of [...listeners]) fn();
    },
    listeners,
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('fetchHeadOid', () => {
  it('reads the head from the route JSON with one request and no diff loading', async () => {
    const { rpc, calls } = fakeRpc(() => 'abc');
    await expect(fetchHeadOid(rpc, pr.ref)).resolves.toBe('abc');
    expect(calls).toHaveLength(1);
    expect(String(calls[0]![1])).toMatch(/\/pull\/7\/changes$/);
    expect(calls[0]![3]).toEqual({ dataRouter: true });
  });
});

describe('freshness polling', () => {
  let head = 'head1';
  beforeEach(() => {
    vi.useFakeTimers();
    head = 'head1';
    usePr.setState({ headMoved: false, drafts: new Map() });
    usePr.getState().setPr(pr);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const make = (visibility: DocumentVisibilityState = 'visible') => {
    const { rpc, calls } = fakeRpc(() => head);
    const d = fakeDoc(visibility);
    const f = createFreshness({ rpc: () => rpc, doc: d.doc });
    return { f, calls, d, rpc };
  };

  it('a different head sets headMoved; the same head does not; nothing reloads', async () => {
    const { f, calls } = make();
    const shownPr = usePr.getState().pr;
    await f.check();
    expect(usePr.getState().headMoved).toBe(false);
    head = 'head2';
    await f.check();
    expect(usePr.getState().headMoved).toBe(true);
    expect(usePr.getState().pr).toBe(shownPr); // no auto reload: the PR data is untouched
    expect(calls.every((c) => String(c[1]).endsWith('/changes'))).toBe(true); // route only, no diff_entries
  });

  it('keeps drafts when the head moves', async () => {
    const { f } = make();
    usePr.getState().setDraft(draftKey.reviewSummary, { body: 'typing', updatedAt: 1 });
    head = 'head2';
    await f.check();
    expect(usePr.getState().drafts.get(draftKey.reviewSummary)?.body).toBe('typing');
  });

  it('does not ask again once the head is known to have moved', async () => {
    const { f, calls } = make();
    head = 'head2';
    await f.check();
    await f.check();
    expect(calls).toHaveLength(1);
  });

  it('polls every 60 s while visible', async () => {
    const { f, calls } = make();
    f.start();
    expect(POLL_INTERVAL_MS).toBe(60_000);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(2);
    f.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toHaveLength(2);
  });

  it('does not poll while the tab is hidden, and checks once as soon as it is visible again', async () => {
    const { f, calls, d } = make('hidden');
    f.start();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(calls).toHaveLength(0);
    d.set('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1); // the one immediate check
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(2);
    d.set('hidden');
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(calls).toHaveLength(2);
    f.stop();
    expect(d.listeners.size).toBe(0);
  });

  it('never polls while a previous poll is in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const calls: unknown[][] = [];
    const rpc = {
      call: vi.fn(async (...args: unknown[]) => {
        calls.push(args);
        await gate;
        return route(head);
      }),
    } as unknown as Rpc;
    const f = createFreshness({ rpc: () => rpc, doc: fakeDoc().doc });
    f.start();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(calls).toHaveLength(1);
    release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(2); // ticks during the poll did not queue extra requests
    f.stop();
  });

  it('a write triggers a check; writes during a poll cause one follow-up, not a parallel request', async () => {
    let release!: () => void;
    let gate = new Promise<void>((r) => (release = r));
    let active = 0;
    let peak = 0;
    let total = 0;
    const rpc = {
      call: vi.fn(async () => {
        total++;
        peak = Math.max(peak, ++active);
        await gate;
        active--;
        return route(head);
      }),
    } as unknown as Rpc;
    const f = createFreshness({ rpc: () => rpc, doc: fakeDoc().doc });
    f.noteWrite();
    f.noteWrite();
    f.noteWrite();
    await flush();
    expect(total).toBe(1);
    gate = Promise.resolve();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(total).toBe(2);
    expect(peak).toBe(1);
    f.stop();
  });

  it('a write while the tab is hidden does not poll', async () => {
    const { f, calls } = make('hidden');
    f.noteWrite();
    await flush();
    expect(calls).toHaveLength(0);
  });

  it('drops a result that arrives after the PR was reloaded, and survives request errors', async () => {
    let release!: (heads: string) => void;
    const rpc = {
      call: vi.fn(() => new Promise((resolve) => (release = (h) => resolve(route(h))))),
    } as unknown as Rpc;
    const f = createFreshness({ rpc: () => rpc, doc: fakeDoc().doc });
    const pending = f.check();
    usePr.getState().setPr({ ...pr, headOid: 'head2' }); // reloaded meanwhile
    release('head2');
    await pending;
    expect(usePr.getState().headMoved).toBe(false);

    const failing = { call: vi.fn().mockRejectedValue(new Error('offline')) } as unknown as Rpc;
    const g = createFreshness({ rpc: () => failing, doc: fakeDoc().doc });
    await expect(g.check()).resolves.toBeUndefined();
    expect(usePr.getState().headMoved).toBe(false);
    expect(usePr.getState().fatal).toBeNull(); // a failed poll is silent
  });

  it('the module-level noteWrite reaches the started instance and is a no-op otherwise', async () => {
    expect(() => noteWrite()).not.toThrow();
    const { rpc, calls } = fakeRpc(() => head);
    const stop = startFreshness({ rpc: () => rpc, doc: fakeDoc().doc });
    head = 'head3';
    noteWrite();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    expect(usePr.getState().headMoved).toBe(true);
    stop();
    usePr.setState({ headMoved: false });
    noteWrite();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
  });
});

describe('draft persistence (survives a page reload)', () => {
  beforeEach(() => sessionStorage.clear());

  it('writes non-empty drafts per PR to sessionStorage and a fresh viewer restores them', () => {
    const first = createPrStore();
    const stop = initDraftPersistence(first);
    first.getState().setPr(pr);
    first.getState().setDraft('a.ts:additions:-3', { body: 'new thread text', path: 'a.ts', side: 'additions', line: 3, subject: 'line', updatedAt: 5 });
    first.getState().setDraft(draftKey.reply('10'), { body: 'a reply', threadId: '10', updatedAt: 6 });
    first.getState().setDraft(draftKey.edit(11), { body: 'edited', databaseId: 11, updatedAt: 7 });
    first.getState().setDraft(draftKey.reviewSummary, { body: 'summary', updatedAt: 8 });
    first.getState().setDraft('a.ts:additions:-9', { body: '', path: 'a.ts', side: 'additions', line: 9, subject: 'line', updatedAt: 9 }); // just opened
    stop();
    expect(sessionStorage.getItem(draftsKeyName(pr.ref))).not.toBeNull();
    expect(draftsKeyName(pr.ref)).toContain('o/r#7');

    const second = createPrStore(); // the reloaded viewer
    const stop2 = initDraftPersistence(second);
    second.getState().setPr(pr);
    const drafts = second.getState().drafts;
    expect([...drafts.keys()].sort()).toEqual(['a.ts:additions:-3', 'edit:11', 'reply:10', 'review-summary'].sort());
    expect(drafts.get('a.ts:additions:-3')).toEqual({ body: 'new thread text', path: 'a.ts', side: 'additions', line: 3, subject: 'line', updatedAt: 5 });
    expect(drafts.get('reply:10')?.threadId).toBe('10');
    expect(drafts.get('edit:11')?.databaseId).toBe(11);
    expect(drafts.get(draftKey.reviewSummary)?.body).toBe('summary');
    stop2();
  });

  it('clearing a draft (posted or cancelled) removes it from storage; none left removes the entry', () => {
    const store = createPrStore();
    const stop = initDraftPersistence(store);
    store.getState().setPr(pr);
    store.getState().setDraft(draftKey.reviewSummary, { body: 'x', updatedAt: 1 });
    store.getState().setDraft(draftKey.reply('1'), { body: 'y', threadId: '1', updatedAt: 2 });
    store.getState().clearDraft(draftKey.reviewSummary);
    expect(JSON.parse(sessionStorage.getItem(draftsKeyName(pr.ref))!)).toHaveLength(1);
    store.getState().clearDraft(draftKey.reply('1'));
    expect(sessionStorage.getItem(draftsKeyName(pr.ref))).toBeNull();
    stop();
  });

  it('a soft reload (same PR set again) keeps the in-memory drafts and does not re-restore over them', () => {
    const store = createPrStore();
    const stop = initDraftPersistence(store);
    store.getState().setPr(pr);
    store.getState().setDraft(draftKey.reviewSummary, { body: 'typed', updatedAt: 1 });
    store.getState().setPr({ ...pr, headOid: 'head2' });
    expect(store.getState().drafts.get(draftKey.reviewSummary)?.body).toBe('typed');
    stop();
  });

  it('another PR has its own drafts', () => {
    const a = createPrStore();
    const stopA = initDraftPersistence(a);
    a.getState().setPr(pr);
    a.getState().setDraft(draftKey.reviewSummary, { body: 'for pr 7', updatedAt: 1 });
    stopA();
    const b = createPrStore();
    const stopB = initDraftPersistence(b);
    b.getState().setPr({ ...pr, ref: { ...pr.ref, number: 8 } });
    expect(b.getState().drafts.size).toBe(0);
    stopB();
  });

  it('ignores malformed storage and malformed entries', () => {
    sessionStorage.setItem(draftsKeyName(pr.ref), '{not json');
    const a = createPrStore();
    const stopA = initDraftPersistence(a);
    a.getState().setPr(pr);
    expect(a.getState().drafts.size).toBe(0);
    stopA();

    sessionStorage.setItem(
      draftsKeyName(pr.ref),
      JSON.stringify([
        ['ok', { body: 'fine', updatedAt: 1 }],
        ['no-body', { updatedAt: 1 }],
        ['bad-side', { body: 'x', side: 'sideways', updatedAt: 1 }],
        ['bad-line', { body: 'x', line: 'three', updatedAt: 1 }],
        [5, { body: 'x', updatedAt: 1 }],
        'junk',
      ]),
    );
    const b = createPrStore();
    const stopB = initDraftPersistence(b);
    b.getState().setPr(pr);
    expect([...b.getState().drafts.keys()]).toEqual(['ok']);
    stopB();
  });
});

describe('Composer flushes on pagehide', () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    usePr.getState().setPr(pr);
    usePr.setState({ drafts: new Map() });
    usePr.getState().applyLoads([{ path: 'a.ts', summary: pr.files[0]!, load: { status: 'loaded' }, diff: getSingularPatch(['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -1,1 +1,2 @@', ' one', '+two', ''].join('\n')) }]);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = '';
  });

  it('text typed less than a debounce ago is saved when the page is hidden for a reload', async () => {
    const key = openComposer(targetFromRange('a.ts', { start: 2, side: 'additions', end: 2 }));
    await act(async () => root.render(<Composer draftKey={key} mode="new" />));
    const el = container.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, 'half typed');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(usePr.getState().drafts.get(key)?.body).toBe('');
    window.dispatchEvent(new Event('pagehide'));
    expect(usePr.getState().drafts.get(key)?.body).toBe('half typed');
  });
});

describe('port timeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports "Reload the page to use Pierre" when no port arrives within 5 s', async () => {
    const onTimeout = vi.fn();
    watchPort(new Promise(() => undefined), onTimeout);
    expect(PORT_TIMEOUT_MS).toBe(5000);
    await vi.advanceTimersByTimeAsync(4999);
    expect(onTimeout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onTimeout).toHaveBeenCalledWith(PORT_TIMEOUT_MESSAGE);
    expect(PORT_TIMEOUT_MESSAGE).toMatch(/^Reload the page to use Pierre/);
  });

  it('stays quiet when the port arrives in time', async () => {
    const onTimeout = vi.fn();
    let resolve!: (v: string | undefined) => void;
    watchPort(new Promise<string | undefined>((r) => (resolve = r)), onTimeout);
    await vi.advanceTimersByTimeAsync(1000);
    resolve('light');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

describe('FatalError', () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = '';
  });

  it('shows the message, an "Open Files changed" link to GitHub, and Try again', async () => {
    const onRetry = vi.fn();
    await act(async () => root.render(<FatalError message="Unexpected route payload" filesUrl="https://github.com/o/r/pull/7/changes" onRetry={onRetry} />));
    expect(container.textContent).toContain('Unexpected route payload');
    const link = container.querySelector('a')!;
    expect(link.textContent).toBe('Open Files changed');
    expect(link.getAttribute('href')).toBe('https://github.com/o/r/pull/7/changes');
    const retry = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Try again')!;
    await act(async () => retry.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('has no Try again without a retry action (the reload-the-page case)', async () => {
    await act(async () => root.render(<FatalError message={PORT_TIMEOUT_MESSAGE} filesUrl="https://github.com/o/r/pull/7/changes" />));
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === 'Try again')).toBe(false);
    expect(container.querySelector('a')).not.toBeNull();
  });
});
