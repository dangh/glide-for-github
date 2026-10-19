/** What the options page's editable lists (file groups, related-files rules) share: their rows' actions and textarea sizing. */
import { ArrowDownIcon, ArrowUpIcon, TrashIcon } from '../viewer/ui/icons';

/** A textarea's rows for `text`, one per line, within `min` and `max`. */
export const textRows = (text: string, min: number, max: number) => Math.min(max, Math.max(min, text.split('\n').length));

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
