/**
 * Comment targets (line, range, file) for new-thread composers, their drafts, and the pure helpers the
 * composer needs (suggestion blocks, preview context).
 *
 * An open new-thread composer IS a draft in the store (`drafts`, keyed by `draftKey.line`) that carries a
 * `path` and no `threadId`/`databaseId`. The annotation source turns those drafts into CodeView annotations.
 */
import type { FileDiffMetadata, SelectedLineRange } from '@pierre/diffs';
import type { PreviewContext } from '../../shared/rpc';
import type { PrData } from '../github/private';
import type { DiffSide } from '../github/threads';
import { rangeOids, type CommitRange } from './range';
import { draftKey, usePr, type Draft, type DraftKey, type PrState } from './store';

export interface CommentTarget {
  path: string;
  /** End side (`side` in GitHub's API). */
  side: DiffSide;
  /** End line; 0 for a file-level comment. */
  line: number;
  /** Only for multi-line ranges. */
  startLine?: number;
  startSide?: DiffSide;
  subject: 'line' | 'file';
}

/** A gutter / line selection range from Pierre as a comment target: ordered top to bottom, start only when multi-line. */
export function targetFromRange(path: string, range: SelectedLineRange): CommentTarget {
  let a = { line: range.start, side: range.side ?? 'additions' };
  let b = { line: range.end, side: range.endSide ?? range.side ?? 'additions' };
  // Same side: lower line first. Across sides (unified view): the old (deletions) side starts the range.
  if ((a.side === b.side && a.line > b.line) || (a.side === 'additions' && b.side === 'deletions')) [a, b] = [b, a];
  const target: CommentTarget = { path, side: b.side, line: b.line, subject: 'line' };
  if (a.line !== b.line || a.side !== b.side) {
    target.startLine = a.line;
    target.startSide = a.side;
  }
  return target;
}

export const fileTarget = (path: string): CommentTarget => ({ path, side: 'additions', line: 0, subject: 'file' });

export const targetKey = (t: CommentTarget): DraftKey => draftKey.line(t.path, t.side, t.line, t.startLine);

/** The new-thread target a draft stands for, or undefined for reply/edit/summary drafts. */
export function targetOfDraft(d: Draft | undefined): CommentTarget | undefined {
  if (!d?.path || d.threadId !== undefined || d.databaseId !== undefined) return undefined;
  const t: CommentTarget = { path: d.path, side: d.side ?? 'additions', line: d.line ?? 0, subject: d.subject ?? 'line' };
  if (d.startLine !== undefined) {
    t.startLine = d.startLine;
    t.startSide = d.startSide ?? t.side;
  }
  return t;
}

type StoreLike = { getState(): PrState };

/** Opens a new-thread composer (an empty draft) unless one is already open there. Returns its key. */
export function openComposerIn(store: StoreLike, target: CommentTarget): DraftKey {
  const key = targetKey(target);
  const s = store.getState();
  if (s.drafts.has(key)) return key;
  s.setDraft(key, {
    body: '',
    path: target.path,
    side: target.side,
    line: target.line,
    ...(target.startLine !== undefined ? { startLine: target.startLine, startSide: target.startSide ?? target.side } : {}),
    subject: target.subject,
    updatedAt: Date.now(),
  });
  return key;
}

export const openComposer = (target: CommentTarget): DraftKey => openComposerIn(usePr, target);

// ---- suggestions -------------------------------------------------------------------------------------

/** Text of new-side line `n` (1-based), or undefined if the diff does not contain it. */
function newSideLine(diff: FileDiffMetadata, n: number): string | undefined {
  if (!diff.isPartial) return diff.additionLines[n - 1];
  for (const h of diff.hunks) {
    if (n >= h.additionStart && n < h.additionStart + h.additionCount) return diff.additionLines[h.additionLineIndex + n - h.additionStart];
  }
  return undefined;
}

/** New-side lines `start..end` (without line endings), or null when any of them is not in the diff. */
export function newSideLines(diff: FileDiffMetadata, start: number, end: number): string[] | null {
  const out: string[] = [];
  for (let n = start; n <= end; n++) {
    const text = newSideLine(diff, n);
    if (text === undefined) return null;
    out.push(text.replace(/\r?\n$/, ''));
  }
  return out;
}

export const suggestionBlock = (lines: string[]): string => '```suggestion\n' + lines.join('\n') + '\n```';

/** Lines a suggestion for `target` replaces: new-side only (GitHub applies suggestions to the new file). */
export function suggestionFor(target: CommentTarget, diff: FileDiffMetadata | undefined): string | null {
  if (!diff || target.subject !== 'line' || target.side !== 'additions') return null;
  if (target.startLine !== undefined && target.startSide !== 'additions') return null;
  const lines = newSideLines(diff, target.startLine ?? target.line, target.line);
  return lines ? suggestionBlock(lines) : null;
}

/** Inserts `block` at the selection, on its own lines. Returns the new value and the caret after the block. */
export function insertBlock(value: string, selStart: number, selEnd: number, block: string): { value: string; caret: number } {
  const before = value.slice(0, selStart);
  const after = value.slice(selEnd);
  const lead = before && !before.endsWith('\n') ? '\n' : '';
  const trail = after && !after.startsWith('\n') ? '\n' : '';
  const next = before + lead + block + trail + after;
  return { value: next, caret: (before + lead + block).length };
}

// ---- preview -----------------------------------------------------------------------------------------

/** What GitHub's composer sends to `/preview` (R§6), so `suggestion` blocks render as diffs. */
export function previewContext(pr: PrData, range: CommitRange, target?: CommentTarget): PreviewContext {
  const { oldOid, newOid } = rangeOids(pr, range);
  const ctx: PreviewContext = { owner: pr.ref.owner, repo: pr.ref.repo, number: pr.ref.number, baseOid: oldOid, headOid: newOid };
  if (pr.databaseId !== undefined) ctx.issueId = pr.databaseId;
  if (pr.repositoryId !== undefined) ctx.repositoryId = pr.repositoryId;
  if (target) {
    ctx.path = target.path;
    if (target.subject === 'line') {
      ctx.line = target.line;
      if (target.startLine !== undefined) ctx.startLine = target.startLine;
    }
  }
  return ctx;
}
