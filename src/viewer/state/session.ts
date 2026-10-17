/**
 * Imperative handles shared between viewer components (not React state: changing them must not re-render).
 */
import type { CodeViewHandle } from '@pierre/diffs/react';
import type { Rpc } from '../github/private';
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
}

export const session: Session = {};
