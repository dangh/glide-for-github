// @vitest-environment jsdom
// (@pierre/diffs reads `navigator` at import time.)
import { describe, expect, it } from 'vitest';
import type { FileDiffMetadata } from '@pierre/diffs';
import { buildPatch, toFileDiff } from '../../src/viewer/github/convert';
import { applyDiffEntry, fetchDiffEntries, fetchPrData, loadEntryLines, type FileSummary, type GithubDiffLine } from '../../src/viewer/github/private';
import { fakeRpc, ref } from './sandbox-fixtures';

const counts = (d: FileDiffMetadata) => ({
  additions: d.hunks.reduce((n, h) => n + h.additionLines, 0),
  deletions: d.hunks.reduce((n, h) => n + h.deletionLines, 0),
});

async function sandboxFiles(whitespace: boolean) {
  const rpc = fakeRpc();
  const pr = await fetchPrData(rpc, ref);
  const opts = { whitespace, headOid: pr.headOid };
  const entries = await fetchDiffEntries(rpc, ref, pr.files.map((f) => f.path), opts);
  // what the viewer does for collapsed (deleted) files
  for (const [p, e] of entries) if (e.needsLines) entries.set(p, await loadEntryLines(rpc, ref, e, opts));
  const files = pr.files.map((f) => applyDiffEntry(f, entries.get(f.path)!));
  return { pr, files, lines: (p: string) => entries.get(p)!.lines };
}

const summary = (over: Partial<FileSummary> = {}): FileSummary => ({
  path: 'src/x.ts', digest: 'd', status: 'modified', additions: 0, deletions: 0, viewed: false, tooLarge: false, binary: false, ...over,
});
const line = (type: GithubDiffLine['type'], text: string, left: number | null, right: number | null, extra: Partial<GithubDiffLine> = {}): GithubDiffLine =>
  ({ type, text, html: '', left, right, ...extra });

describe('toFileDiff on the sandbox PR', () => {
  it('converts every sandbox file with the same +/- counts as its FileSummary', async () => {
    const { pr, files, lines } = await sandboxFiles(false);
    expect(files).toHaveLength(20);
    for (const f of files) {
      const diff = toFileDiff(f, lines(f.path), { headOid: pr.headOid, whitespace: false });
      expect(diff.name, f.path).toBe(f.path);
      if (f.tooLarge) {
        expect(diff.hunks).toEqual([]);
        continue;
      }
      expect(counts(diff), f.path).toEqual({ additions: f.additions, deletions: f.deletions });
    }
  });

  it('sets change types and the cache key', async () => {
    const { pr, files, lines } = await sandboxFiles(false);
    const conv = (p: string) => {
      const f = files.find((x) => x.path === p)!;
      return toFileDiff(f, lines(p), { headOid: pr.headOid, whitespace: false });
    };
    expect(conv('docs/with space.md').type).toBe('new');
    expect(conv('src/obsolete.ts').type).toBe('deleted');
    expect(conv('src/util/math.ts').type).toBe('change');
    const math = files.find((x) => x.path === 'src/util/math.ts')!;
    expect(conv('src/util/math.ts').cacheKey).toBe(`${math.digest}:${pr.headOid}:0`);
    expect(toFileDiff(math, lines(math.path), { headOid: pr.headOid, whitespace: true }).cacheKey).toBe(`${math.digest}:${pr.headOid}:1`);
  });

  it('rename shows prevName', async () => {
    const { pr, files, lines } = await sandboxFiles(false);
    const edited = files.find((f) => f.path === 'src/modern/helper-renamed.ts')!;
    const pure = files.find((f) => f.path === 'src/legacy/renamed-pure.ts')!;
    const e = toFileDiff(edited, lines(edited.path), { headOid: pr.headOid, whitespace: false });
    expect(e).toMatchObject({ name: 'src/modern/helper-renamed.ts', prevName: 'src/legacy/helper.ts', type: 'rename-changed' });
    const p = toFileDiff(pure, lines(pure.path), { headOid: pr.headOid, whitespace: false });
    expect(p).toMatchObject({ name: 'src/legacy/renamed-pure.ts', prevName: 'src/legacy/old-name.ts', type: 'rename-pure', hunks: [] });
  });

  it('whitespace-only file has no changes at w=1', async () => {
    const w0 = await sandboxFiles(false);
    const w1 = await sandboxFiles(true);
    const f0 = w0.files.find((f) => f.path === 'src/whitespace.ts')!;
    const f1 = w1.files.find((f) => f.path === 'src/whitespace.ts')!;
    expect(counts(toFileDiff(f0, w0.lines(f0.path), { headOid: w0.pr.headOid, whitespace: false }))).toEqual({ additions: 6, deletions: 6 });
    expect(counts(toFileDiff(f1, w1.lines(f1.path), { headOid: w1.pr.headOid, whitespace: true }))).toEqual({ additions: 0, deletions: 0 });
  });

  it('too-large file gives tooLarge: true with empty lines', async () => {
    const { pr, files, lines } = await sandboxFiles(false);
    const big = files.find((f) => f.path === 'generated/big.generated.ts')!;
    expect(big.tooLarge).toBe(true);
    expect(lines(big.path)).toEqual([]);
    expect(toFileDiff(big, [], { headOid: pr.headOid, whitespace: false }).hunks).toEqual([]);
  });

  it('keeps awkward paths intact', async () => {
    const { pr, files, lines } = await sandboxFiles(false);
    for (const p of ['docs/with space.md', 'src/a,b.ts', 'src/ünï/cödé.ts', 'src/hash#pct%.ts']) {
      const f = files.find((x) => x.path === p)!;
      expect(toFileDiff(f, lines(p), { headOid: pr.headOid, whitespace: false }).name).toBe(p);
    }
  });
});

describe('toFileDiff synthesis', () => {
  const ctx = { headOid: 'h', whitespace: false };

  it('quotes names so quotes, backslashes, tabs and leading/trailing spaces survive', () => {
    for (const p of ['a "q".ts', 'back\\slash.ts', 'tab\there.ts', ' lead and trail ', 'ünï b/ c.ts']) {
      const d = toFileDiff(summary({ path: p, prevPath: `old/${p}`, status: 'renamed' }), [], ctx);
      expect(d.name).toBe(p);
      expect(d.prevName).toBe(`old/${p}`);
    }
  });

  it('treats the ~ marker (INJECTED_CONTEXT) as context and recomputes hunk counts', () => {
    const lines = [
      line('HUNK', '@@ -5,2 +5,3 @@ fn()', 4, 4),
      line('INJECTED_CONTEXT', '~injected 3', 3, 3),
      line('INJECTED_CONTEXT', '~injected 4', 4, 4),
      line('CONTEXT', ' five', 5, 5),
      line('ADDITION', '+new six', 5, 6),
      line('CONTEXT', ' six', 6, 7),
    ];
    const patch = buildPatch(summary(), lines);
    expect(patch).toContain('@@ -3,4 +3,5 @@ fn()\n injected 3\n injected 4\n five\n+new six\n six\n');
    const d = toFileDiff(summary(), lines, ctx);
    expect(d.hunks).toHaveLength(1);
    expect(d.hunks[0]).toMatchObject({ deletionStart: 3, deletionCount: 4, additionStart: 3, additionCount: 5, additionLines: 1 });
  });

  it('splits a hunk where line numbers jump', () => {
    const lines = [
      line('HUNK', '@@ -1,1 +1,1 @@', 0, 0),
      line('CONTEXT', ' one', 1, 1),
      line('INJECTED_CONTEXT', '~ten', 10, 10),
      line('DELETION', '-eleven', 11, 10),
    ];
    const d = toFileDiff(summary(), lines, ctx);
    expect(d.hunks.map((h) => [h.deletionStart, h.deletionCount, h.additionStart, h.additionCount])).toEqual([[1, 1, 1, 1], [10, 2, 10, 1]]);
  });

  it('emits "\\ No newline at end of file" and handles pure insertions', () => {
    const lines = [
      line('HUNK', '@@ -2,0 +3,1 @@', 1, 2),
      line('ADDITION', '+last', 2, 3, { displayNoNewLineWarning: true }),
    ];
    const patch = buildPatch(summary(), lines);
    expect(patch).toContain('@@ -2,0 +3,1 @@\n+last\n\\ No newline at end of file\n');
    const d = toFileDiff(summary(), lines, ctx);
    expect(d.hunks[0]).toMatchObject({ additionStart: 3, additionCount: 1, deletionCount: 0, noEOFCRAdditions: true });
  });

  it('writes git headers for added, deleted and pure renamed files', () => {
    expect(buildPatch(summary({ status: 'added', path: 'n.ts' }), [])).toBe('diff --git "a/n.ts" "b/n.ts"\nnew file mode 100644\n');
    expect(buildPatch(summary({ status: 'deleted', path: 'd.ts' }), [line('HUNK', '@@ -1,1 +0,0 @@', 0, null), line('DELETION', '-x', 1, null)]))
      .toBe('diff --git "a/d.ts" "b/d.ts"\ndeleted file mode 100644\n--- "a/d.ts"\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-x\n');
    expect(buildPatch(summary({ status: 'renamed', path: 'b.ts', prevPath: 'a.ts' }), []))
      .toBe('diff --git "a/a.ts" "b/b.ts"\nsimilarity index 100%\nrename from "a.ts"\nrename to "b.ts"\n');
  });
});
