/**
 * Per-file header inside the CodeView (custom header slot). Subscribes to its own file's state, so a
 * change to one file re-renders one header; the CodeView item only changes for diff/collapse/annotations.
 *
 * Layout must stay one row of exactly `headerHeight(diff.fileHeaderStyle)` px: CodeView reserves
 * `itemMetrics.diffHeaderHeight` for it and does not measure headers.
 *
 * Related files (state/relatedFiles.ts) change a header by the file's role, set on it as `data-related` for
 * viewer.css: a main file's Viewed covers its folded companions ('nested'); a companion is a one-line row ('nested'); a
 * 'box' file has a sub-header without Viewed under its group's summary header (`GroupHeader`); a 'rail' file keeps its
 * own header.
 */
import { memo, useCallback } from 'react';
import { CHEVRON_DOWN, CHEVRON_RIGHT } from '../../shared/github-tree-icons';
import { filesChangedUrl } from '../../shared/pr-url';
import { isLockFile } from '../../shared/related-files';
import { isNoTokenError } from '../auth/requireToken';
import type { FileSummary } from '../github/private';
import { fileTarget } from '../state/compose';
import { useRole, type Role } from '../state/relatedFiles';
import { errorMessage, FilesViewedError, setFilesViewed } from '../state/review';
import { session } from '../state/session';
import { commentCount, isCollapsed, threadsByPath, usePr, type FileLoadState } from '../state/store';
import { useSettings } from '../state/settings';
import { headerHeight } from '../state/view';
import { openComposerAt } from './Composer';

/** Octicon comment-16 path. */
export function CommentIcon() {
  return (
    <svg className="icon" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"
      />
    </svg>
  );
}

const STATUS_BADGE: Record<FileSummary['status'], { letter: string; title: string }> = {
  added: { letter: 'A', title: 'Added' },
  modified: { letter: 'M', title: 'Modified' },
  deleted: { letter: 'D', title: 'Deleted' },
  renamed: { letter: 'R', title: 'Renamed' },
};

function LoadNotice({ path, load, summary }: { path: string; load: FileLoadState | undefined; summary: FileSummary }) {
  const loadLines = useCallback(() => {
    void session.loader?.loadLines(path).catch(() => undefined);
  }, [path]);
  const retry = useCallback(() => session.loader?.retry(path), [path]);
  switch (load?.status) {
    case undefined:
    case 'pending':
    case 'loading':
      return <span className="fh-note fh-muted">Loading…</span>;
    case 'needs-lines':
      if (load.message)
        return (
          <span className="fh-note fh-error" title={load.message}>
            Failed to load <button className="fh-link" onClick={loadLines}>Retry</button>
          </span>
        );
      return <span className="fh-note fh-muted">Loading…</span>;
    case 'too-large':
      if (load.loadingLines) return <span className="fh-note fh-muted">Loading diff…</span>;
      if (load.tooBig) {
        const ref = usePr.getState().pr?.ref;
        return (
          <span className="fh-note fh-muted" data-testid="too-big">
            Diff is too big to render.{' '}
            {ref && (
              <a className="fh-link" href={filesChangedUrl(ref, summary.digest)} target="_blank" rel="noopener noreferrer">
                Open on GitHub
              </a>
            )}
          </span>
        );
      }
      return (
        <span className="fh-note" title={load.message}>
          {load.message ? 'Failed to load. ' : 'Large diff not rendered by default. '}
          <button className="fh-button" data-testid="load-diff" onClick={loadLines}>
            Load diff
          </button>
        </span>
      );
    case 'binary':
      return <span className="fh-note fh-muted" data-testid="binary">Binary file not shown</span>;
    case 'error':
      return (
        <span className="fh-note fh-error" title={load.message}>
          Failed to load <button className="fh-link" onClick={retry}>Retry</button>
        </span>
      );
    case 'loaded':
      if (!load.empty) return null;
      if (load.message) return <span className="fh-note fh-muted">{load.message}</span>;
      if (summary.prevPath) return <span className="fh-note fh-muted">File renamed without changes</span>;
      return <span className="fh-note fh-muted">No changes to show</span>;
  }
}

/** A file's look in its group of related files (`data-related` on the header). */
function variantOf(role: Role | undefined): string | undefined {
  if (!role || role.kind === 'group') return undefined;
  return role.kind === 'member' ? `${role.style}-member` : role.kind;
}

/** Marks `files` viewed or not (optimistic, reverted with an error toast for the files GitHub refuses). */
function markViewed(files: readonly string[], next: boolean) {
  setFilesViewed(files, next).catch((err: unknown) => {
    if (isNoTokenError(err)) return; // token prompt cancelled: reverted, nothing to report
    const which = err instanceof FilesViewedError ? err.paths.join(', ') : files.join(', ');
    usePr.getState().setNotice({ kind: 'error', message: `Could not ${next ? 'mark' : 'unmark'} ${which} as viewed. ${errorMessage(err)}` });
  });
}

function Chevron({ collapsed, label, onClick }: { collapsed: boolean; label: string; onClick(): void }) {
  return (
    <button className="fh-chevron" aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label}`} aria-expanded={!collapsed} onClick={onClick}>
      <svg className="icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path fill="currentColor" d={collapsed ? CHEVRON_RIGHT : CHEVRON_DOWN} />
      </svg>
    </button>
  );
}

function Counts({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="fh-counts">
      {additions > 0 && <span className="fh-add">+{additions}</span>}
      {deletions > 0 && <span className="fh-del">−{deletions}</span>}
    </span>
  );
}

function Comments({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="fh-comments" title={`${count} comment${count === 1 ? '' : 's'}`}>
      <CommentIcon /> {count}
    </span>
  );
}

function Viewed({ checked, label, onChange }: { checked: boolean; label: string; onChange(next: boolean): void }) {
  return (
    <label className="fh-viewed">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} /> {label}
    </label>
  );
}

const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

export const FileHeader = memo(function FileHeader({ path }: { path: string }) {
  const summary = usePr((s) => s.files.get(path));
  const load = usePr((s) => s.load.get(path));
  const role = useRole(path);
  const group = role?.kind === 'main' ? role.files : undefined;
  const viewed = usePr((s) => (group ? group.every((f) => s.viewed.has(f)) : s.viewed.has(path)));
  const collapsed = usePr((s) => isCollapsed(s, path));
  const comments = usePr((s) => commentCount(threadsByPath(s.threads).get(path)));
  const height = useSettings((s) => headerHeight(s.settings.diff.fileHeaderStyle));

  const toggleCollapsed = useCallback(() => {
    const s = usePr.getState();
    s.setCollapsed(path, !isCollapsed(s, path));
  }, [path]);

  // Optimistic (checks and collapses at once), reverted with an error toast if GitHub refuses (see setFileViewed).
  const onViewed = useCallback((next: boolean) => markViewed(group ?? [path], next), [group, path]);

  if (!summary) return null;
  const variant = variantOf(role);
  /** A file shown as part of its main file's box: named by its file name, no Viewed of its own. */
  const part = variant === 'companion' || variant === 'box-member';
  const badge = STATUS_BADGE[summary.status];
  const additions = load?.additions ?? summary.additions;
  const deletions = load?.deletions ?? summary.deletions;
  const copyPath = () => void navigator.clipboard?.writeText(path).catch(() => undefined);
  const companion = role?.kind === 'companion' || (role?.kind === 'member' && role.main !== path);
  const last = (role?.kind === 'companion' || role?.kind === 'member') && role.last;

  return (
    <div
      className="fh"
      data-path={path}
      data-viewed={viewed || undefined}
      data-related={variant}
      data-last={last ? '' : undefined}
      data-collapsed={collapsed ? '' : undefined}
      style={{ height }}
    >
      <Chevron collapsed={collapsed} label={part ? nameOf(path) : 'file'} onClick={toggleCollapsed} />
      <span className={`fh-badge fh-${summary.status}`} title={badge.title}>
        {badge.letter}
      </span>
      <span className="fh-path" title={summary.prevPath ? `${summary.prevPath} → ${path}` : path} onDoubleClick={copyPath}>
        {summary.prevPath && !part ? (
          <>
            <span className="fh-prev" data-testid="prev-path">{summary.prevPath}</span>
            <span className="fh-arrow"> → </span>
          </>
        ) : null}
        <span className="fh-name">{part ? nameOf(path) : path}</span>
      </span>
      {companion && isLockFile(path) && <span className="fh-tag">lock file</span>}
      <Counts additions={additions} deletions={deletions} />
      <LoadNotice path={path} load={load} summary={summary} />
      <span className="fh-grow" />
      <Comments count={comments} />
      <button
        type="button"
        className="fh-icon-button"
        title="Comment on file"
        aria-label="Comment on file"
        data-testid="comment-on-file"
        onClick={() => openComposerAt(fileTarget(path))}
      >
        <CommentIcon />+
      </button>
      {!part && <Viewed checked={viewed} label="Viewed" onChange={onViewed} />}
    </div>
  );
});

const NO_FILES: readonly string[] = Object.freeze([]);

/**
 * A group item's header ('box', 'rail'): the main file's path and how many files the group holds, their summed
 * counts and comments, one chevron for every file and one Viewed for every file (checked when all are viewed).
 */
export const GroupHeader = memo(function GroupHeader({ id }: { id: string }) {
  const role = useRole(id);
  const files = role?.kind === 'group' ? role.files : NO_FILES;
  const viewed = usePr((s) => files.length > 0 && files.every((f) => s.viewed.has(f)));
  const collapsed = usePr((s) => files.length > 0 && files.every((f) => isCollapsed(s, f)));
  /** "additions:deletions", a string so the selector's result compares by value. */
  const totals = usePr((s) => {
    let additions = 0;
    let deletions = 0;
    for (const f of files) {
      const summary = s.files.get(f);
      const load = s.load.get(f);
      additions += load?.additions ?? summary?.additions ?? 0;
      deletions += load?.deletions ?? summary?.deletions ?? 0;
    }
    return `${additions}:${deletions}`;
  });
  const comments = usePr((s) => files.reduce((n, f) => n + commentCount(threadsByPath(s.threads).get(f)), 0));
  const height = useSettings((s) => headerHeight(s.settings.diff.fileHeaderStyle));

  const toggleCollapsed = useCallback(() => {
    const s = usePr.getState();
    const next = !files.every((f) => isCollapsed(s, f));
    for (const f of files) s.setCollapsed(f, next);
  }, [files]);
  const onViewed = useCallback((next: boolean) => markViewed(files, next), [files]);

  if (role?.kind !== 'group') return null;
  const [additions, deletions] = totals.split(':').map(Number) as [number, number];
  const box = role.style === 'box';
  return (
    <div
      className="fh"
      data-path={id}
      data-related={`${role.style}-group`}
      data-viewed={viewed || undefined}
      data-collapsed={collapsed ? '' : undefined}
      style={{ height }}
    >
      <Chevron collapsed={collapsed} label={`${files.length} related files`} onClick={toggleCollapsed} />
      <span className="fh-path" title={files.join('\n')}>
        <span className="fh-name">{role.main}</span>
        <span className="fh-group-count">{box ? ` + ${files.length - 1} related` : ` · ${files.length} files`}</span>
      </span>
      <Counts additions={additions} deletions={deletions} />
      <span className="fh-grow" />
      <Comments count={comments} />
      <Viewed checked={viewed} label={box ? 'Viewed' : 'Viewed all'} onChange={onViewed} />
    </div>
  );
});
