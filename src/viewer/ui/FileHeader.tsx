/**
 * Per-file header inside the CodeView (custom header slot). Subscribes to its own file's state, so a
 * change to one file re-renders one header; the CodeView item only changes for diff/collapse/annotations.
 *
 * Layout must stay one row of exactly `HEADER_HEIGHT` px: CodeView reserves `itemMetrics.diffHeaderHeight`
 * for it and does not measure headers.
 */
import { memo, useCallback } from 'react';
import { isNoTokenError, requireToken } from '../auth/requireToken';
import type { FileSummary } from '../github/private';
import { session } from '../state/session';
import { commentCount, isCollapsed, threadsByPath, usePr, type FileLoadState } from '../state/store';
import { filesChangedUrl, HEADER_HEIGHT } from '../state/view';

export { HEADER_HEIGHT };


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

export const FileHeader = memo(function FileHeader({ path }: { path: string }) {
  const summary = usePr((s) => s.files.get(path));
  const load = usePr((s) => s.load.get(path));
  const viewed = usePr((s) => s.viewed.has(path));
  const collapsed = usePr((s) => isCollapsed(s, path));
  const comments = usePr((s) => commentCount(threadsByPath(s.threads).get(path)));
  const owner = usePr((s) => s.pr?.ref.owner ?? '');

  const toggleCollapsed = useCallback(() => {
    const s = usePr.getState();
    s.setCollapsed(path, !isCollapsed(s, path));
  }, [path]);

  const onViewed = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      // Token-gated (Task 10 adds the optimistic toggle and the GraphQL mutation); keep the current state.
      event.preventDefault();
      requireToken(owner, 'mark files as viewed').catch((err: unknown) => {
        usePr.getState().setNotice({
          kind: 'info',
          message: isNoTokenError(err) ? 'Marking files as viewed needs a GitHub token (coming soon).' : String(err),
        });
      });
    },
    [owner],
  );

  if (!summary) return null;
  const badge = STATUS_BADGE[summary.status];
  const additions = load?.additions ?? summary.additions;
  const deletions = load?.deletions ?? summary.deletions;
  const copyPath = () => void navigator.clipboard?.writeText(path).catch(() => undefined);

  return (
    <div className="fh" data-path={path} data-viewed={viewed || undefined} style={{ height: HEADER_HEIGHT }}>
      <button
        className="fh-chevron"
        aria-label={collapsed ? 'Expand file' : 'Collapse file'}
        aria-expanded={!collapsed}
        onClick={toggleCollapsed}
      >
        {collapsed ? '▸' : '▾'}
      </button>
      <span className={`fh-badge fh-${summary.status}`} title={badge.title}>
        {badge.letter}
      </span>
      <span className="fh-path" title={summary.prevPath ? `${summary.prevPath} → ${path}` : path} onDoubleClick={copyPath}>
        {summary.prevPath ? (
          <>
            <span className="fh-prev" data-testid="prev-path">{summary.prevPath}</span>
            <span className="fh-arrow"> → </span>
          </>
        ) : null}
        <span className="fh-name">{path}</span>
      </span>
      <span className="fh-counts">
        {additions > 0 && <span className="fh-add">+{additions}</span>}
        {deletions > 0 && <span className="fh-del">−{deletions}</span>}
      </span>
      <LoadNotice path={path} load={load} summary={summary} />
      <span className="fh-grow" />
      {comments > 0 && (
        <span className="fh-comments" title={`${comments} comment${comments === 1 ? '' : 's'}`}>
          <CommentIcon /> {comments}
        </span>
      )}
      <label className="fh-viewed">
        <input type="checkbox" checked={viewed} onChange={onViewed} /> Viewed
      </label>
    </div>
  );
});
