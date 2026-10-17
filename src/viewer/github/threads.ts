/**
 * Merges GitHub's thread payloads (R§2) into positioned thread models for the viewer and review UI.
 */
import type { GithubComment, GithubDiffSide, GithubThread, RawThreads } from './private';

export type DiffSide = 'additions' | 'deletions';

export interface CommentModel {
  databaseId: number;
  nodeId: string;
  author: { login: string; avatarUrl: string };
  body: string;
  bodyHTML: string;
  bodyVersion: string;
  createdAt: string;
  state: 'pending' | 'submitted';
  reactions: { content: string; count: number; viewerHasReacted: boolean }[];
  viewerCanUpdate: boolean;
  viewerCanDelete: boolean;
}

export interface ThreadModel {
  /** Numeric thread database id (string), as used by page_data resolve/unresolve. */
  id: string;
  path: string;
  side: DiffSide;
  /** End line on `side`. 0 for file-level threads. For outdated threads, the original line. */
  line: number;
  /** Only on multi-line threads (start differs from the end). */
  startLine?: number;
  startSide?: DiffSide;
  subject: 'line' | 'file';
  isOutdated: boolean;
  isResolved: boolean;
  comments: CommentModel[];
  viewerCanReply: boolean;
}

const fromGithubSide = (side: GithubDiffSide | string | null | undefined): DiffSide | undefined =>
  side === 'LEFT' ? 'deletions' : side === 'RIGHT' ? 'additions' : undefined;

/** `R12` / `L3` marker keys (R§1.1). */
function parseMarkerKey(key: string | undefined): { side: DiffSide; line: number } | undefined {
  const m = key ? /^([LR])(\d+)$/.exec(key) : null;
  return m ? { side: m[1] === 'L' ? 'deletions' : 'additions', line: Number(m[2]) } : undefined;
}

const num = (v: number | null | undefined): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function toComment(c: GithubComment): CommentModel {
  return {
    databaseId: c.databaseId,
    nodeId: c.relayId ?? c.id,
    author: { login: c.author?.login ?? 'ghost', avatarUrl: c.author?.avatarUrl ?? '' },
    body: c.body,
    bodyHTML: c.bodyHTML,
    bodyVersion: c.bodyVersion,
    createdAt: c.createdAt,
    state: c.state === 'pending' ? 'pending' : 'submitted',
    reactions: (c.reactionGroups ?? []).map((g) => ({
      content: g.reaction.content,
      count: g.totalCount,
      viewerHasReacted: g.reaction.viewerHasReacted === true,
    })),
    viewerCanUpdate: c.viewerCanUpdate === true,
    viewerCanDelete: c.viewerCanDelete === true,
  };
}

interface Position {
  path: string;
  side?: DiffSide;
  line?: number;
  startSide?: DiffSide;
  startLine?: number;
}

/**
 * One model per thread that can be placed on a file. Position sources, in order:
 * 1. non-outdated threads: `markersMap` key (`R9` → additions line 9) and its `start` (`R8`);
 * 2. `thread_previews`: original lines (`subject.originalStartLine/originalEndLine`) for outdated
 *    threads, current `startLine`/`line` otherwise, sides from `diffSide`/`startDiffSide`;
 * 3. `thread_preview_positioning`: `startLine`/`endLine` with `startDiffSide`/`endDiffSide`.
 * `isOutdated` comes from the preview (or positioning); a line thread found nowhere is skipped.
 * GitHub `RIGHT` → `additions`, `LEFT` → `deletions`.
 */
export function toThreadModels(raw: RawThreads): ThreadModel[] {
  const markerOf = new Map<string, { path: string; key: string; start?: string }>();
  for (const [path, map] of Object.entries(raw.markers)) {
    for (const [key, marker] of Object.entries(map)) {
      for (const t of marker.threads ?? []) markerOf.set(String(t.id), { path, key, ...(t.start ? { start: t.start } : {}) });
    }
  }
  const previewOf = new Map(raw.previews.map((p) => [String(p.id), p]));

  const models: ThreadModel[] = [];
  for (const thread of raw.threads) {
    const model = toModel(thread);
    if (model) models.push(model);
  }
  return models;

  function toModel(thread: GithubThread): ThreadModel | undefined {
    const id = String(thread.id);
    const marker = markerOf.get(id);
    const preview = previewOf.get(id);
    const positioning = raw.positioning[id];
    const subject: ThreadModel['subject'] = thread.subjectType === 'FILE' || marker?.key === 'FILE' ? 'file' : 'line';
    const isOutdated = preview ? preview.isOutdated === true : positioning ? positioning.isOutdated === true : false;

    let pos: Position | undefined;
    const end = parseMarkerKey(marker?.key);
    if (marker && !isOutdated && (end || subject === 'file')) {
      const start = parseMarkerKey(marker.start);
      pos = { path: marker.path, ...end, ...(start ? { startSide: start.side, startLine: start.line } : {}) };
    } else if (preview) {
      const s = preview.subject ?? {};
      const line = isOutdated ? num(s.originalEndLine) ?? num(preview.line) : num(preview.line) ?? num(s.endLine);
      const startLine = isOutdated ? num(s.originalStartLine) ?? num(preview.startLine) : num(preview.startLine) ?? num(s.startLine);
      pos = {
        path: preview.path,
        side: fromGithubSide(preview.diffSide ?? s.endDiffSide),
        line,
        startSide: fromGithubSide(preview.startDiffSide ?? s.startDiffSide),
        startLine,
      };
    } else if (positioning?.path) {
      pos = {
        path: positioning.path,
        side: fromGithubSide(positioning.endDiffSide),
        line: num(positioning.endLine),
        startSide: fromGithubSide(positioning.startDiffSide),
        startLine: num(positioning.startLine),
      };
    } else if (marker) {
      pos = { path: marker.path, ...end };
    }
    if (!pos?.path) return undefined;
    if (subject === 'line' && pos.line === undefined) return undefined;

    const side = pos.side ?? 'additions';
    const line = subject === 'file' ? 0 : pos.line!;
    const startSide = pos.startSide ?? side;
    const multi = subject === 'line' && pos.startLine !== undefined && (pos.startLine !== line || startSide !== side);
    const comments = thread.commentsData?.comments ?? preview?.commentsData?.comments ?? [];

    return {
      id,
      path: pos.path,
      side,
      line,
      ...(multi ? { startLine: pos.startLine!, startSide } : {}),
      subject,
      isOutdated,
      isResolved: thread.isResolved === true,
      comments: comments.map(toComment),
      viewerCanReply: thread.viewerCanReply === true,
    };
  }
}
