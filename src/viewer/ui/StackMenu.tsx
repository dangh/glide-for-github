/**
 * GitHub's stack button for a PR in a stack ("4/5": this PR's place from the bottom, of the stack's size), compact as in
 * GitHub's sticky Files changed toolbar, and its menu: every PR of the stack, top first, then the base branch. An entry
 * opens that PR in Glide, as GitHub's entries keep the tab you are on. GitHub's "Add to stack", stack actions (copy
 * links, unstack) and keyboard shortcut footer are left out.
 */
import { memo, type ReactNode } from 'react';
import type { PrStack, StackPullState } from '../github/private';
import { usePr } from '../state/store';
import { glideUrl } from '../../shared/pr-url';
import {
  DotIcon,
  GitMergeIcon,
  GitMergeQueueIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  StackIcon,
  TriangleDownIcon,
  XIcon,
} from './icons';
import { Popover } from './Popover';

const STATE_ICONS: Record<StackPullState, ReactNode> = {
  open: <GitPullRequestIcon />,
  draft: <GitPullRequestDraftIcon />,
  closed: <GitPullRequestClosedIcon />,
  merged: <GitMergeIcon />,
  queued: <GitMergeQueueIcon />,
};

/** Focuses the current entry and scrolls the list to it, as GitHub does on opening a long stack. */
function showCurrent(list: HTMLUListElement | null) {
  const entry = list?.querySelector<HTMLElement>('[aria-current]');
  if (!list || !entry) return;
  entry.focus({ preventScroll: true });
  const item = entry.parentElement!;
  list.scrollTop = item.offsetTop - (list.clientHeight - item.offsetHeight) / 2;
}

function StackPanel({ stack, current, close }: { stack: PrStack; current: number | undefined; close: () => void }) {
  return (
    <>
      <div className="stack-menu-header">
        <span className="stack-menu-title">Stack #{stack.number}</span>
        <button type="button" className="icon-button stack-menu-close" aria-label="Close" title="Close" onClick={close}>
          <XIcon />
        </button>
      </div>
      <ul className="stack-list" ref={showCurrent}>
        {stack.pulls.map((pull) => {
          const isCurrent = pull.number === current;
          return (
            <li key={pull.number}>
              <a
                href={glideUrl({ owner: stack.owner, repo: stack.repo, number: pull.number, page: 'conversation' })}
                target="_top"
                aria-current={isCurrent ? 'page' : undefined}
                onClick={
                  isCurrent
                    ? (e) => {
                        e.preventDefault();
                        close();
                      }
                    : undefined
                }
              >
                <span className={`stack-state stack-state-${pull.state ?? 'unknown'}`}>{pull.state && STATE_ICONS[pull.state]}</span>
                <span className="stack-entry">
                  <span className="stack-entry-title">{pull.title}</span>
                  <span className="stack-entry-desc">
                    #{pull.number} · {pull.headBranch}
                  </span>
                </span>
              </a>
            </li>
          );
        })}
        <li className="stack-base">
          <DotIcon />
          <span className="branch-name">{stack.base}</span>
        </li>
      </ul>
    </>
  );
}

/** The button and the divider GitHub puts after it; nothing for a PR in no stack. */
export const StackMenu = memo(function StackMenu() {
  const stack = usePr((s) => s.stack);
  const current = usePr((s) => s.pr?.ref.number);
  if (!stack) return null;
  return (
    <>
      <Popover
        className="stack-menu"
        testId="stack-button"
        ariaLabel={`Navigate pull request stack, position ${stack.position} of ${stack.size}`}
        label={
          <>
            <StackIcon size={12} />
            {stack.position}/{stack.size}
            <TriangleDownIcon />
          </>
        }
      >
        {(close) => <StackPanel stack={stack} current={current} close={close} />}
      </Popover>
      <span className="summary-divider stack-divider" />
    </>
  );
});
