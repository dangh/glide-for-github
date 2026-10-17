// @vitest-environment jsdom
// (@pierre/diffs reads `navigator` at import time.)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BridgeError, type BridgeMethods } from '../../src/shared/rpc';
import { fetchPrData, type FileSummary, type PrData, type Rpc } from '../../src/viewer/github/private';
import { FULL_DIFF_MAX_CHARS, FULL_DIFF_MAX_LINES, fullFileDiff, startLoader } from '../../src/viewer/state/controller';
import { session } from '../../src/viewer/state/session';
import { createPrStore } from '../../src/viewer/state/store';
import { decodePathsQuery, fakeRpc, ref } from './sandbox-fixtures';

afterEach(() => {
  session.loader?.cancel();
  session.loader = undefined;
  session.viewport = undefined;
});

/** The sandbox fake, recording the paths of each `diff_entries` request. */
function recording() {
  const base = fakeRpc();
  const requests: string[][] = [];
  const rpc: Rpc = {
    call<K extends keyof BridgeMethods & string>(method: K, ...args: Parameters<BridgeMethods[K]>) {
      const [path, query] = args as unknown as [string, { raw?: string } | undefined];
      if (method === 'get' && path.endsWith('/page_data/diff_entries')) requests.push(decodePathsQuery(query!.raw!).paths);
      return base.call(method, ...args);
    },
  };
  return { rpc, base, requests };
}

describe('startLoader', () => {
  it('replays the last viewport into a restarted loader (whitespace toggle), incl. lazy lines of collapsed files', async () => {
    const { rpc, base, requests } = recording();
    const store = createPrStore();
    store.getState().setPr(await fetchPrData(rpc, ref));

    const first = startLoader(rpc, false, store)!;
    await first.done;
    // The user scrolled to the bottom: the viewport reported these files.
    session.viewport = ['src/obsolete.ts', 'src/whitespace.ts'];
    first.prioritize(session.viewport);
    await vi.waitFor(() => expect(store.getState().load.get('src/obsolete.ts')!.status).toBe('loaded'));

    // Hide whitespace: a new loader, no scroll since.
    requests.length = 0;
    const linesBefore = base.calls.filter((c) => String(c.args[0]).endsWith('/diff_entry_lines')).length;
    const second = startLoader(rpc, true, store)!;
    expect(second).not.toBe(first);
    expect(requests[0]!.slice(0, 2)).toEqual(['src/obsolete.ts', 'src/whitespace.ts']);
    await second.done;
    // The deleted file in view loads its lines again without any further prioritize call.
    await vi.waitFor(() => expect(store.getState().load.get('src/obsolete.ts')!.status).toBe('loaded'));
    expect(base.calls.filter((c) => String(c.args[0]).endsWith('/diff_entry_lines')).length).toBe(linesBefore + 1);
    expect(store.getState().load.get('src/whitespace.ts')).toMatchObject({ status: 'loaded', empty: true });
  });
});

describe('fullFileDiff ("Load diff" fallback) size cap', () => {
  const pr = { ref, baseOid: 'base', headOid: 'head' } as PrData;
  const summary = (extra: Partial<FileSummary> = {}): FileSummary => ({
    path: 'gen/lock.json',
    digest: 'abc',
    status: 'modified',
    additions: 10,
    deletions: 10,
    viewed: false,
    tooLarge: true,
    binary: false,
    ...extra,
  });
  const textRpc = (text: (url: string) => string) => {
    const getText = vi.fn(async (url: string) => text(url));
    const rpc: Rpc = {
      call: ((method: string, ...args: unknown[]) => {
        if (method === 'getText') return getText(args[0] as string);
        return Promise.reject(new Error(`unexpected ${method}`));
      }) as Rpc['call'],
    };
    return { rpc, getText };
  };

  it('diffs small files', async () => {
    const { rpc } = textRpc((url) => (url.includes('/base/') ? 'a\nb\n' : 'a\nc\n'));
    const diff = await fullFileDiff(rpc, pr, {}, false, summary());
    expect(diff?.hunks.length).toBeGreaterThan(0);
  });

  it('skips the fetch when the changed lines alone exceed the line cap', async () => {
    const { rpc, getText } = textRpc(() => '');
    expect(await fullFileDiff(rpc, pr, {}, false, summary({ additions: FULL_DIFF_MAX_LINES, deletions: 1 }))).toBeNull();
    expect(getText).not.toHaveBeenCalled();
  });

  it('refuses over 1,000,000 characters or 20,000 lines combined', async () => {
    const half = 'x'.repeat(FULL_DIFF_MAX_CHARS / 2);
    const big = textRpc((url) => (url.includes('/base/') ? half : half + 'y'));
    expect(await fullFileDiff(big.rpc, pr, {}, false, summary())).toBeNull();

    const lines = (n: number) => Array.from({ length: n }, (_, i) => `l${i}`).join('\n');
    const many = textRpc((url) => (url.includes('/base/') ? lines(10_000) : lines(10_001)));
    expect(await fullFileDiff(many.rpc, pr, {}, false, summary())).toBeNull();

    const fits = textRpc((url) => (url.includes('/base/') ? lines(9_000) : lines(9_001)));
    expect(await fullFileDiff(fits.rpc, pr, {}, false, summary())).not.toBeNull();
  });

  it('treats a missing side (404) as empty', async () => {
    const rpc: Rpc = {
      call: ((method: string, url: string) =>
        url.includes('/base/')
          ? Promise.reject(new BridgeError({ status: 404, message: 'Not Found' }))
          : Promise.resolve('new\n')) as unknown as Rpc['call'],
    };
    const diff = await fullFileDiff(rpc, pr, {}, false, summary());
    expect(diff?.type).toBe('new');
  });
});
