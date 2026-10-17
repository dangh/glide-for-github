// @vitest-environment jsdom
// (@pierre/diffs reads `navigator` at import time.)
import { describe, expect, it, vi } from 'vitest';
import type { BridgeMethods } from '../../src/shared/rpc';
import { fetchPrData, type FileSummary, type PrData, type Rpc } from '../../src/viewer/github/private';
import { createLoader, type LoaderOptions } from '../../src/viewer/state/loader';
import type { FileLoadResult } from '../../src/viewer/state/store';
import { decodePathsQuery, fakeRpc, ref } from './sandbox-fixtures';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The sandbox fake, with latency, recording in-flight `diff_entries` requests and their paths. */
function instrumented(opts: { latency?: number; fail?: (paths: string[]) => boolean } = {}) {
  const base = fakeRpc();
  const requests: string[][] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const rpc: Rpc = {
    async call<K extends keyof BridgeMethods & string>(method: K, ...args: Parameters<BridgeMethods[K]>): Promise<Awaited<ReturnType<BridgeMethods[K]>>> {
      const [path, query] = args as unknown as [string, { raw?: string } | undefined];
      const isEntries = method === 'get' && path.endsWith('/page_data/diff_entries');
      const paths = isEntries ? decodePathsQuery(query!.raw!).paths : [];
      if (isEntries) requests.push(paths);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await sleep(opts.latency ?? 2);
        if (isEntries && opts.fail?.(paths)) throw Object.assign(new Error('boom'), { status: 500 });
        return await base.call(method, ...args);
      } finally {
        inFlight--;
      }
    },
  };
  return { rpc, base, requests, get maxInFlight() { return maxInFlight; } };
}

async function setup(extra: Partial<LoaderOptions> = {}, rpcOpts: Parameters<typeof instrumented>[0] = {}) {
  const fake = instrumented(rpcOpts);
  const pr: PrData = await fetchPrData(fake.base, ref);
  const files = new Map(pr.files.map((f) => [f.path, f]));
  const results = new Map<string, FileLoadResult>();
  const batches: number[] = [];
  const loader = createLoader({
    rpc: fake.rpc,
    pr,
    whitespace: false,
    range: {},
    getSummary: (p) => files.get(p),
    onResults: (rs) => {
      batches.push(rs.length);
      for (const r of rs) {
        results.set(r.path, r);
        files.set(r.path, r.summary);
      }
    },
    ...extra,
  });
  return { fake, pr, loader, results, files, batches };
}

describe('diff loader', () => {
  it('fetches every file in order, small first request, never more than `concurrency` in flight', async () => {
    const { fake, pr, loader, results } = await setup({ concurrency: 2, firstChunkSize: 3 });
    loader.start();
    await loader.done;
    const order = pr.files.map((f) => f.path);
    expect(fake.requests[0]).toEqual(order.slice(0, 3));
    expect(fake.requests.flat()).toEqual(order); // file order, each path exactly once
    expect(fake.maxInFlight).toBeLessThanOrEqual(2);
    expect(results.size).toBe(order.length);
    expect(loader.stats.doneAt).toBeGreaterThanOrEqual(loader.stats.firstDiffAt!);
  });

  it('puts prioritized (visible) files at the front of the queue', async () => {
    const { fake, pr, loader } = await setup({ concurrency: 1, firstChunkSize: 1 });
    const order = pr.files.map((f) => f.path);
    loader.start(); // request 1 (first file) is in flight
    loader.prioritize(['src/whitespace.ts', 'src/obsolete.ts']);
    await loader.done;
    expect(fake.requests[0]).toEqual([order[0]]);
    expect(fake.requests[1]!.slice(0, 2)).toEqual(['src/whitespace.ts', 'src/obsolete.ts']);
    expect(new Set(fake.requests.flat()).size).toBe(order.length);
  });

  it('classifies binary, too large, collapsed (deleted), renamed and normal files', async () => {
    const { loader, results } = await setup();
    loader.start();
    await loader.done;
    const status = (p: string) => results.get(p)!.load;
    expect(status('assets/added.png').status).toBe('binary');
    expect(status('generated/big.generated.ts')).toMatchObject({ status: 'too-large', additions: 3000, deletions: 3000 });
    expect(status('src/obsolete.ts').status).toBe('needs-lines');
    expect(status('src/legacy/renamed-pure.ts')).toMatchObject({ status: 'loaded', empty: true });
    expect(results.get('src/legacy/renamed-pure.ts')!.summary.prevPath).toBeTruthy();
    expect(results.get('src/modern/helper-renamed.ts')!.diff!.prevName).toBeTruthy();
    expect(status('config/settings.json').status).toBe('loaded');
    expect(results.get('config/settings.json')!.diff!.hunks.length).toBeGreaterThan(0);
    expect(results.get('assets/added.png')!.diff).toBeUndefined();
  });

  it('loads collapsed lines lazily, only once the file is prioritized', async () => {
    const { fake, loader, results } = await setup();
    loader.start();
    await loader.done;
    const linesCalls = () => fake.base.calls.filter((c) => String(c.args[0]).endsWith('/diff_entry_lines')).length;
    expect(linesCalls()).toBe(0);
    loader.prioritize(['src/obsolete.ts']);
    await vi.waitFor(() => expect(results.get('src/obsolete.ts')!.load.status).toBe('loaded'));
    expect(results.get('src/obsolete.ts')!.diff!.type).toBe('deleted');
    expect(linesCalls()).toBe(1);
    loader.prioritize(['src/obsolete.ts']); // already loaded: no new request
    await sleep(10);
    expect(linesCalls()).toBe(1);
  });

  it('"Load diff" on a too-large file falls back to the full files when GitHub returns no lines', async () => {
    const fullFileDiff = vi.fn(async (s: FileSummary) => ({ name: s.path, hunks: [{}] }) as never);
    const loading: string[] = [];
    const { loader, results } = await setup({ fullFileDiff, onLoading: (paths, l) => l.loadingLines && loading.push(...paths) });
    loader.start();
    await loader.done;
    await loader.loadLines('generated/big.generated.ts');
    expect(loading).toEqual(['generated/big.generated.ts']);
    expect(fullFileDiff).toHaveBeenCalledTimes(1);
    expect(results.get('generated/big.generated.ts')!.load).toMatchObject({ status: 'loaded', additions: 3000 });
    expect(results.get('generated/big.generated.ts')!.diff).toBeTruthy();
  });

  it('"Load diff" over the size cap keeps the file too-large with tooBig', async () => {
    const { loader, results } = await setup({ fullFileDiff: async () => null });
    loader.start();
    await loader.done;
    await loader.loadLines('generated/big.generated.ts');
    expect(results.get('generated/big.generated.ts')!.load).toMatchObject({ status: 'too-large', tooBig: true, additions: 3000 });
    expect(results.get('generated/big.generated.ts')!.diff).toBeUndefined();
  });

  it('marks a failed chunk as error and retry re-queues it', async () => {
    let failing = true;
    const { fake, loader, results } = await setup(
      { concurrency: 1, firstChunkSize: 2 },
      { fail: (paths) => failing && paths.includes('assets/logo.png') },
    );
    loader.start();
    await loader.done;
    expect(results.get('assets/added.png')!.load).toMatchObject({ status: 'error', message: 'boom' });
    expect(results.get('assets/logo.png')!.load.status).toBe('error');
    expect(results.get('config/settings.json')!.load.status).toBe('loaded'); // later chunks unaffected
    failing = false;
    const before = fake.requests.length;
    loader.retry('assets/logo.png');
    await vi.waitFor(() => expect(results.get('assets/logo.png')!.load.status).toBe('binary'));
    expect(fake.requests.length).toBe(before + 1);
  });

  it('a file that fails to convert is an error on its own; the rest of its chunk loads', async () => {
    const { toFileDiff } = await import('../../src/viewer/github/convert');
    const convert: LoaderOptions['convert'] = (summary, lines, ctx) => {
      if (summary.path === 'docs/guide.md') throw new Error('bad patch');
      return toFileDiff(summary, lines, ctx);
    };
    const { loader, results } = await setup({ convert });
    loader.start();
    await loader.done;
    expect(results.get('docs/guide.md')!.load).toMatchObject({ status: 'error', message: 'bad patch' });
    expect(results.get('docs/changelog.md')!.load.status).toBe('loaded');
  });

  it('delivers conversions in time slices and stops after cancel', async () => {
    let t = 0;
    const yieldToMain = vi.fn(async () => undefined);
    const { loader, batches } = await setup({ concurrency: 1, firstChunkSize: 20, sliceMs: 1, now: () => (t += 1), yieldToMain });
    loader.start();
    await loader.done;
    expect(yieldToMain).toHaveBeenCalled();
    expect(Math.max(...batches)).toBeLessThan(20);

    const second = await setup({ concurrency: 1 });
    second.loader.start();
    second.loader.cancel();
    await second.loader.done;
    await sleep(20);
    expect(second.results.size).toBe(0);
  });
});
