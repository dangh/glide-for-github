/**
 * Imperative handles shared between viewer components (not React state: changing them must not re-render).
 */
import type { CodeViewHandle } from '@pierre/diffs/react';
import type { Rpc } from '../github/private';
import type { ScrollPosition } from '../pageScroll';
import type { AnnotationMeta } from './items';
import type { Loader } from './loader';
import { WriteError } from '../github/errors';
import { usePr } from './store';

export interface Session {
  rpc?: Rpc;
  /** Current diff loader (replaced when the range or whitespace changes). */
  loader?: Loader;
  codeView?: CodeViewHandle<AnnotationMeta, undefined> | null;
  /** Last viewport priority (visible files + look-ahead, top first); replayed into every new loader. */
  viewport?: string[];
  /** Scrolls the diff list to a file (tree selection). */
  scrollToFile?(path: string): void;
  /** The merged PR title returns to the top of GitHub's document. */
  scrollPageToTop?(): void;
  /** Marks a file as the current one in the tree (diff scroll position). */
  revealInTree?(path: string): void;
  /**
   * Notes the tree's open search; the returned function reopens it with the same text if it has closed since (a press
   * on a file group tab blurs the search, which closes it).
   */
  keepTreeSearch?(): () => void;
  /** Attaches the list's anchors for restoration after reload. */
  pageScroll?: ScrollPosition;
}

export const session: Session = {};

/** In-page navigation keeps this module alive. Async work belongs to the PR and connection that started it. */
export function capturePrOperation() {
  const pr = usePr.getState().pr;
  if (!pr) throw new WriteError('unknown', 'The pull request is not loaded yet.', { owner: '' });
  const rpc = session.rpc;
  const isCurrent = () => usePr.getState().pr === pr && session.rpc === rpc;
  const check = () => {
    if (!isCurrent()) throw new WriteError('conflict', 'The pull request changed. Retry the action on the current pull request.', { owner: pr.ref.owner });
  };
  return {
    pr, rpc, isCurrent, check,
    async run<T>(action: () => Promise<T>): Promise<T> {
      check();
      const result = await action();
      check();
      return result;
    },
  };
}

export type PrOperation = ReturnType<typeof capturePrOperation>;
