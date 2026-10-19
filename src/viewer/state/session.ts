/**
 * Imperative handles shared between viewer components (not React state: changing them must not re-render).
 */
import type { CodeViewHandle } from '@pierre/diffs/react';
import type { Rpc } from '../github/private';
import type { PageScrollView } from '../pageScroll';
import type { AnnotationMeta } from './items';
import type { Loader } from './loader';

export interface Session {
  rpc?: Rpc;
  /** Current diff loader (replaced when the range or whitespace changes). */
  loader?: Loader;
  codeView?: CodeViewHandle<AnnotationMeta, undefined> | null;
  /** Last viewport priority (visible files + look-ahead, top first); replayed into every new loader. */
  viewport?: string[];
  /** Scrolls the diff list to a file (tree selection). */
  scrollToFile?(path: string): void;
  /** Marks a file as the current one in the tree (diff scroll position). */
  revealInTree?(path: string): void;
  /**
   * Notes the tree's open search; the returned function reopens it with the same text if it has closed since (a press
   * on a file group tab blurs the search, which closes it).
   */
  keepTreeSearch?(): () => void;
  /** Page scrolling's list side, when the viewer was mounted with it (src/viewer/pageScroll.ts). */
  pageScroll?: PageScrollView;
}

export const session: Session = {};
