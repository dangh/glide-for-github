/**
 * The file tree pane's box: its width (layout.treeWidth, ../../shared/tree-width.ts) and the handle on its divider that
 * resizes it, like GitHub's. A drag shows its width every frame and saves it once, when it ends; arrow keys save when
 * the key goes up, so a held key is one write. A double-click or Enter goes back to the default width.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { DEFAULT_CHOICE } from '../../shared/settings';
import {
  clampTreeWidth,
  TREE_WIDTH_DEFAULT,
  TREE_WIDTH_MAX,
  TREE_WIDTH_MIN,
  treeWidthCss,
  treeWidthForDrag,
  treeWidthForKey,
} from '../../shared/tree-width';
import { useSettings } from '../state/settings';
import { usePr } from '../state/store';

/** A width being chosen and not saved yet: by a drag, or by keys still held. */
type Resize = { kind: 'idle' } | { kind: 'drag'; width: number } | { kind: 'keys'; width: number };

interface Drag {
  pointerId: number;
  startX: number;
  startWidth: number;
  space: number;
  x: number;
  frame: number;
}

const IDLE: Resize = { kind: 'idle' };

/** The pane's tree width and the width it shares with the diffs, as laid out now. */
function measure(handle: HTMLElement): { current: number; space: number } {
  const pane = handle.parentElement!;
  return { current: pane.clientWidth, space: pane.parentElement!.clientWidth };
}

export function TreePaneFrame({ children, testId }: { children?: ReactNode; testId?: string }) {
  const side = useSettings((s) => s.settings.layout.treePosition);
  const chosen = useSettings((s) => s.settings.layout.treeWidth);
  const update = useSettings((s) => s.update);
  const githubWidth = usePr((s) => s.pr?.viewer.treeWidth);
  const saved = chosen === DEFAULT_CHOICE ? (githubWidth ?? TREE_WIDTH_DEFAULT) : chosen;
  const [resize, setResize] = useState<Resize>(IDLE);
  const width = resize.kind === 'idle' ? clampTreeWidth(saved) : resize.width;
  const drag = useRef<Drag | null>(null);

  useEffect(
    () => () => {
      if (drag.current) cancelAnimationFrame(drag.current.frame);
      delete document.documentElement.dataset.treeResizing;
    },
    [],
  );

  const save = (next: number) => {
    setResize(IDLE);
    if (next !== saved) update({ layout: { treeWidth: next } });
  };
  const reset = () => {
    setResize(IDLE);
    if (chosen !== DEFAULT_CHOICE) update({ layout: { treeWidth: DEFAULT_CHOICE } });
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // No text selection and no native drag start under the pointer.
    e.preventDefault();
    const { current, space } = measure(e.currentTarget);
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointerId: e.pointerId, startX: e.clientX, startWidth: current, space, x: e.clientX, frame: 0 };
    document.documentElement.dataset.treeResizing = '';
    setResize({ kind: 'drag', width: current });
  };
  const finishDrag = () => {
    const d = drag.current;
    if (!d) return;
    cancelAnimationFrame(d.frame);
    drag.current = null;
    delete document.documentElement.dataset.treeResizing;
    if (d.x === d.startX) setResize(IDLE);
    else save(treeWidthForDrag(d.startWidth, d.startX, d.x, side, d.space));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    // The button is up but no pointerup came (it can get lost on its way into the iframe): the drag ended where it was.
    if ((e.buttons & 1) === 0) {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      finishDrag();
      return;
    }
    d.x = e.clientX;
    if (d.frame) return;
    d.frame = requestAnimationFrame(() => {
      d.frame = 0;
      setResize({ kind: 'drag', width: treeWidthForDrag(d.startWidth, d.startX, d.x, side, d.space) });
    });
  };
  // Capture ends with pointerup and with pointercancel alike.
  const onLostPointerCapture = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerId === drag.current?.pointerId) finishDrag();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (drag.current) return;
    const { current, space } = measure(e.currentTarget);
    const action = treeWidthForKey(e.key, current, side, space);
    if (!action) return;
    e.preventDefault();
    if (action === 'reset') reset();
    else setResize({ kind: 'keys', width: action.width });
  };
  const saveKeys = () => {
    if (resize.kind === 'keys') save(resize.width);
  };

  const handle = (
    <div
      className="tree-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize file tree"
      aria-valuenow={width}
      aria-valuemin={TREE_WIDTH_MIN}
      aria-valuemax={TREE_WIDTH_MAX}
      aria-valuetext={`${width} pixels`}
      tabIndex={0}
      data-testid="tree-resizer"
      data-dragging={resize.kind === 'drag' || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onLostPointerCapture={onLostPointerCapture}
      onDoubleClick={reset}
      onKeyDown={onKeyDown}
      onKeyUp={saveKeys}
      onBlur={saveKeys}
    />
  );
  // The handle sits between the tree and the diffs in the focus order too.
  return (
    <aside className="pierre-tree-pane" data-testid={testId} style={{ width: treeWidthCss(width) }}>
      {side === 'right' && handle}
      {children}
      {side === 'left' && handle}
    </aside>
  );
}
