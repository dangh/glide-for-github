/** Transient notices (bottom toast), the "PR updated" banner (Task 11) and the full-pane error. */
import { memo, useEffect } from 'react';
import { usePr } from '../state/store';

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
          This pull request was updated. <button className="fh-link" onClick={() => location.reload()}>Reload</button>
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

export function FatalError({ message, filesUrl }: { message: string; filesUrl?: string }) {
  return (
    <div className="fatal" role="alert">
      <h2>Pierre could not load this pull request</h2>
      <p>{message}</p>
      {filesUrl && (
        <p>
          <a href={filesUrl} target="_top">
            Open Files changed
          </a>
        </p>
      )}
    </div>
  );
}
