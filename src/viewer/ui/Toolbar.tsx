/**
 * Toolbar: commit range, Split/Unified, Wrap, Hide whitespace, Display menu, viewed counter, Review button.
 * Each control subscribes to its own slice, so diff loading never re-renders the toolbar.
 */
import { memo } from 'react';
import { useSettings } from '../state/settings';
import { usePr } from '../state/store';
import { CommitRangePicker } from './CommitRangePicker';
import { DisplayMenu } from './DisplayMenu';

const DiffStyleToggle = memo(function DiffStyleToggle() {
  const diffStyle = useSettings((s) => s.settings.diff.diffStyle);
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
  const wrap = useSettings((s) => s.settings.diff.overflow === 'wrap');
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
      {viewed} / {total} viewed
    </span>
  );
});

const ReviewButton = memo(function ReviewButton() {
  const pending = usePr((s) => s.pendingReview?.count ?? 0);
  return (
    <button className="btn-primary" disabled title="Reviewing from Pierre is coming soon">
      {pending > 0 ? `Review (${pending} pending)` : 'Review'} ▾
    </button>
  );
});

export const Toolbar = memo(function Toolbar() {
  return (
    <div className="pierre-toolbar" role="toolbar">
      <CommitRangePicker />
      <DiffStyleToggle />
      <WrapToggle />
      <WhitespaceToggle />
      <DisplayMenu />
      <span className="grow" />
      <ViewedCounter />
      <ReviewButton />
    </div>
  );
});
