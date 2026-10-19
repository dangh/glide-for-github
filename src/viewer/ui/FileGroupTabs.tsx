/**
 * The file group tabs (All, Source, Tests, …) in the toolbar, left of the viewed counter as Sift places them on
 * GitHub's toolbar: a segmented control of tabs with their file counts. A tab picks which files the tree and the diff
 * list show; arrow keys, Home and End move between tabs and open them (switching is instant, so focus follows). An
 * open tree search stays open across a click on a tab or a pick from the menu.
 *
 * When the tabs don't fit, a menu button takes their place (Sift's narrow toolbar swaps them for a dropdown): it shows
 * the open group and its count and opens a menu of every group. The fit is measured, not a breakpoint, because the
 * rest of the toolbar varies (tree button, commit range or PR title, stack button, viewed counter, Submit review). The
 * slot takes the toolbar's leftover width, never less than the menu button; the tabs are laid over it, out of flow,
 * so the slot's width never depends on which form shows and the choice cannot flip back and forth.
 */
import { memo, useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { ALL_GROUP } from '../../shared/file-groups';
import { groupTabs, useActiveGroup, useFileGroups, type GroupTab } from '../state/fileGroups';
import { useSettings } from '../state/settings';
import { session } from '../state/session';
import { usePr } from '../state/store';
import { useDismiss } from './dismiss';
import { CheckIcon, TriangleDownIcon } from './icons';
import { viewerRoot } from '../rootEl';

const MOVES: Record<string, (i: number, n: number) => number> = {
  ArrowRight: (i, n) => (i + 1) % n,
  ArrowLeft: (i, n) => (i - 1 + n) % n,
  Home: () => 0,
  End: (_, n) => n - 1,
};

const MENU_MOVES: Record<string, (i: number, n: number) => number> = {
  ArrowDown: (i, n) => (i + 1) % n,
  ArrowUp: (i, n) => (i - 1 + n) % n,
  Home: () => 0,
  End: (_, n) => n - 1,
};

const nameOf = (label: string) => (label === ALL_GROUP ? 'All' : label);

const setVar = (el: HTMLElement, name: string, px: number) => {
  const value = `${Math.ceil(px)}px`;
  if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
};

/**
 * Which form fits, re-measured whenever the toolbar or the tabs change size. The slot's flex basis is the tabs'
 * width (`--file-groups-want`) and its floor the menu button with the group name cut to its `min-width`
 * (`--file-groups-min`), so the slot's width never depends on the form shown. In order of preference:
 * - the tabs beside Split/Unified, Wrap and Hide whitespace;
 * - the tabs alone: those three (also in the Display menu, and not on GitHub's toolbar) give up their room
 *   (`data-groups-room` on the toolbar);
 * - the menu.
 * A long merged title gives way before the tabs do (viewer.css), as GitHub's sticky title does for Sift's tabs.
 */
function useCompact(slot: RefObject<HTMLElement | null>, tabs: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const s = slot.current;
    const t = tabs.current;
    const bar = s?.closest<HTMLElement>('.pierre-toolbar');
    const button = s?.querySelector<HTMLElement>('.file-groups-menu > .pill');
    const label = button?.querySelector<HTMLElement>('.file-groups-menu-label');
    if (!enabled || !s || !t || !bar || !button || !label) return;
    /** The toggles' width with their gaps, last seen while they showed. */
    let togglesWidth = 0;
    const measure = () => {
      const labelMin = Math.min(label.scrollWidth, parseFloat(getComputedStyle(label).minWidth) || 0);
      setVar(s, '--file-groups-min', button.offsetWidth - label.clientWidth + labelMin);
      const want = t.getBoundingClientRect().width;
      setVar(s, '--file-groups-want', want);
      const gap = parseFloat(getComputedStyle(bar).columnGap) || 0;
      const toggles = [...bar.querySelectorAll<HTMLElement>('.diff-toggle')].filter((el) => el.offsetWidth > 0);
      const roomTaken = bar.hasAttribute('data-groups-room');
      const shown = toggles.reduce((sum, el) => sum + el.offsetWidth + gap, 0);
      if (!roomTaken) togglesWidth = shown;
      // The slot's width with the toggles hidden; sub-pixel widths get half a pixel of slack.
      const room = s.getBoundingClientRect().width + (roomTaken ? 0 : shown) + 0.5;
      const withToggles = want <= room - togglesWidth;
      const fits = want <= room;
      bar.toggleAttribute('data-groups-room', fits && !withToggles);
      setCompact(!fits);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(s);
    observer.observe(t);
    observer.observe(button);
    return () => {
      observer.disconnect();
      bar.removeAttribute('data-groups-room');
    };
  }, [slot, tabs, enabled]);
  return compact;
}

function GroupMenu({ tabs, active, choose, hidden }: { tabs: GroupTab[]; active: string; choose(label: string): void; hidden: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  /** Which item to focus once the menu renders: the open group (click, Enter, Down) or the last (Up). */
  const focusOnOpen = useRef<'selected' | 'last'>('selected');
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, root, close);
  const current = tabs.find((t) => t.label === active) ?? tabs[0]!;
  /** Puts back the tree search that a press on the button closed, once the menu closes (after a pick, if any). */
  const restoreSearch = useRef<(() => void) | undefined>(undefined);

  useLayoutEffect(() => {
    if (open) return;
    restoreSearch.current?.();
    restoreSearch.current = undefined;
  }, [open]);

  useLayoutEffect(() => {
    const panel = menu.current;
    if (!open || !panel) return;
    // Keep an open menu inside the frame when a resize moves its button.
    const place = () => {
      panel.style.right = '0px';
      const left = panel.getBoundingClientRect().left;
      if (left < 8) panel.style.right = `${left - 8}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(viewerRoot.el);
    observer.observe(panel);
    const items = [...panel.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    const target = focusOnOpen.current === 'last' ? items.at(-1) : (items.find((i) => i.getAttribute('aria-checked') === 'true') ?? items[0]);
    target?.focus();
    return () => observer.disconnect();
  }, [open]);

  useLayoutEffect(() => {
    if (hidden) setOpen(false);
  }, [hidden]);

  const openWith = (focus: 'selected' | 'last') => {
    focusOnOpen.current = focus;
    setOpen(true);
  };

  const pick = (label: string) => {
    choose(label);
    setOpen(false);
    button.current?.focus();
  };

  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openWith(e.key === 'ArrowUp' ? 'last' : 'selected');
    }
  };

  const onMenuKey = (e: KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const at = items.indexOf(viewerRoot.scope.activeElement as HTMLElement);
    const move = MENU_MOVES[e.key];
    if (move) {
      e.preventDefault();
      items[move(at, items.length)]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      // Type-ahead: the next group whose name starts with the key.
      const key = e.key.toLowerCase();
      const next = [...items.slice(at + 1), ...items.slice(0, at + 1)].find((i) => i.dataset.name?.toLowerCase().startsWith(key));
      next?.focus();
    }
  };

  return (
    <div className="popover file-groups-menu" ref={root} inert={hidden} aria-hidden={hidden || undefined}>
      <button
        ref={button}
        type="button"
        className="pill"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'file-groups-menu' : undefined}
        aria-label={`File group: ${nameOf(current.label)} ${current.count}`}
        data-testid="file-groups-button"
        onPointerDown={() => {
          if (!open) restoreSearch.current = session.keepTreeSearch?.();
        }}
        onClick={() => (open ? setOpen(false) : openWith('selected'))}
        onKeyDown={onButtonKey}
      >
        <span className="file-groups-menu-label">{nameOf(current.label)}</span>
        <span className="file-group-count">{current.count}</span>
        <TriangleDownIcon />
      </button>
      {open && (
        <div className="popover-panel" id="file-groups-menu" role="menu" aria-label="File groups" ref={menu} onKeyDown={onMenuKey}>
          {tabs.map(({ label, count }) => {
            const selected = label === active;
            return (
              <button
                key={label}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className="menu-item file-groups-item"
                data-name={nameOf(label)}
                tabIndex={-1}
                onClick={() => pick(label)}
              >
                <span className="file-groups-check">{selected && <CheckIcon />}</span>
                <span className="menu-text">{nameOf(label)}</span>
                <span className="file-groups-item-count">{count}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The toolbar's flexible middle: the file groups, or (groups off, not loaded yet, or no files) an empty spacer that
 * pushes the viewed counter and Submit review to the end, as before.
 */
export const FileGroupTabs = memo(function FileGroupTabs() {
  const order = usePr((s) => s.order);
  const loaded = useFileGroups((s) => s.loaded);
  const choose = useFileGroups((s) => s.choose);
  const { enabled, hideEmpty } = useSettings((s) => s.settings.fileGroups);
  const { view, active } = useActiveGroup();
  const slot = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const restoreSearch = useRef<(() => void) | undefined>(undefined);
  const shown = enabled && loaded && view.labels.length > 0 && order.length > 0;
  const compact = useCompact(slot, list, shown);

  // A switch between the two forms keeps keyboard focus in the control.
  const wasCompact = useRef(compact);
  useLayoutEffect(() => {
    if (wasCompact.current === compact) return;
    wasCompact.current = compact;
    if (!slot.current?.contains(viewerRoot.scope.activeElement)) return;
    const target = compact
      ? slot.current.querySelector<HTMLElement>('[data-testid="file-groups-button"]')
      : list.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    target?.focus();
  }, [compact]);

  if (!shown) return <span className="grow" />;
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
    <div className="file-groups" ref={slot} data-compact={compact || undefined} data-testid="file-groups">
      <GroupMenu tabs={tabs} active={active} choose={choose} hidden={!compact} />
      <div
        className="file-groups-tabs"
        role="tablist"
        aria-label="File groups"
        ref={list}
        onKeyDown={onKeyDown}
        inert={compact}
        aria-hidden={compact || undefined}
      >
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
              aria-controls="file-group-panel"
              tabIndex={selected ? 0 : -1}
              onPointerDown={() => (restoreSearch.current = session.keepTreeSearch?.())}
              onClick={() => {
                choose(label);
                restoreSearch.current?.();
                restoreSearch.current = undefined;
              }}
            >
              {nameOf(label)}
              <span className="file-group-count">{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
});
