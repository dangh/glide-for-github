/**
 * The file group tabs (All, Source, Tests, …) with GitHub's counters. A tab picks which files the tree and the diff
 * list show; arrow keys, Home and End move between tabs and open them (switching is instant, so focus follows).
 */
import { memo, useRef, type KeyboardEvent } from 'react';
import { ALL_GROUP } from '../../shared/file-groups';
import { groupTabs, useActiveGroup, useFileGroups } from '../state/fileGroups';
import { useSettings } from '../state/settings';
import { usePr } from '../state/store';

const MOVES: Record<string, (i: number, n: number) => number> = {
  ArrowRight: (i, n) => (i + 1) % n,
  ArrowLeft: (i, n) => (i - 1 + n) % n,
  Home: () => 0,
  End: (_, n) => n - 1,
};

export const FileGroupTabs = memo(function FileGroupTabs() {
  const order = usePr((s) => s.order);
  const loaded = useFileGroups((s) => s.loaded);
  const choose = useFileGroups((s) => s.choose);
  const { enabled, hideEmpty } = useSettings((s) => s.settings.fileGroups);
  const { view, active } = useActiveGroup();
  const list = useRef<HTMLDivElement>(null);

  if (!enabled || !loaded || view.labels.length === 0 || order.length === 0) return null;
  const tabs = groupTabs(order, view, active, hideEmpty);

  const onKeyDown = (e: KeyboardEvent) => {
    const move = MOVES[e.key];
    if (!move) return;
    e.preventDefault();
    const next = tabs[move(tabs.findIndex((t) => t.label === active), tabs.length)]!;
    choose(next.label);
    list.current?.querySelector<HTMLElement>(`[data-group="${CSS.escape(next.label)}"]`)?.focus();
  };

  return (
    <div className="file-groups" role="tablist" aria-label="File groups" ref={list} onKeyDown={onKeyDown} data-testid="file-groups">
      {tabs.map(({ label, count }) => {
        const selected = label === active;
        return (
          <button
            key={label}
            type="button"
            role="tab"
            className="file-group"
            data-group={label}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => choose(label)}
          >
            {label === ALL_GROUP ? 'All' : label}
            <span className="file-group-count">{count}</span>
          </button>
        );
      })}
    </div>
  );
});
