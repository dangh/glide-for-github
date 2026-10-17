/**
 * Converts GitHub diff rows (R§1.2) into Pierre's FileDiffMetadata by synthesizing a git patch and
 * parsing it with Pierre's own `getSingularPatch`.
 */
import { getSingularPatch, type FileDiffMetadata } from '@pierre/diffs';
import type { FileSummary, GithubDiffLine } from './private';

export interface ConvertContext {
  /** Head commit shown; part of the cache key. */
  headOid: string;
  /** The `w` flag the lines were fetched with (true = `w=1`, whitespace hidden); part of the cache key. */
  whitespace: boolean;
}

const NAMED_ESCAPES: Record<string, string> = { '"': '\\"', '\\': '\\\\', '\t': '\\t', '\n': '\\n', '\r': '\\r', '\x07': '\\a', '\b': '\\b', '\v': '\\v', '\f': '\\f' };

/**
 * Git-style C quoting (`"a/my \"file\""`). Names are always quoted so that spaces, ` b/`, quotes,
 * backslashes, tabs and leading/trailing whitespace survive Pierre's header parsing. Non-ASCII stays
 * literal (Pierre keeps unescaped characters as-is).
 */
function quote(name: string): string {
  let out = '"';
  for (const ch of name) {
    const code = ch.codePointAt(0)!;
    if (NAMED_ESCAPES[ch] !== undefined) out += NAMED_ESCAPES[ch];
    else if (code < 0x20 || code === 0x7f) out += '\\' + code.toString(8).padStart(3, '0');
    else out += ch;
  }
  return out + '"';
}

interface HunkHeader {
  delStart: number;
  addStart: number;
  section: string;
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/;

function parseHunk(text: string): HunkHeader | undefined {
  const m = HUNK_RE.exec(text);
  return m ? { delStart: Number(m[1]), addStart: Number(m[2]), section: m[3] ?? '' } : undefined;
}

interface Hunk {
  header?: HunkHeader;
  body: string[];
  delStart?: number;
  addStart?: number;
  delCount: number;
  addCount: number;
  /** Next expected old/new line numbers, to detect gaps. */
  nextLeft?: number;
  nextRight?: number;
}

/**
 * Hunks from GitHub rows. HUNK rows open a hunk; `~` (INJECTED_CONTEXT) rows are context. Header
 * counts are recomputed from the body (injected context changes them) and starts come from the first
 * row on each side; a jump in line numbers opens a new hunk. A side without rows keeps the start from
 * the HUNK header (git's `-N,0` convention).
 */
function toHunks(lines: GithubDiffLine[]): Hunk[] {
  const hunks: Hunk[] = [];
  let cur: Hunk | undefined;
  const open = (header?: HunkHeader): Hunk => {
    cur = { ...(header ? { header } : {}), body: [], delCount: 0, addCount: 0 };
    hunks.push(cur);
    return cur;
  };

  for (const row of lines) {
    if (row.type === 'HUNK') {
      open(parseHunk(row.text));
      continue;
    }
    const content = row.text.slice(1);
    const isAdd = row.type === 'ADDITION';
    const isDel = row.type === 'DELETION';
    const isCtx = row.type === 'CONTEXT' || row.type === 'INJECTED_CONTEXT';
    if (!isAdd && !isDel && !isCtx) continue;
    const left = isAdd ? undefined : row.left ?? undefined;
    const right = isDel ? undefined : row.right ?? undefined;

    let h = cur ?? open();
    const gap =
      (left !== undefined && h.nextLeft !== undefined && left !== h.nextLeft) ||
      (right !== undefined && h.nextRight !== undefined && right !== h.nextRight);
    if (gap) h = open();

    if (left !== undefined) {
      h.delStart ??= left;
      h.nextLeft = left + 1;
      h.delCount++;
    }
    if (right !== undefined) {
      h.addStart ??= right;
      h.nextRight = right + 1;
      h.addCount++;
    }
    h.body.push((isAdd ? '+' : isDel ? '-' : ' ') + content);
    if (row.displayNoNewLineWarning) h.body.push('\\ No newline at end of file');
  }
  return hunks.filter((h) => h.body.length > 0);
}

function hunkHeader(h: Hunk): string {
  // A side without rows: git writes the line before the change (`-0,0` for a new file).
  const delStart = h.delStart ?? h.header?.delStart ?? Math.max((h.addStart ?? 1) - 1, 0);
  const addStart = h.addStart ?? h.header?.addStart ?? Math.max((h.delStart ?? 1) - 1, 0);
  const section = h.header?.section ? ` ${h.header.section}` : '';
  return `@@ -${delStart},${h.delCount} +${addStart},${h.addCount} @@${section}`;
}

/**
 * The git patch for one file: `diff --git` header (with `new file mode`, `deleted file mode` or a
 * rename block from `prevPath`), `---`/`+++` when there are hunks, then hunks built from the rows.
 * The similarity index of a rename is synthetic (100% without changed lines, else 90%); Pierre only
 * uses it to tell `rename-pure` from `rename-changed`.
 */
export function buildPatch(summary: FileSummary, lines: GithubDiffLine[]): string {
  const oldPath = summary.prevPath ?? summary.path;
  const newPath = summary.path;
  const isAdded = summary.status === 'added';
  const isDeleted = summary.status === 'deleted';
  const isRename = summary.prevPath !== undefined && summary.prevPath !== summary.path;
  const hunks = toHunks(lines);

  const out = [`diff --git ${quote('a/' + oldPath)} ${quote('b/' + newPath)}`];
  if (isAdded) out.push('new file mode 100644');
  else if (isDeleted) out.push('deleted file mode 100644');
  else if (isRename) {
    const changed = lines.some((l) => l.type === 'ADDITION' || l.type === 'DELETION');
    out.push(`similarity index ${changed ? 90 : 100}%`, `rename from ${quote(oldPath)}`, `rename to ${quote(newPath)}`);
  }
  if (hunks.length > 0) {
    out.push(`--- ${isAdded ? '/dev/null' : quote('a/' + oldPath)}`, `+++ ${isDeleted ? '/dev/null' : quote('b/' + newPath)}`);
    for (const h of hunks) out.push(hunkHeader(h), ...h.body);
  }
  return out.join('\n') + '\n';
}

/** Pierre metadata for one file; `cacheKey` = `${digest}:${headOid}:${w}`. */
export function toFileDiff(summary: FileSummary, lines: GithubDiffLine[], ctx: ConvertContext): FileDiffMetadata {
  const diff = getSingularPatch(buildPatch(summary, lines));
  diff.cacheKey = `${summary.digest}:${ctx.headOid}:${ctx.whitespace ? 1 : 0}`;
  return diff;
}
