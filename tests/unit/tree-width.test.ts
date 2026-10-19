import { describe, expect, it } from 'vitest';
import {
  clampTreeWidth,
  DIFFS_MIN_WIDTH,
  isTreeWidth,
  TREE_WIDTH_MAX,
  TREE_WIDTH_MIN,
  TREE_WIDTH_STEP,
  treeWidthCss,
  treeWidthForDrag,
  treeWidthForKey,
} from '../../src/shared/tree-width';

describe('tree width', () => {
  it("keeps GitHub's limits: 256 to 700 px", () => {
    expect([TREE_WIDTH_MIN, TREE_WIDTH_MAX]).toEqual([256, 700]);
    expect(clampTreeWidth(100)).toBe(256);
    expect(clampTreeWidth(450)).toBe(450);
    expect(clampTreeWidth(5000)).toBe(700);
    expect(clampTreeWidth(300.6)).toBe(301);
  });

  it('leaves the diffs 400 px beside the divider, but never takes the tree under its minimum', () => {
    expect(DIFFS_MIN_WIDTH).toBe(400);
    expect(clampTreeWidth(700, 1400)).toBe(700);
    expect(clampTreeWidth(700, 1001)).toBe(600);
    expect(clampTreeWidth(500, 1001)).toBe(500);
    expect(clampTreeWidth(500, 500)).toBe(256);
  });

  it('accepts only whole widths within the limits', () => {
    for (const ok of [256, 296, 700]) expect(isTreeWidth(ok), String(ok)).toBe(true);
    for (const bad of [255, 701, 296.5, '296', NaN, null, undefined]) expect(isTreeWidth(bad), String(bad)).toBe(false);
  });

  it('says the same clamp in CSS, against the body width', () => {
    expect(treeWidthCss(412)).toBe('max(256px, min(412px, 700px, 100% - 401px))');
  });

  it('moves the divider with the pointer on either side', () => {
    expect(treeWidthForDrag(296, 300, 400, 'left')).toBe(396);
    expect(treeWidthForDrag(296, 1000, 900, 'right')).toBe(396);
    expect(treeWidthForDrag(296, 300, 0, 'left')).toBe(256);
    expect(treeWidthForDrag(296, 300, 3000, 'left', 1201)).toBe(700);
    expect(treeWidthForDrag(296, 300, 3000, 'left', 1001)).toBe(600);
  });

  it('steps 16 px with the arrows, in the arrow direction', () => {
    expect(TREE_WIDTH_STEP).toBe(16);
    expect(treeWidthForKey('ArrowRight', 296, 'left')).toEqual({ width: 312 });
    expect(treeWidthForKey('ArrowLeft', 296, 'left')).toEqual({ width: 280 });
    expect(treeWidthForKey('ArrowLeft', 296, 'right')).toEqual({ width: 312 });
    expect(treeWidthForKey('ArrowRight', 296, 'right')).toEqual({ width: 280 });
    expect(treeWidthForKey('ArrowLeft', 260, 'left')).toEqual({ width: 256 });
    expect(treeWidthForKey('ArrowRight', 690, 'left')).toEqual({ width: 700 });
    expect(treeWidthForKey('ArrowRight', 590, 'left', 1001)).toEqual({ width: 600 });
  });

  it('goes to the ends with Home and End, resets with Enter, and ignores other keys', () => {
    expect(treeWidthForKey('Home', 400, 'left')).toEqual({ width: 256 });
    expect(treeWidthForKey('End', 400, 'right')).toEqual({ width: 700 });
    expect(treeWidthForKey('End', 400, 'left', 1001)).toEqual({ width: 600 });
    expect(treeWidthForKey('Enter', 400, 'left')).toBe('reset');
    for (const key of ['ArrowUp', 'ArrowDown', 'PageUp', ' ', 'Escape', 'a']) expect(treeWidthForKey(key, 400, 'left'), key).toBeNull();
  });
});
