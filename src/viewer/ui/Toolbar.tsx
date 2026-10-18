/**
 * Toolbar: commit range, Split/Unified, Wrap, Hide whitespace, Display menu, viewed counter, Review button; with the
 * merged bar (page-scrolling experiment), the PR's state, title and number while GitHub's own title is scrolled away.
 * Each control subscribes to its own slice, so diff loading never re-renders the toolbar.
 */
import { memo } from 'react';
import { resolveDiffChoice } from '../../shared/github-defaults';
import type { PrState } from '../github/private';
import { usePageScroll } from '../pageScroll';
import { useSettings } from '../state/settings';
import { usePr } from '../state/store';
import { CommitRangePicker } from './CommitRangePicker';
import { DisplayMenu } from './DisplayMenu';
import { ProgressRing } from './icons';
import { ReviewMenu } from './ReviewMenu';

const STATE_LABELS: Record<PrState, string> = { open: 'Open', closed: 'Closed', merged: 'Merged' };

/** A PR title with its `code spans` (the only markup GitHub renders in titles); unbalanced backticks stay text. */
function titleParts(title: string) {
  const parts = title.split('`');
  if (parts.length % 2 === 0) return title;
  return parts.map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part));
}

/** GitHub's sticky PR header, folded into the toolbar like on GitHub's Files changed page. */
const PrTitle = memo(function PrTitle() {
  const show = usePageScroll((s) => s.layout === 'merged' && s.stuck);
  const title = usePr((s) => s.pr?.title);
  const number = usePr((s) => s.pr?.ref.number);
  const state = usePr((s) => s.pr?.state);
  if (!show || !title) return null;
  return (
    <span className="pr-title" data-testid="pr-title">
      {state && <span className={`pr-state pr-state-${state}`}>{STATE_LABELS[state]}</span>}
      <span className="pr-title-text" title={title}>
        {titleParts(title)}
      </span>
      <span className="pr-number">#{number}</span>
    </span>
  );
});

const DiffStyleToggle = memo(function DiffStyleToggle() {
  // 'default' shows as the layout it resolves to (GitHub's: unified).
  const diffStyle = useSettings((s) => resolveDiffChoice('diffStyle', s.settings.diff.diffStyle));
  const update = useSettings((s) => s.update);
  return (
    <span className="seg" role="group" aria-label="Diff layout">
      <button className={`pill ${diffStyle === 'split' ? 'pill-on' : ''}`} aria-pressed={diffStyle === 'split'} onClick={() => update({ diff: { diffStyle: 'split' } })}>
        Split
      </button>
      <button
        className={`pill ${diffStyle === 'unified' ? 'pill-on' : ''}`}
        aria-pressed={diffStyle === 'unified'}
        onClick={() => update({ diff: { diffStyle: 'unified' } })}
      >
        Unified
      </button>
    </span>
  );
});

const WrapToggle = memo(function WrapToggle() {
  const wrap = useSettings((s) => resolveDiffChoice('overflow', s.settings.diff.overflow) === 'wrap');
  const update = useSettings((s) => s.update);
  return (
    <button className={`pill ${wrap ? 'pill-on' : ''}`} aria-pressed={wrap} onClick={() => update({ diff: { overflow: wrap ? 'scroll' : 'wrap' } })}>
      Wrap
    </button>
  );
});

const WhitespaceToggle = memo(function WhitespaceToggle() {
  const hide = useSettings((s) => s.settings.review.hideWhitespace);
  const update = useSettings((s) => s.update);
  return (
    <button className={`pill ${hide ? 'pill-on' : ''}`} aria-pressed={hide} onClick={() => update({ review: { hideWhitespace: !hide } })}>
      Hide whitespace
    </button>
  );
});

const ViewedCounter = memo(function ViewedCounter() {
  const viewed = usePr((s) => s.viewed.size);
  const total = usePr((s) => s.order.length);
  return (
    <span className="viewed-counter" data-testid="viewed-counter">
      <ProgressRing done={total > 0 ? viewed / total : 0} />
      <span>
        <span className="viewed-count">{viewed}</span> / <span className="viewed-count">{total}</span> viewed
      </span>
    </span>
  );
});

export const Toolbar = memo(function Toolbar() {
  return (
    <div className="pierre-toolbar" role="toolbar">
      <PrTitle />
      <CommitRangePicker />
      <DiffStyleToggle />
      <WrapToggle />
      <WhitespaceToggle />
      <DisplayMenu />
      <span className="grow" />
      <ViewedCounter />
      <ReviewMenu />
    </div>
  );
});
