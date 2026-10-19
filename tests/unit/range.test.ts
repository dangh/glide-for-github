import { describe, expect, it } from 'vitest';
import { commitIndexes, rangeForCommits, rangeLabel, rangeOids, rangeParam } from '../../src/viewer/state/range';

const commits = ['a1', 'b2', 'c3', 'd4'].map((oid) => ({ oid: oid.repeat(10), shortOid: oid, message: `commit ${oid}` }));
const [a, b, c, d] = commits.map((x) => x.oid) as [string, string, string, string];
const pr = { baseOid: 'base0', headOid: d };

describe('commit range', () => {
  it('maps picker selections to GitHub range semantics (PR base up to a commit; a..b otherwise)', () => {
    expect(rangeForCommits(commits, 0, 3)).toEqual({}); // every commit = the whole PR
    expect(rangeForCommits(commits, 0, 0)).toEqual({ head: a }); // first commit: PR base..a
    expect(rangeForCommits(commits, 2, 2)).toEqual({ base: b, head: c }); // single commit: parent..commit
    expect(rangeForCommits(commits, 1, 2)).toEqual({ base: a, head: c });
    expect(rangeForCommits(commits, 2, 1)).toEqual({ base: a, head: c }); // order-insensitive
    expect(rangeForCommits(commits, 0, 2)).toEqual({ head: c });
  });

  it('builds the range param and full-file oids', () => {
    expect(rangeParam(pr, {})).toBe(d);
    expect(rangeParam(pr, { head: c })).toBe(c);
    expect(rangeParam(pr, { base: a, head: c })).toBe(`${a}..${c}`);
    expect(rangeOids(pr, {})).toEqual({ oldOid: 'base0', newOid: d });
    expect(rangeOids(pr, { base: a, head: c })).toEqual({ oldOid: a, newOid: c });
  });

  it('round-trips indexes and labels', () => {
    expect(commitIndexes(commits, {})).toBeNull();
    expect(commitIndexes(commits, { base: a, head: c })).toEqual({ from: 1, to: 2 });
    expect(commitIndexes(commits, { head: b })).toEqual({ from: 0, to: 1 });
    expect(commitIndexes(commits, { base: 'unknown', head: c })).toBeNull();
    expect(rangeLabel(commits, {})).toBe('All commits');
    expect(rangeLabel(commits, { base: b, head: c })).toBe('1 commit: c3');
    expect(rangeLabel(commits, { base: a, head: d })).toBe('3 commits: b2..d4');
  });
});
