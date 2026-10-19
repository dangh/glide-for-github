/** Transient notices (bottom toast), GitHub's Refresh button for a pull request that was pushed to, and the full-pane error. */
import { memo, useEffect, useState } from 'react';
import { BRAND } from '../../shared/brand';
import { reloadPr } from '../state/load';
import { session } from '../state/session';
import { errorMessage } from '../state/review';
import { usePr } from '../state/store';
import { SyncIcon } from './icons';

/** Soft reload (keeps the suggestion batch and drafts); a failure is shown as a notice. */
export function reloadPullRequest(): Promise<void> {
  const pr = usePr.getState().pr;
  const rpc = session.rpc;
  return reloadPr().catch((err: unknown) => {
    if (usePr.getState().pr === pr && session.rpc === rpc)
      usePr.getState().setNotice({ kind: 'error', message: `Could not reload the pull request. ${errorMessage(err)}` });
  });
}

const INFO_TIMEOUT_MS = 6000;

export const Notice = memo(function Notice() {
  const notice = usePr((s) => s.notice);

  useEffect(() => {
    if (notice?.kind !== 'info') return;
    const t = setTimeout(() => {
      if (usePr.getState().notice === notice) usePr.getState().setNotice(null);
    }, INFO_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [notice]);

  if (!notice) return null;
  return (
    <div className={`toast toast-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
      <span>{notice.message}</span>
      <button className="toast-close" aria-label="Dismiss" onClick={() => usePr.getState().setNotice(null)}>
        ×
      </button>
    </div>
  );
});

/**
 * GitHub's Refresh button on its Files changed toolbar, shown once the pull request was pushed to (`headMoved`): sync
 * icon and "Refresh" (the icon alone below GitHub's md viewport), busy while the soft reload runs, gone after it.
 */
export const RefreshButton = memo(function RefreshButton() {
  const updated = usePr((s) => s.headMoved);
  const [busy, setBusy] = useState(false);
  if (!updated) return null;
  return (
    <button
      type="button"
      className="refresh-button"
      aria-label="Refresh"
      data-busy={busy || undefined}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void reloadPullRequest().finally(() => setBusy(false));
      }}
    >
      <SyncIcon />
      <span className="refresh-label">Refresh</span>
    </button>
  );
});

/** Full-pane error: what went wrong, GitHub's own Files changed page as the way out, and Try again when it can help. */
export function FatalError({ message, filesUrl, onRetry }: { message: string; filesUrl?: string; onRetry?: () => void }) {
  return (
    <div className="fatal" role="alert">
      <h2>{BRAND.short} could not load this pull request</h2>
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
