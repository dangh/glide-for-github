import { describe, expect, it } from 'vitest';
import {
  MAX_IN_FLIGHT,
  MAX_PATHS_PER_REQUEST,
  MAX_PATHS_QUERY_LENGTH,
  applyDiffEntry,
  chunkPaths,
  fetchDiffEntries,
  fetchDiffEntryLines,
  fetchDiffs,
  fetchFullFile,
  fetchPrData,
  fetchThreads,
  loadEntryLines,
  nextLink,
} from '../../src/viewer/github/private';
import { base, decodePathsQuery, fakeRpc, fixture, ref } from './sandbox-fixtures';

const route = fixture('route.json').payload.pullRequestsChangesRoute;
const allPaths: string[] = route.diffSummaries.map((s: { path: string }) => s.path);
const AWKWARD = ['docs/with space.md', 'src/a,b.ts', 'src/ünï/cödé.ts', 'src/hash#pct%.ts'];
const HEAD: string = fixture('meta.json').headOid;
const W0 = { whitespace: false, headOid: HEAD };

const rawQueries = (rpc: ReturnType<typeof fakeRpc>, suffix: string) =>
  rpc.calls
    .filter((c) => c.method === 'get' && c.args[0] === `${base}/page_data/${suffix}`)
    .map((c) => (c.args[1] as { raw: string }).raw);

describe('fetchPrData', () => {
  it('maps the route payload', async () => {
    const rpc = fakeRpc();
    const pr = await fetchPrData(rpc, ref);
    expect(pr.ref).toEqual(ref);
    expect(pr.nodeId).toBe(route.pullRequest.globalRelayId);
    expect(pr.nodeId).toMatch(/^PR_/);
    // Ids GitHub's composer sends to /preview (R§6); no pending review in the fixture.
    expect(pr.databaseId).toBe(route.pullRequest.id);
    expect(pr.repositoryId).toBe(route.repository.id);
    expect(typeof pr.databaseId).toBe('number');
    expect(pr.pendingReviewComments).toBeUndefined();
    expect(pr.author).toBe('dangh');
    expect(pr.baseOid).toBe(route.comparison.fullDiff.baseOid);
    expect(pr.headOid).toBe(route.comparison.fullDiff.headOid);
    expect(pr.headOid).toBe(fixture('meta.json').headOid);
    expect(pr.commits).toHaveLength(4);
    expect(pr.commits[3]).toEqual({ oid: pr.headOid, shortOid: pr.headOid.slice(0, 7), message: 'Flip clamp guard comparison' });
    expect(pr.viewer).toEqual({ login: 'dangh', canApplySuggestion: true, canReview: true });
    // the route call uses the data-router header
    expect(rpc.calls[0]).toEqual({ method: 'get', args: [`${base}/changes`, {}, { dataRouter: true }] });
  });

  it('asks for the prefetched route only when told to (the viewer\'s first load); thread reads never do', async () => {
    const first = fakeRpc();
    await fetchPrData(first, ref, { prefetched: true });
    expect(first.calls[0]).toEqual({ method: 'get', args: [`${base}/changes`, {}, { dataRouter: true, prefetched: true }] });
    const threads = fakeRpc();
    await fetchThreads(threads, ref).catch(() => undefined);
    const routeReads = threads.calls.filter((c) => String(c.args[0]).endsWith('/changes'));
    expect(routeReads.length).toBeGreaterThan(0);
    for (const c of routeReads) expect(c.args[2]).toEqual({ dataRouter: true });
  });

  it('builds file summaries in GitHub order with statuses, counts and digests', async () => {
    const pr = await fetchPrData(fakeRpc(), ref);
    expect(pr.files.map((f) => f.path)).toEqual(allPaths);
    const by = new Map(pr.files.map((f) => [f.path, f]));
    expect(by.get('assets/added.png')).toMatchObject({ status: 'added', binary: true, tooLarge: false });
    expect(by.get('assets/logo.png')).toMatchObject({ status: 'modified', binary: true });
    expect(by.get('src/obsolete.ts')).toMatchObject({ status: 'deleted', additions: 0, deletions: 6, binary: false });
    expect(by.get('src/util/math.ts')).toMatchObject({ status: 'modified', additions: 7, deletions: 0, viewed: false });
    expect(by.get('src/modern/helper-renamed.ts')).toMatchObject({ status: 'renamed', additions: 2, deletions: 2 });
    // embedded in diffContents: old path known up front
    expect(by.get('assets/logo.png')!.prevPath).toBeUndefined();
    expect(by.get('src/util/math.ts')!.prevPath).toBeUndefined();
    expect(by.get('src/util/math.ts')!.digest).toBe(route.diffSummaries.find((s: { path: string }) => s.path === 'src/util/math.ts').pathDigest);
  });

  it('makes only the route request; prevPath of renames not embedded arrives with applyDiffEntry', async () => {
    const rpc = fakeRpc();
    const pr = await fetchPrData(rpc, ref);
    expect(rpc.calls).toHaveLength(1);
    const pure = pr.files.find((f) => f.path === 'src/legacy/renamed-pure.ts')!;
    expect(pure).toMatchObject({ status: 'renamed' });
    expect(pure.prevPath).toBeUndefined();
    const entries = await fetchDiffEntries(rpc, ref, [pure.path], W0);
    expect(applyDiffEntry(pure, entries.get(pure.path)!).prevPath).toBe('src/legacy/old-name.ts');
  });

  it('keeps the embedded thread markers for fetchThreads', async () => {
    const pr = await fetchPrData(fakeRpc(), ref);
    expect(pr.threadMarkers.threads.map((t) => t.id).sort()).toEqual(['2910292349', '2910292404', '2910292428']);
    expect(Object.keys(pr.threadMarkers.byPath).sort()).toEqual(['docs/with space.md', 'src/components/Button.ts']);
  });
});

describe('fetchDiffs', () => {
  it('returns lines for every requested path with one request per chunk (collapsed files stay empty)', async () => {
    const rpc = fakeRpc();
    const diffs = await fetchDiffs(rpc, ref, allPaths, W0);
    expect([...diffs.keys()]).toEqual(allPaths);
    expect(diffs.get('src/obsolete.ts')).toEqual([]);
    expect(diffs.get('generated/big.generated.ts')).toEqual([]);
    expect(diffs.get('assets/logo.png')).toEqual([]);
    expect(diffs.get('src/util/math.ts')!.filter((l) => l.type === 'ADDITION')).toHaveLength(7);
    expect(rpc.calls.map((c) => c.args[0])).toEqual([`${base}/page_data/diff_entries`]);
  });

  it('defaults range to the head oid, like the GitHub client', async () => {
    const rpc = fakeRpc();
    await fetchDiffs(rpc, ref, ['src/util/math.ts'], W0);
    expect(decodePathsQuery(rawQueries(rpc, 'diff_entries')[0]!).params.get('range')).toBe(HEAD);
  });

  it('sends w=1 and range when asked', async () => {
    const rpc = fakeRpc();
    const diffs = await fetchDiffs(rpc, ref, ['src/whitespace.ts'], { whitespace: true, headOid: HEAD, range: 'abc123' });
    const params = decodePathsQuery(rawQueries(rpc, 'diff_entries')[0]!).params;
    expect(params.get('w')).toBe('1');
    expect(params.get('range')).toBe('abc123');
    expect(diffs.get('src/whitespace.ts')!.some((l) => l.type === 'ADDITION' || l.type === 'DELETION')).toBe(false);
  });

  it('encodes awkward paths', async () => {
    const rpc = fakeRpc();
    const diffs = await fetchDiffs(rpc, ref, AWKWARD, W0);
    const [raw] = rawQueries(rpc, 'diff_entries');
    // Per-path tokens of the `paths` value, exactly as they appear on the wire (`,` is sent as %2C).
    const tokens = (query: string) => new Map(
      (/(?:^|&)paths=([^&]*)/.exec(query)![1]!).split('%2C').map((t) => [decodeURIComponent(decodeURIComponent(t)), t] as const),
    );
    const ours = tokens(raw!);
    // What GitHub's own client sent while loading the sandbox PR (captured by scripts/capture-fixtures.mjs).
    const github = new Map<string, string>();
    for (const url of fixture('github-requests.json').diffEntries as string[]) {
      for (const [p, t] of tokens(url.slice(url.indexOf('?') + 1))) github.set(p, t);
    }
    const captured = AWKWARD.filter((p) => github.has(p));
    expect(captured).toEqual(['src/a,b.ts', 'src/ünï/cödé.ts', 'src/hash#pct%.ts']);
    for (const p of captured) expect(ours.get(p)).toBe(github.get(p));
    // GitHub's client never requests `docs/with space.md` (it is embedded in the route's diffContents);
    // its token follows the same rule, and the server accepted it during capture.
    expect(ours.get('docs/with space.md')).toBe('docs%252Fwith%2520space.md');
    expect(fixture('diff-entries-w0.json').data.some((e: { path: string }) => e.path === 'docs/with space.md')).toBe(true);
    // results keyed by the exact original paths
    expect([...diffs.keys()]).toEqual(AWKWARD);
    for (const p of AWKWARD) expect(diffs.get(p)!.length).toBeGreaterThan(0);
  });

  it('fills paths GitHub omits (no changes in that range) with empty lines', async () => {
    const rpc = fakeRpc((path) => (path.endsWith('/diff_entries') ? { data: [], link: null } : undefined));
    const diffs = await fetchDiffs(rpc, ref, ['src/util/math.ts'], W0);
    expect(diffs.get('src/util/math.ts')).toEqual([]);
  });

  it('chunks requests: <= 20 paths and <= 6,000 chars of encoded paths each, at most 6 in flight', async () => {
    const paths = Array.from({ length: 150 }, (_, i) => `dir ${i % 7}/ünï${'x'.repeat((i * 37) % 260)}#${i}.ts`);
    let inFlight = 0;
    let maxInFlight = 0;
    const rpc = fakeRpc(async (path) => {
      if (!path.endsWith('/diff_entries')) return undefined;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { data: [], link: null };
    });
    const diffs = await fetchDiffs(rpc, ref, paths, W0);
    const raws = rawQueries(rpc, 'diff_entries');
    const requested: string[] = [];
    for (const raw of raws) {
      const value = /(?:^|&)paths=([^&]*)/.exec(raw)![1]!;
      expect(value.length).toBeLessThanOrEqual(MAX_PATHS_QUERY_LENGTH);
      const { paths: chunk } = decodePathsQuery(raw);
      expect(chunk.length).toBeLessThanOrEqual(MAX_PATHS_PER_REQUEST);
      requested.push(...chunk);
    }
    expect(requested).toEqual(paths);
    expect(raws.length).toBeGreaterThan(paths.length / MAX_PATHS_PER_REQUEST);
    expect(maxInFlight).toBeLessThanOrEqual(MAX_IN_FLIGHT);
    expect(maxInFlight).toBeGreaterThan(1);
    expect([...diffs.keys()]).toEqual(paths);
  });

  it('chunkPaths keeps order and puts an over-long single path alone', () => {
    const long = 'a/'.repeat(4000);
    expect(chunkPaths(['x', long, 'y'])).toEqual([['x'], [long], ['y']]);
    expect(chunkPaths([])).toEqual([]);
  });

  it('retries a failed chunk once', async () => {
    let failures = 0;
    const rpc = fakeRpc((path) => {
      if (path.endsWith('/diff_entries') && failures === 0) {
        failures++;
        throw { status: 502, message: 'Bad gateway' };
      }
      return undefined;
    });
    const diffs = await fetchDiffs(rpc, ref, ['src/util/math.ts'], W0);
    expect(diffs.get('src/util/math.ts')!.length).toBeGreaterThan(0);
    expect(rawQueries(rpc, 'diff_entries')).toHaveLength(2);
  });

  it('rejects the whole call when a chunk fails twice', async () => {
    const paths = Array.from({ length: 45 }, (_, i) => `f${i}.ts`);
    const rpc = fakeRpc((path, query) => {
      if (!path.endsWith('/diff_entries')) return undefined;
      if (decodePathsQuery((query as { raw: string }).raw).paths.includes('f25.ts')) throw { status: 500, message: 'boom' };
      return { data: [], link: null };
    });
    await expect(fetchDiffs(rpc, ref, paths, W0)).rejects.toMatchObject({ status: 500 });
    const failing = rawQueries(rpc, 'diff_entries').filter((r) => decodePathsQuery(r).paths.includes('f25.ts'));
    expect(failing).toHaveLength(2);
  });
});

describe('fetchDiffEntries / applyDiffEntry', () => {
  it('exposes the explicit binary and too-large flags and the old path of renames', async () => {
    const entries = await fetchDiffEntries(fakeRpc(), ref, allPaths, W0);
    expect(entries.get('generated/big.generated.ts')).toMatchObject({ tooLarge: true, binary: false, lines: [], additions: 3000, deletions: 3000 });
    expect(entries.get('assets/added.png')).toMatchObject({ binary: true, tooLarge: false });
    expect(entries.get('src/legacy/renamed-pure.ts')!.prevPath).toBe('src/legacy/old-name.ts');
    expect(entries.get('src/util/math.ts')!.prevPath).toBeUndefined();
    // deleted files come back with empty lines and isTooBig false: not too large
    expect(entries.get('src/obsolete.ts')).toMatchObject({ tooLarge: false, binary: false, needsLines: true, lines: [], deletions: 6 });
    expect(entries.get('generated/big.generated.ts')!.needsLines).toBe(false);
    expect(entries.get('src/util/math.ts')!.needsLines).toBe(false);
  });

  it('loadEntryLines loads a collapsed (deleted) file on demand, retrying once', async () => {
    let failures = 0;
    const rpc = fakeRpc((path) => {
      if (path.endsWith('/diff_entry_lines') && failures++ === 0) throw { status: 502, message: 'Bad gateway' };
      return undefined;
    });
    const entries = await fetchDiffEntries(rpc, ref, ['src/obsolete.ts'], W0);
    const loaded = await loadEntryLines(rpc, ref, entries.get('src/obsolete.ts')!, W0);
    expect(loaded).toMatchObject({ needsLines: false, deletions: 6 });
    expect(loaded.lines.filter((l) => l.type === 'DELETION')).toHaveLength(6);
    const lineCalls = rpc.calls.filter((c) => c.args[0] === `${base}/page_data/diff_entry_lines`);
    expect(lineCalls.map((c) => c.args[1])).toEqual([
      { path: 'src/obsolete.ts', w: '0', range: HEAD },
      { path: 'src/obsolete.ts', w: '0', range: HEAD },
    ]);
  });

  it('marks the too-large sandbox file once its entry is applied', async () => {
    const rpc = fakeRpc();
    const pr = await fetchPrData(rpc, ref);
    const big = pr.files.find((f) => f.path === 'generated/big.generated.ts')!;
    expect(big.tooLarge).toBe(false); // not embedded in the route: unknown until its entry loads
    const entries = await fetchDiffEntries(rpc, ref, [big.path], W0);
    const applied = applyDiffEntry(big, entries.get(big.path)!);
    expect(applied).toMatchObject({ tooLarge: true, binary: false, additions: 3000, deletions: 3000 });
    expect(entries.get(big.path)!.lines).toEqual([]);
  });
});

describe('fetchDiffEntryLines', () => {
  it('requests path, w, range and context ranges like GitHub', async () => {
    const rpc = fakeRpc();
    const lines = await fetchDiffEntryLines(rpc, ref, 'src/obsolete.ts', { ...W0, range: 'abc', contextRanges: [{ start: 1, end: 6 }] });
    expect(lines).toHaveLength(7);
    expect(rpc.calls.at(-1)!.args).toEqual([
      `${base}/page_data/diff_entry_lines`,
      { path: 'src/obsolete.ts', w: '0', range: 'abc', 'context_line_ranges[]': ['{"start":1,"end":6}'] },
    ]);
  });
});

describe('fetchFullFile', () => {
  it('fetches the raw URL with each path segment encoded', async () => {
    const rpc = fakeRpc();
    const oid = 'a'.repeat(40);
    for (const [path, encoded] of [
      ['docs/with space.md', 'docs/with%20space.md'],
      ['src/a,b.ts', 'src/a%2Cb.ts'],
      ['src/ünï/cödé.ts', 'src/%C3%BCn%C3%AF/c%C3%B6d%C3%A9.ts'],
      ['src/hash#pct%.ts', 'src/hash%23pct%25.ts'],
    ] as const) {
      const text = await fetchFullFile(rpc, ref, path, oid);
      const url = `https://github.com/dangh/pierre-sandbox/raw/${oid}/${encoded}`;
      expect(rpc.calls.at(-1)).toEqual({ method: 'getText', args: [url] });
      expect(text).toBe(`text of ${url}`);
    }
  });
});

describe('fetchThreads', () => {
  it('collects embedded markers, every threads page and the previews', async () => {
    const rpc = fakeRpc();
    const raw = await fetchThreads(rpc, ref);
    expect(raw.threads.map((t) => t.id).sort()).toEqual(['2910292349', '2910292404', '2910292428']);
    expect(Object.keys(raw.markers).sort()).toEqual(['docs/with space.md', 'src/components/Button.ts']);
    expect(raw.markers['src/components/Button.ts']!.R9!.threads).toEqual([{ id: 2910292404, start: 'R8' }]);
    expect(raw.previews).toHaveLength(3);
    // every thread already has a marker or a preview: no positioning request
    expect(rpc.calls.some((c) => c.args[0] === `${base}/page_data/thread_preview_positioning`)).toBe(false);
    expect(raw.positioning).toEqual({});
    // standalone: the route is fetched for the markers
    expect(rpc.calls.filter((c) => c.args[0] === `${base}/changes`)).toHaveLength(1);
  });

  it('reuses PrData.threadMarkers instead of refetching the route', async () => {
    const rpc = fakeRpc();
    const pr = await fetchPrData(rpc, ref);
    const standalone = await fetchThreads(fakeRpc(), ref);
    const before = rpc.calls.length;
    const raw = await fetchThreads(rpc, ref, { markers: pr.threadMarkers });
    expect(rpc.calls.slice(before).some((c) => c.args[0] === `${base}/changes`)).toBe(false);
    expect(raw).toEqual(standalone);
  });

  it('follows the Link header and asks positioning for threads without marker or preview', async () => {
    const threads = fixture('threads.json').pages[0].data.threads;
    const extra = { ...threads[0], id: '777' };
    const rpc = fakeRpc((path, query) => {
      if (path === `${base}/page_data/threads`) {
        if (query === undefined) return { data: { threads: [threads[0]] }, link: `<https://github.com${base}/page_data/threads?after=abc%3D>; rel="next"` };
        if ((query as { raw: string }).raw === 'after=abc%3D') return { data: { threads: [threads[1], threads[2], extra] }, link: null };
      }
      if (path === `${base}/page_data/thread_preview_positioning`) {
        return { data: { threads: { 777: { path: 'src/util/math.ts', endLine: 3, endDiffSide: 'LEFT', commitOid: 'x' } } }, link: null };
      }
      return undefined;
    });
    const raw = await fetchThreads(rpc, ref);
    expect(raw.threads.map((t) => t.id).sort()).toEqual(['2910292349', '2910292404', '2910292428', '777']);
    const pos = rpc.calls.find((c) => c.args[0] === `${base}/page_data/thread_preview_positioning`)!;
    expect(pos.args[1]).toEqual({ raw: 'thread_ids=777' });
    expect(raw.positioning['777']).toMatchObject({ endLine: 3, endDiffSide: 'LEFT' });
  });

  it('nextLink only follows rel=next on the same threads path', () => {
    const p = `${base}/page_data/threads`;
    expect(nextLink(null, p)).toBeNull();
    expect(nextLink(`<https://github.com${p}?after=x>; rel="prev", <https://github.com${p}?after=y>; rel="next"`, p)).toBe('after=y');
    expect(nextLink(`<${p}?after=z>; rel="next"`, p)).toBe('after=z');
    expect(nextLink(`<https://github.com/evil/x/pull/1/page_data/threads?after=y>; rel="next"`, p)).toBeNull();
  });
});
