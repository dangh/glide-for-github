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
import { scheduleRefresh } from '../../src/viewer/state/review';
import { session } from '../../src/viewer/state/session';
import { commitSuggestions } from '../../src/viewer/state/suggestions';
import { createPrStore, draftKey } from '../../src/viewer/state/store';
import { usePr } from '../../src/viewer/state/store';
import { Composer } from '../../src/viewer/ui/Composer';
import { FatalError } from '../../src/viewer/ui/Notice';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Commit ids as GitHub sends them (40 hex digits); `fetchHeadOid` rejects anything else. */
const HEAD1 = '1'.repeat(40);
const HEAD2 = '2'.repeat(40);
const HEAD3 = '3'.repeat(40);
const ABC = 'abc0'.repeat(10);

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
  headOid: HEAD1,
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

/** The `page_data/header` payload `fetchHeadOid` reads (abridged), with the given head. */
const header = (headSha: string) => ({ data: { pullRequest: { headSha, number: 7 }, mergeStatusButtonData: { headSha } }, link: null });

function fakeRpc(heads: () => string) {
  const calls: unknown[][] = [];
  const rpc = {
    call: vi.fn(async (...args: unknown[]) => {
      calls.push(args);
      return String(args[1]).endsWith('/page_data/header') ? header(heads()) : route(heads());
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
  it('accepts SHA-1 and SHA-256 commit ids from the header', async () => {
    for (const sha of ['0123456789abcdef0123456789abcdef01234567', 'f'.repeat(64)]) {
      const { rpc } = fakeRpc(() => sha);
      await expect(fetchHeadOid(rpc, pr.ref)).resolves.toBe(sha);
    }
  });

  it('reads the head from page_data/header (one small request, no route JSON, no diff loading)', async () => {
    const { rpc, calls } = fakeRpc(() => ABC);
    await expect(fetchHeadOid(rpc, pr.ref)).resolves.toBe(ABC);
    expect(calls).toHaveLength(1);
    expect(String(calls[0]![1])).toMatch(/\/pull\/7\/page_data\/header$/);
  });

  it('falls back to the route JSON when the header has no well-formed head sha or fails', async () => {
    const malformed = (headSha: unknown) => ({ data: { pullRequest: { headSha }, mergeStatusButtonData: { headSha } }, link: null });
    for (const answer of [
      { data: { pullRequest: {} }, link: null },
      { data: null, link: null },
      new Error('boom'),
      // Not a commit id: must not reach the head comparison (it would show a false "PR updated" banner).
      malformed('head1'),
      malformed(''),
      malformed('ABCDEF'.repeat(7).slice(0, 40)),
      malformed('a'.repeat(39)),
      malformed('a'.repeat(41)),
      malformed(12345),
    ]) {
      const calls: unknown[][] = [];
      const rpc = {
        call: vi.fn(async (...args: unknown[]) => {
          calls.push(args);
          if (!String(args[1]).endsWith('/page_data/header')) return route('fromroute');
          if (answer instanceof Error) throw answer;
          return answer;
        }),
      } as unknown as Rpc;
      await expect(fetchHeadOid(rpc, pr.ref)).resolves.toBe('fromroute');
      expect(calls).toHaveLength(2);
      expect(String(calls[1]![1])).toMatch(/\/pull\/7\/changes$/);
      expect(calls[1]![3]).toEqual({ dataRouter: true });
    }
  });
});

describe('freshness polling', () => {
  let head = HEAD1;
  beforeEach(() => {
    vi.useFakeTimers();
    head = HEAD1;
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
    head = HEAD2;
    await f.check();
    expect(usePr.getState().headMoved).toBe(true);
    expect(usePr.getState().pr).toBe(shownPr); // no auto reload: the PR data is untouched
    expect(calls.every((c) => String(c[1]).endsWith('/page_data/header'))).toBe(true); // header only: no route, no diff_entries
  });

  it('keeps drafts when the head moves', async () => {
    const { f } = make();
    usePr.getState().setDraft(draftKey.reviewSummary, { body: 'typing', updatedAt: 1 });
    head = HEAD2;
    await f.check();
    expect(usePr.getState().drafts.get(draftKey.reviewSummary)?.body).toBe('typing');
  });

  it('does not ask again once the head is known to have moved', async () => {
    const { f, calls } = make();
    head = HEAD2;
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
        return header(head);
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

  describe('write-triggered checks (coalesced)', () => {
    it('are debounced by 3 s: a burst of writes makes one check', async () => {
      const { f, calls } = make();
      f.noteWrite();
      await vi.advanceTimersByTimeAsync(1000);
      f.noteWrite();
      await vi.advanceTimersByTimeAsync(1000);
      f.noteWrite();
      await vi.advanceTimersByTimeAsync(2999);
      expect(calls).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(calls).toHaveLength(1); // not started: no interval, nothing else
      f.stop();
    });

    it('are skipped when the last check finished less than 10 s ago, and run again after that', async () => {
      const { f, calls } = make();
      await f.check();
      expect(calls).toHaveLength(1);
      f.noteWrite();
      await vi.advanceTimersByTimeAsync(3000); // 3 s after the last check: skipped
      expect(calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(8000); // t = 11 s
      f.noteWrite();
      await vi.advanceTimersByTimeAsync(3000);
      expect(calls).toHaveLength(2);
      f.stop();
    });

    it('join a check that is already in flight instead of starting another', async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let active = 0;
      let peak = 0;
      let total = 0;
      const rpc = {
        call: vi.fn(async () => {
          total++;
          peak = Math.max(peak, ++active);
          await gate;
          active--;
          return header(head);
        }),
      } as unknown as Rpc;
      const f = createFreshness({ rpc: () => rpc, doc: fakeDoc().doc });
      void f.check();
      await flush();
      f.noteWrite();
      await vi.advanceTimersByTimeAsync(3000);
      expect(total).toBe(1);
      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(total).toBe(1);
      expect(peak).toBe(1);
      f.stop();
    });

    it('do nothing while the tab is hidden (the check on becoming visible covers it), and stop() cancels a pending one', async () => {
      const hidden = make('hidden');
      hidden.f.noteWrite();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(hidden.calls).toHaveLength(0);

      const { f, calls, d } = make();
      f.noteWrite();
      d.set('hidden'); // hidden during the debounce
      await vi.advanceTimersByTimeAsync(3000);
      expect(calls).toHaveLength(0);
      f.noteWrite(); // (visible again below)
      d.set('visible');
      f.stop();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(calls).toHaveLength(0);
    });
  });

  it('drops a result that arrives after the PR was reloaded, and survives request errors', async () => {
    let release!: (heads: string) => void;
    const rpc = {
      call: vi.fn(() => new Promise((resolve) => (release = (h) => resolve(header(h))))),
    } as unknown as Rpc;
    const f = createFreshness({ rpc: () => rpc, doc: fakeDoc().doc });
    const pending = f.check();
    usePr.getState().setPr({ ...pr, headOid: HEAD2 }); // reloaded meanwhile
    release(HEAD2);
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
    head = HEAD3;
    noteWrite();
    await vi.advanceTimersByTimeAsync(3000);
    expect(calls).toHaveLength(1);
    expect(usePr.getState().headMoved).toBe(true);
    stop();
    usePr.setState({ headMoved: false });
    noteWrite();
    await vi.advanceTimersByTimeAsync(3000);
    expect(calls).toHaveLength(1);
  });

  describe('which writes trigger a check', () => {
    let routeCalls = 0;
    let headChecks = 0;
    let routeOpts: unknown[] = [];
    const installRpc = () => {
      routeCalls = 0;
      routeOpts = [];
      headChecks = 0;
      return {
        call: vi.fn(async (method: string, path: string, _query?: unknown, opts?: unknown) => {
          if (method === 'applySuggestions') return {};
          if (method === 'get' && String(path).endsWith('/page_data/header')) {
            headChecks++;
            return header(head);
          }
          if (method === 'get' && String(path).endsWith('/changes')) {
            routeCalls++;
            routeOpts.push(opts);
          }
          return route(head);
        }),
      } as unknown as Rpc;
    };
    beforeEach(() => {
      for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
      sessionStorage.clear();
    });
    afterEach(() => {
      session.rpc = undefined;
    });

    it('apply suggestions (the head-moving write) triggers one coalesced check after the commit', async () => {
      const rpc = installRpc();
      session.rpc = rpc;
      const stop = startFreshness({ rpc: () => rpc, doc: fakeDoc().doc });
      const ref = { commentId: 7, suggestionIndex: 0, path: 'a.ts', url: 'https://github.com/o/r/pull/7#discussion_r7' };
      usePr.getState().addToBatch(ref);
      await commitSuggestions([ref], 'm');
      expect(routeCalls).toBeGreaterThan(0); // the commit's own PR reload
      // A reload after a write never takes the route prefetched during page load.
      expect(routeOpts.every((o) => (o as { prefetched?: boolean } | undefined)?.prefetched !== true)).toBe(true);
      expect(headChecks).toBe(0);
      await vi.advanceTimersByTimeAsync(2999);
      expect(headChecks).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(headChecks).toBe(1);
      stop();
    });

    it('comment writes (scheduleRefresh), viewed, reactions and resolves do not poll', async () => {
      const rpc = installRpc();
      session.rpc = undefined; // scheduleRefresh then makes no request of its own
      const stop = startFreshness({ rpc: () => rpc, doc: fakeDoc().doc });
      scheduleRefresh(0);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(routeCalls + headChecks).toBe(0);
      stop();
    });
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
    store.getState().setPr({ ...pr, headOid: HEAD2 });
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

  it('a failing write removes the stale stored snapshot so a reload cannot restore outdated text', () => {
    const store = createPrStore();
    const stop = initDraftPersistence(store);
    store.getState().setPr(pr);
    store.getState().setDraft(draftKey.reviewSummary, { body: 'old text', updatedAt: 1 });
    expect(sessionStorage.getItem(draftsKeyName(pr.ref))).toContain('old text');
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    store.getState().setDraft(draftKey.reviewSummary, { body: 'newer text', updatedAt: 2 });
    set.mockRestore();
    expect(sessionStorage.getItem(draftsKeyName(pr.ref))).toBeNull();
    stop();
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

  it('reports "Reload the page to use Glide" when no port arrives within 5 s', async () => {
    const onTimeout = vi.fn();
    watchPort(new Promise(() => undefined), onTimeout);
    expect(PORT_TIMEOUT_MS).toBe(5000);
    await vi.advanceTimersByTimeAsync(4999);
    expect(onTimeout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onTimeout).toHaveBeenCalledWith(PORT_TIMEOUT_MESSAGE);
    expect(PORT_TIMEOUT_MESSAGE).toMatch(/^Reload the page to use Glide/);
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
