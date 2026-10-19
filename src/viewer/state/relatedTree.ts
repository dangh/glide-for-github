/**
 * Related files in the file tree. @pierre/trees cannot nest a file under a file (a path is a file or a folder) and has
 * no per-row class, so a companion sits right after its main file (`relatedSort`) and is indented and dimmed by a
 * stylesheet keyed on its rows' `data-item-path` (`relatedTreeCss`).
 */
import type { FileTreeSortComparator, FileTreeSortEntry } from '@pierre/trees';
import type { Relations } from '../../shared/related-files';

// The library's default order, which it does not export: folders before files at each depth, then names compared
// case-insensitively with digit runs as numbers. Copied from @pierre/trees 1.0.0-beta.6 dist/path-store/src/sort.js.

type Token = string | number;
const isDigit = (c: number) => c >= 48 && c <= 57;

function naturalTokens(value: string): Token[] {
  const tokens: Token[] = [];
  let start = 0;
  let i = 0;
  while (i < value.length) {
    while (i < value.length && !isDigit(value.charCodeAt(i))) i += 1;
    if (i >= value.length) break;
    if (i > start) tokens.push(value.slice(start, i));
    let n = 0;
    while (i < value.length && isDigit(value.charCodeAt(i))) {
      n = n * 10 + (value.charCodeAt(i) - 48);
      i += 1;
    }
    tokens.push(n);
    start = i;
  }
  if (start < value.length || tokens.length === 0) tokens.push(value.slice(start));
  return tokens;
}

function compareTokens(a: Token[], b: Token[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1;
    const xs = String(x);
    const ys = String(y);
    if (xs !== ys) return xs < ys ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

function compareSegments(left: string, right: string): number {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  const byTokens = compareTokens(naturalTokens(a), naturalTokens(b));
  if (byTokens !== 0) return byTokens;
  if (a !== b) return a < b ? -1 : 1;
  return left === right ? 0 : left < right ? -1 : 1;
}

/** 1 for a folder segment, 0 for the file itself. */
const kindAt = (e: Pick<FileTreeSortEntry, 'segments' | 'isDirectory'>, depth: number) => (depth === e.segments.length - 1 && !e.isDirectory ? 0 : 1);

function compareDefault(left: Pick<FileTreeSortEntry, 'segments' | 'isDirectory'>, right: Pick<FileTreeSortEntry, 'segments' | 'isDirectory'>): number {
  const shared = Math.min(left.segments.length, right.segments.length);
  for (let depth = 0; depth < shared; depth++) {
    const a = left.segments[depth]!;
    const b = right.segments[depth]!;
    if (a === b) continue;
    const kind = kindAt(left, depth);
    if (kind !== kindAt(right, depth)) return kind === 1 ? -1 : 1;
    return compareSegments(a, b);
  }
  if (left.segments.length !== right.segments.length) return left.segments.length < right.segments.length ? -1 : 1;
  if (left.isDirectory === right.isDirectory) return 0;
  return left.isDirectory ? -1 : 1;
}

/**
 * The library's default order, except that a companion sorts as if it had its main file's name, right after it and in
 * the order of its main file's companions. `relations` is read at every comparison, so `resetPaths` after a change
 * re-sorts with the current relations (the tree takes its comparator once, when it is created).
 */
export function relatedSort(relations: () => Relations): FileTreeSortComparator {
  return (left, right) => {
    const r = relations();
    const keyOf = (e: FileTreeSortEntry) => {
      const main = e.isDirectory ? undefined : r.mainOf.get(e.path);
      if (main === undefined) return { entry: e, rank: 0 };
      const name = main.slice(main.lastIndexOf('/') + 1);
      return { entry: { segments: [...e.segments.slice(0, -1), name], isDirectory: false }, rank: r.companions.get(main)!.indexOf(e.path) + 1 };
    };
    const a = keyOf(left);
    const b = keyOf(right);
    return compareDefault(a.entry, b.entry) || a.rank - b.rank;
  };
}

const quote = (path: string) => `"${path.replace(/["\\]/g, '\\$&').replace(/\n/g, '\\a ')}"`;

/** The tree stylesheet that indents and dims each companion's row. */
export function relatedTreeCss(relations: Relations): string {
  if (relations.mainOf.size === 0) return '';
  const rows = [...relations.mainOf.keys()].map((p) => `[data-item-path=${quote(p)}]`).join(',\n');
  return `:is(${rows}) > [data-item-section='icon'] { margin-inline-start: 12px; }
:is(${rows}) > [data-item-section='content'] { opacity: 0.72; }`;
}
