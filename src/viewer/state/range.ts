/**
 * Commit range selection (toolbar picker) and its mapping to GitHub's `range` param (R§1.2):
 * `range=<sha>` is "PR base up to sha" (cumulative), `range=<a>..<b>` is a..b, so one commit is
 * `<parent>..<sha>`. Commits are assumed linear in `pr.commits` order (GitHub lists them oldest first).
 */
import type { CommitInfo, PrData } from '../github/private';

/** `base`: exclusive start commit (undefined = PR base). `head`: last commit shown (undefined = PR head). */
export interface CommitRange {
  base?: string;
  head?: string;
}

/** The range covering commits `from..to` (inclusive indexes into `commits`); `{}` when it is the whole PR. */
export function rangeForCommits(commits: CommitInfo[], from: number, to: number): CommitRange {
  const lo = Math.max(0, Math.min(from, to));
  const hi = Math.min(commits.length - 1, Math.max(from, to));
  if (hi < 0 || (lo === 0 && hi === commits.length - 1)) return {};
  return { ...(lo > 0 ? { base: commits[lo - 1]!.oid } : {}), head: commits[hi]!.oid };
}

/** Inclusive commit indexes a range covers, or null for the whole PR / unknown commits. */
export function commitIndexes(commits: CommitInfo[], range: CommitRange): { from: number; to: number } | null {
  if (!range.head) return null;
  const to = commits.findIndex((c) => c.oid === range.head);
  if (to < 0) return null;
  const from = range.base ? commits.findIndex((c) => c.oid === range.base) + 1 : 0;
  if (range.base && from === 0) return null;
  return { from, to };
}

export const isWholePr = (range: CommitRange) => !range.base && !range.head;

/** GitHub's `range` param for `diff_entries` / `diff_entry_lines`. */
export function rangeParam(pr: Pick<PrData, 'headOid'>, range: CommitRange): string {
  const head = range.head ?? pr.headOid;
  return range.base ? `${range.base}..${head}` : head;
}

/** Commits whose full files back `loadDiffFiles` (expand context): old side at the range base, new at its head. */
export function rangeOids(pr: Pick<PrData, 'baseOid' | 'headOid'>, range: CommitRange): { oldOid: string; newOid: string } {
  return { oldOid: range.base ?? pr.baseOid, newOid: range.head ?? pr.headOid };
}

/** Toolbar label: "All commits", "1 commit: abc1234", or "3 commits: abc1234..def5678". */
export function rangeLabel(commits: CommitInfo[], range: CommitRange): string {
  const idx = commitIndexes(commits, range);
  if (!idx) return 'All commits';
  const n = idx.to - idx.from + 1;
  if (n === 1) return `1 commit: ${commits[idx.to]!.shortOid}`;
  return `${n} commits: ${commits[idx.from]!.shortOid}..${commits[idx.to]!.shortOid}`;
}
