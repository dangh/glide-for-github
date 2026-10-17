/**
 * Apply suggestion UI: per-comment "Commit suggestion" / "Add suggestion to batch", the batch bar ("N suggestions
 * in batch · Commit suggestions") and the commit dialog (message, optional description). The commit itself is
 * `commitSuggestions` (GitHub session, R§5).
 */
import { memo, useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import type { CommentModel } from '../github/threads';
import { errorMessage } from '../state/review';
import { commitSuggestions, DEFAULT_COMMIT_MESSAGE, suggestionRefs } from '../state/suggestions';
import { sameSuggestion, usePr, type SuggestionRef } from '../state/store';
import { reloadPullRequest } from './Notice';

const useCommitDialog = create<{ refs: SuggestionRef[] | null }>(() => ({ refs: null }));

/** Opens the commit dialog for `refs` (one suggestion, or the batch). */
export function openCommitDialog(refs: SuggestionRef[]): void {
  useCommitDialog.setState({ refs });
}

const plural = (n: number) => `${n} ${n === 1 ? 'suggestion' : 'suggestions'}`;

/** The suggestion buttons under a comment whose suggestions the viewer can apply (see `canApply`). */
export const SuggestionActions = memo(function SuggestionActions({ path, comment }: { path: string; comment: CommentModel }) {
  const ref = usePr((s) => s.pr?.ref);
  const batch = usePr((s) => s.suggestionBatch);
  const headMoved = usePr((s) => s.headMoved);
  if (!ref) return null;
  const refs = suggestionRefs(ref, path, comment);
  return (
    <div className="suggestion-actions">
      {refs.map((r, i) => {
        const inBatch = batch.some((b) => sameSuggestion(b, r));
        return (
          <span className="suggestion-action" key={i} data-suggestion-index={r.suggestionIndex}>
            {refs.length > 1 && <span className="suggestion-label">Suggestion {i + 1}</span>}
            <button type="button" className="btn" disabled={headMoved} onClick={() => openCommitDialog([r])}>
              Commit suggestion
            </button>
            <button
              type="button"
              className="btn"
              disabled={headMoved}
              onClick={() => (inBatch ? usePr.getState().removeFromBatch([r]) : usePr.getState().addToBatch(r))}
            >
              {inBatch ? 'Remove from batch' : 'Add suggestion to batch'}
            </button>
          </span>
        );
      })}
    </div>
  );
});

/** Shown while the batch has suggestions. */
export const BatchBar = memo(function BatchBar() {
  const batch = usePr((s) => s.suggestionBatch);
  const headMoved = usePr((s) => s.headMoved);
  if (batch.length === 0) return null;
  return (
    <div className="batch-bar" role="region" aria-label="Suggestion batch">
      <span>{plural(batch.length)} in batch</span>
      <span className="grow" />
      <button type="button" className="btn" onClick={() => usePr.getState().removeFromBatch(batch)}>
        Clear batch
      </button>
      <button type="button" className="btn-primary" disabled={headMoved} onClick={() => openCommitDialog(batch)}>
        Commit suggestions
      </button>
    </div>
  );
});

/** The commit dialog (one at a time). */
export function CommitDialogHost() {
  const refs = useCommitDialog((s) => s.refs);
  if (!refs) return null;
  return <CommitDialog key={refs.map((r) => `${r.commentId}:${r.suggestionIndex ?? ''}`).join(',')} refs={refs} />;
}

function CommitDialog({ refs }: { refs: SuggestionRef[] }) {
  const title = useRef<HTMLInputElement>(null);
  const description = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  const [hasTitle, setHasTitle] = useState(true);
  const [error, setError] = useState<{ message: string; url?: string } | null>(null);
  const headMoved = usePr((s) => s.headMoved);
  const [reloading, setReloading] = useState(false);
  const reload = () => {
    setReloading(true);
    void reloadPullRequest().finally(() => {
      setReloading(false);
      if (!usePr.getState().headMoved) setError(null);
    });
  };
  const close = () => useCommitDialog.setState({ refs: null });
  const busyRef = useRef(false);
  busyRef.current = busy;

  useEffect(() => {
    title.current?.focus();
    title.current?.select();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (!busyRef.current) close();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  const commit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const subject = title.current?.value.trim() ?? '';
    if (!subject || busy) return;
    const body = description.current?.value.trim() ?? '';
    setBusy(true);
    setError(null);
    try {
      await commitSuggestions(refs, body ? `${subject}\n\n${body}` : subject);
      close();
      usePr.getState().setNotice({ kind: 'info', message: `Committed ${plural(refs.length)}.` });
    } catch (err) {
      const headMoved = usePr.getState().headMoved;
      setError({ message: errorMessage(err), ...(headMoved ? {} : { url: refs[0]!.url }) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <form className="modal commit-dialog" role="dialog" aria-modal="true" aria-labelledby="commit-dialog-title" onSubmit={commit}>
        <h2 id="commit-dialog-title">{refs.length === 1 ? 'Commit suggestion' : `Commit ${plural(refs.length)}`}</h2>
        <label className="modal-field">
          Commit message
          <input
            ref={title}
            name="commit-message"
            type="text"
            defaultValue={DEFAULT_COMMIT_MESSAGE}
            readOnly={busy}
            onInput={(e) => setHasTitle(e.currentTarget.value.trim() !== '')}
          />
        </label>
        <label className="modal-field">
          Extended description <span className="modal-muted">(optional)</span>
          <textarea ref={description} name="commit-description" rows={3} readOnly={busy} placeholder="Add an optional extended description…" />
        </label>
        {error && (
          <p className="modal-error" role="alert">
            {error.message}
            {headMoved && (
              <>
                {' '}
                <button type="button" className="fh-link" onClick={reload} disabled={reloading}>
                  {reloading ? 'Reloading…' : 'Reload pull request'}
                </button>
              </>
            )}
            {error.url && (
              <>
                {' '}
                <a href={error.url} target="_blank" rel="noopener noreferrer">
                  Open on GitHub
                </a>
              </>
            )}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !hasTitle || headMoved}>
            {busy ? 'Committing…' : 'Commit changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
