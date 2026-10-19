/** What the options page's editable lists (file groups, related-files rules) share: their rows' actions and textarea sizing. */
import { useState } from 'react';
import { ArrowDownIcon, ArrowUpIcon, TrashIcon } from '../viewer/ui/icons';

/** A textarea's rows for `text`, one per line, within `min` and `max`. */
export const textRows = (text: string, min: number, max: number) => Math.min(max, Math.max(min, text.split('\n').length));

/**
 * A borderless list textarea shows at most `max` lines at rest, fading out when there are more (a cut-off line with
 * no border around it reads as a rendering glitch), and every line while focused.
 */
export function usePreviewRows(text: string, min: number, max: number) {
  const [editing, setEditing] = useState(false);
  const lines = text.split('\n').length;
  return {
    rows: editing ? Math.max(min, lines) : textRows(text, min, max),
    'data-more': (!editing && lines > max) || undefined,
    onFocus: () => setEditing(true),
    onBlur: () => setEditing(false),
  };
}

/** GitHub's borderless icon buttons for a row: move up, move down, delete. */
export function RowActions({ name, index, count, onMove, onDelete }: {
  name: string;
  index: number;
  count: number;
  onMove(by: -1 | 1): void;
  onDelete(): void;
}) {
  const up = `Move ${name} up`;
  const down = `Move ${name} down`;
  const remove = `Delete ${name}`;
  return (
    <span className="row-actions">
      <button type="button" className="row-action" aria-label={up} title={up} disabled={index === 0} onClick={() => onMove(-1)}>
        <ArrowUpIcon />
      </button>
      <button type="button" className="row-action" aria-label={down} title={down} disabled={index === count - 1} onClick={() => onMove(1)}>
        <ArrowDownIcon />
      </button>
      <button type="button" className="row-action row-action-danger" aria-label={remove} title={remove} onClick={onDelete}>
        <TrashIcon />
      </button>
    </span>
  );
}
