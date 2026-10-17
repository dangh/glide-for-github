/** Transient notices (bottom toast), the "PR updated" banner (Task 11) and the full-pane error. */
import { memo, useEffect } from 'react';
import { reloadPr } from '../state/load';
import { errorMessage } from '../state/review';
import { usePr } from '../state/store';

/** Soft reload (keeps the suggestion batch and drafts); a failure is shown as a notice. */
export function reloadPullRequest(): Promise<void> {
  return reloadPr().catch((err: unknown) => usePr.getState().setNotice({ kind: 'error', message: `Could not reload the pull request. ${errorMessage(err)}` }));
}

const INFO_TIMEOUT_MS = 6000;

export const Notice = memo(function Notice() {
  const notice = usePr((s) => s.notice);
  const headMoved = usePr((s) => s.headMoved);

  useEffect(() => {
    if (notice?.kind !== 'info') return;
    const t = setTimeout(() => {
      if (usePr.getState().notice === notice) usePr.getState().setNotice(null);
    }, INFO_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [notice]);

  return (
    <>
      {headMoved && (
        <div className="banner" role="status">
          This pull request was updated.{' '}
          <button className="fh-link" onClick={() => void reloadPullRequest()}>
            Reload
          </button>
        </div>
      )}
      {notice && (
        <div className={`toast toast-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          <span>{notice.message}</span>
          <button className="toast-close" aria-label="Dismiss" onClick={() => usePr.getState().setNotice(null)}>
            ×
          </button>
        </div>
      )}
    </>
  );
});

/** Full-pane error: what went wrong, GitHub's own Files changed page as the way out, and Try again when it can help. */
export function FatalError({ message, filesUrl, onRetry }: { message: string; filesUrl?: string; onRetry?: () => void }) {
  return (
    <div className="fatal" role="alert">
      <h2>Pierre could not load this pull request</h2>
      <p>{message}</p>
      <p className="fatal-actions">
        {onRetry && (
          <button type="button" className="btn-primary" onClick={onRetry}>
            Try again
          </button>
        )}
        {filesUrl && (
          <a className="fh-link" href={filesUrl} target="_top">
            Open Files changed
          </a>
        )}
      </p>
    </div>
  );
}
