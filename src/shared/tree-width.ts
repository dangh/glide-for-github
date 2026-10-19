/**
 * The file tree's width (layout.treeWidth), dragged on the tree's divider like GitHub's.
 *
 * GitHub's /changes tree is Primer's resizable PageLayout.Pane (measured 2026-10-19 on react/react#37778): 296 px by
 * default, 256-700 px whatever the viewport, plus the 1 px divider. The width is the account's: GitHub saves it once a
 * drag ends (`update_file_tree_width_preference`) and serves it back as the changes route's `user.fileTreeWidth`, so
 * 'default' means that width, else 296 px. Glide's own choice is synced with the other settings.
 *
 * Unlike GitHub's, Glide's tree stays docked at any viewport width, so the diffs also keep DIFFS_MIN_WIDTH beside it.
 */

export const TREE_WIDTH_MIN = 256;
export const TREE_WIDTH_MAX = 700;
export const TREE_WIDTH_DEFAULT = 296;
/** GitHub's arrow keys move its divider by 3 px; Glide's by 16 px, so crossing the range takes 28 presses, not 148. */
export const TREE_WIDTH_STEP = 16;
/** The narrowest the diffs get beside the tree before the tree stops growing. */
export const DIFFS_MIN_WIDTH = 400;
/** The tree pane's border toward the diffs. */
export const DIVIDER_WIDTH = 1;

export const isTreeWidth = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= TREE_WIDTH_MIN && v <= TREE_WIDTH_MAX;

/**
 * The tree width shown for `width` when the tree and its divider share `space` px with the diffs: within GitHub's
 * limits, and leaving the diffs DIFFS_MIN_WIDTH unless that would take the tree under its minimum.
 */
export function clampTreeWidth(width: number, space = Infinity): number {
  return Math.round(Math.max(TREE_WIDTH_MIN, Math.min(width, TREE_WIDTH_MAX, space - DIVIDER_WIDTH - DIFFS_MIN_WIDTH)));
}

/** `clampTreeWidth` as CSS for the pane's content width, so a window resize needs no script. `100%` is the body. */
export const treeWidthCss = (width: number): string =>
  `max(${TREE_WIDTH_MIN}px, min(${width}px, ${TREE_WIDTH_MAX}px, 100% - ${DIVIDER_WIDTH + DIFFS_MIN_WIDTH}px))`;

/** What a key on the divider does: a new width, 'reset' to the default, or nothing. */
export type TreeWidthKey = { width: number } | 'reset' | null;

/**
 * Arrow keys move the divider by TREE_WIDTH_STEP in the arrow's direction (so ArrowRight widens a tree on the left and
 * narrows one on the right), Home and End go to the narrowest and widest, and Enter resets, as a double-click does.
 */
export function treeWidthForKey(key: string, current: number, side: 'left' | 'right', space = Infinity): TreeWidthKey {
  const outward = side === 'left' ? 1 : -1;
  switch (key) {
    case 'ArrowRight':
      return { width: clampTreeWidth(current + outward * TREE_WIDTH_STEP, space) };
    case 'ArrowLeft':
      return { width: clampTreeWidth(current - outward * TREE_WIDTH_STEP, space) };
    case 'Home':
      return { width: clampTreeWidth(TREE_WIDTH_MIN, space) };
    case 'End':
      return { width: clampTreeWidth(TREE_WIDTH_MAX, space) };
    case 'Enter':
      return 'reset';
    default:
      return null;
  }
}

/** The width a drag from `startX` at `startWidth` gives at `x`: the divider follows the pointer on either side. */
export const treeWidthForDrag = (startWidth: number, startX: number, x: number, side: 'left' | 'right', space = Infinity): number =>
  clampTreeWidth(startWidth + (side === 'left' ? x - startX : startX - x), space);
