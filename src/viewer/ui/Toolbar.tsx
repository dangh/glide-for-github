/**
 * Toolbar, laid out like GitHub's Files changed toolbar: file tree button, commit range, then viewed counter, Submit
 * review and the Display (settings) button; with the tree on the right, its button ends the toolbar instead. Outside
 * the merged bar, Split/Unified, Wrap and Hide whitespace sit after the commit range while the toolbar is wide enough
 * (they are also in the Display menu). With the merged bar (page-scrolling experiment) the toolbar has no such toggles,
 * as on GitHub, and while GitHub's title is scrolled away it shows GitHub's sticky PR header instead of the commit
 * range: state label, then title and number above the stack button (a PR in a stack), commit range and branch summary.
 * The stack button is only there: in every other toolbar GitHub's own title or sticky header shows it, as it does above
 * GitHub's toolbar.
 * What a narrow toolbar drops follows GitHub's container queries (viewer.css).
 * Each control subscribes to its own slice, so diff loading never re-renders the toolbar.
 */
import { memo, useEffect, useState, type ReactNode } from 'react';
import { resolveDiffChoice } from '../../shared/github-defaults';
import type { PrState } from '../github/private';
import { usePageScroll } from '../pageScroll';
import { useSettings } from '../state/settings';
import { session } from '../state/session';
import { usePr } from '../state/store';
import { CommitRangePicker } from './CommitRangePicker';
import { DisplayMenu } from './DisplayMenu';
import {
  CheckIcon,
  CopyIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  ProgressRing,
  SidebarCollapseIcon,
  SidebarExpandIcon,
} from './icons';
import { ReviewMenu } from './ReviewMenu';
import { StackMenu } from './StackMenu';

/** GitHub's state labels (verified on react/react PRs in each state, 2026-10-19). */
const STATE_LABELS: Record<PrState, { text: string; icon: ReactNode }> = {
  open: { text: 'Open', icon: <GitPullRequestIcon /> },
  draft: { text: 'Draft', icon: <GitPullRequestDraftIcon /> },
  closed: { text: 'Closed', icon: <GitPullRequestClosedIcon /> },
  merged: { text: 'Merged', icon: <GitMergeIcon /> },
};

const COPIED_MS = 2000;

const github = (path: string) => `https://github.com/${path.split('/').map(encodeURIComponent).join('/')}`;

function BranchName({ owner, repo, branch, label }: { owner: string; repo: string; branch: string; label: string }) {
  return (
    <a className="branch-name" href={github(`${owner}/${repo}/tree/${branch}`)} target="_top" title={`${owner}/${repo}:${branch}`}>
      {label}
    </a>
  );
}

function CopyBranch({ branch }: { branch: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const label = copied ? 'Copied!' : 'Copy head branch name to clipboard';
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      onClick={() => void navigator.clipboard?.writeText(branch).then(() => setCopied(true), () => undefined)}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

/** "<who> merged|wants to merge <n> commits into <base> from <head>"; forks name each branch's owner, like GitHub. */
const BranchSummary = memo(function BranchSummary() {
  const pr = usePr((s) => s.pr);
  if (!pr?.branches) return null;
  const { ref, branches } = pr;
  const { head } = branches;
  const merged = pr.state === 'merged';
  const actor = merged ? pr.mergedBy : pr.author;
  const fork = head.owner !== ref.owner || head.repo !== ref.repo;
  const commits = `${branches.commits} ${branches.commits === 1 ? 'commit' : 'commits'}`;
  return (
    <span className="pr-branches" data-testid="pr-branches">
      <span className="summary-divider" />
      <span className="pr-branches-text">
        {actor && (
          <a className="pr-actor" href={github(actor)} target="_top">
            {actor}
          </a>
        )}
        <span>
          {merged ? 'merged' : 'wants to merge'} {commits} into
        </span>
        <BranchName owner={ref.owner} repo={ref.repo} branch={branches.base} label={fork ? `${ref.owner}:${branches.base}` : branches.base} />
        <span>from</span>
        <BranchName owner={head.owner} repo={head.repo} branch={head.branch} label={fork ? `${head.owner}:${head.branch}` : head.branch} />
        <CopyBranch branch={head.branch} />
      </span>
    </span>
  );
});

/**
 * GitHub's sticky PR header, folded into the toolbar like on GitHub's Files changed page. The title is plain text,
 * backticks included, as GitHub's sticky title shows it.
 */
const PrHeader = memo(function PrHeader() {
  const title = usePr((s) => s.pr?.title);
  const number = usePr((s) => s.pr?.ref.number);
  const state = usePr((s) => s.pr?.state);
  if (!title) return <CommitRangePicker />;
  return (
    <span className="pr-header" data-testid="pr-title">
      {state && (
        <span className={`pr-state pr-state-${state}`}>
          {STATE_LABELS[state].icon}
          {STATE_LABELS[state].text}
        </span>
      )}
      <span className="pr-summary">
        <span className="pr-title-row">
          {/* GitHub's sticky title takes the page back to the top; no href change, which would drop #glide. */}
          <a
            className="pr-title-text"
            href="#top"
            title={title}
            onClick={(e) => {
              e.preventDefault();
              session.pageScroll?.scrollPageToTop();
            }}
          >
            {title}
          </a>
          <span className="pr-number">#{number}</span>
        </span>
        <span className="pr-summary-row">
          <StackMenu />
          <CommitRangePicker />
          <BranchSummary />
        </span>
      </span>
    </span>
  );
});

/**
 * GitHub's file tree button: hides or shows the tree pane, remembered like any display setting. It sits on the tree's
 * side of the toolbar, its icon mirrored for a tree on the right.
 */
const TreeToggle = memo(function TreeToggle({ side }: { side: 'left' | 'right' }) {
  const shown = useSettings((s) => s.settings.layout.showTree);
  const update = useSettings((s) => s.update);
  const label = shown ? 'Collapse file tree' : 'Expand file tree';
  return (
    <button
      type="button"
      className="tree-toggle"
      data-side={side}
      aria-label={label}
      title={label}
      aria-expanded={shown}
      data-testid="tree-toggle"
      onClick={() => update({ layout: { showTree: !shown } })}
    >
      {shown ? <SidebarExpandIcon /> : <SidebarCollapseIcon />}
    </button>
  );
});

const DiffStyleToggle = memo(function DiffStyleToggle() {
  // 'default' shows as the layout it resolves to (GitHub's: unified).
  const diffStyle = useSettings((s) => resolveDiffChoice('diffStyle', s.settings.diff.diffStyle));
  const update = useSettings((s) => s.update);
  return (
    <span className="seg diff-toggle" role="group" aria-label="Diff layout">
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
    <button className={`pill diff-toggle ${wrap ? 'pill-on' : ''}`} aria-pressed={wrap} onClick={() => update({ diff: { overflow: wrap ? 'scroll' : 'wrap' } })}>
      Wrap
    </button>
  );
});

const WhitespaceToggle = memo(function WhitespaceToggle() {
  const hide = useSettings((s) => s.settings.review.hideWhitespace);
  const update = useSettings((s) => s.update);
  return (
    <button className={`pill diff-toggle ${hide ? 'pill-on' : ''}`} aria-pressed={hide} onClick={() => update({ review: { hideWhitespace: !hide } })}>
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
        <span className="viewed-count">{viewed}</span> / <span className="viewed-count">{total}</span>
        <span className="viewed-word"> viewed</span>
      </span>
    </span>
  );
});

export const Toolbar = memo(function Toolbar() {
  const merged = usePageScroll((s) => s.layout === 'merged');
  const stuck = usePageScroll((s) => s.stuck) && merged;
  const treeSide = useSettings((s) => s.settings.layout.treePosition);
  return (
    <div className="pierre-toolbar" role="toolbar" data-stuck={stuck || undefined}>
      {treeSide === 'left' && <TreeToggle side="left" />}
      {stuck ? <PrHeader /> : <CommitRangePicker />}
      {!merged && (
        <>
          <DiffStyleToggle />
          <WrapToggle />
          <WhitespaceToggle />
        </>
      )}
      <span className="grow" />
      <ViewedCounter />
      <span className="toolbar-divider" />
      <ReviewMenu />
      <DisplayMenu />
      {treeSide === 'right' && <TreeToggle side="right" />}
    </div>
  );
});
