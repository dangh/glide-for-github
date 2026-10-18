/**
 * Commit range picker: all commits, one commit (click), or a range (shift-click a second commit), like
 * GitHub's "Changes from" menu. Maps to GitHub's `range` param via state/range.ts.
 */
import { memo, useRef } from 'react';
import { commitIndexes, rangeForCommits, rangeLabel } from '../state/range';
import { usePr } from '../state/store';
import { TriangleDownIcon } from './icons';
import { Popover } from './Popover';

export const CommitRangePicker = memo(function CommitRangePicker() {
  const commits = usePr((s) => s.pr?.commits);
  const range = usePr((s) => s.range);
  const anchor = useRef<number | null>(null);
  if (!commits) return <span className="pill pill-disabled">All commits</span>;
  const selected = commitIndexes(commits, range);

  return (
    <Popover label={<>{rangeLabel(commits, range)}<TriangleDownIcon /></>} testId="range-picker" className="range-picker">
      {(close) => (
        <div className="menu" role="menu">
          <button
            className={`menu-item ${selected ? '' : 'menu-item-on'}`}
            onClick={() => {
              anchor.current = null;
              usePr.getState().setRange({});
              close();
            }}
          >
            <strong>All commits</strong>
            <span className="menu-sub">Show all changes</span>
          </button>
          <div className="menu-sep">Shift-click to select a range</div>
          {commits.map((c, i) => {
            const on = selected !== null && i >= selected.from && i <= selected.to;
            return (
              <button
                key={c.oid}
                className={`menu-item ${on ? 'menu-item-on' : ''}`}
                title={c.oid}
                onClick={(e) => {
                  if (e.shiftKey) {
                    // Range: the first shift-click (or the last plain click) is the anchor; the menu stays open.
                    anchor.current ??= i;
                    usePr.getState().setRange(rangeForCommits(commits, anchor.current, i));
                    return;
                  }
                  anchor.current = i;
                  usePr.getState().setRange(rangeForCommits(commits, i, i));
                  close();
                }}
              >
                <code>{c.shortOid}</code> <span className="menu-text">{c.message}</span>
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
});
