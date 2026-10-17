/**
 * The toolbar's Review button and menu ("Finish your review", as on GitHub): summary (draft `review-summary`),
 * Comment / Approve / Request changes, Submit review, and Discard pending review (with a confirm step).
 *
 * The PR author cannot approve or request changes on their own pull request: those options are disabled with
 * GitHub's own wording (verified on the sandbox's Files changed page, 2026-10-17).
 * The summary textarea is uncontrolled and saved to the draft on a debounce / blur / close, like the composer.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { isNoTokenError } from '../auth/requireToken';
import type { ReviewEvent } from '../github/api';
import { discardReview, errorMessage, submitReview } from '../state/review';
import { draftKey, usePr } from '../state/store';

const SAVE_DEBOUNCE_MS = 300;

/** GitHub's labels and descriptions (Files changed → Submit review). */
export const REVIEW_EVENTS: { event: ReviewEvent; label: string; description: string; authorDescription?: string }[] = [
  { event: 'COMMENT', label: 'Comment', description: 'Submit general feedback without explicit approval.' },
  {
    event: 'APPROVE',
    label: 'Approve',
    description: 'Give feedback and approve merging these changes.',
    authorDescription: "Pull request authors can't approve their own pull requests.",
  },
  {
    event: 'REQUEST_CHANGES',
    label: 'Request changes',
    description: 'Submit feedback that must be addressed before merging.',
    authorDescription: "Pull request authors can't request changes on their own pull requests.",
  },
];

export const ReviewMenu = memo(function ReviewMenu() {
  const pending = usePr((s) => s.pendingReview?.count ?? 0);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node) && !(e.target as Element).closest?.('[role="dialog"]')) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="popover review-menu" ref={root}>
      <button type="button" className="btn-primary" aria-haspopup="dialog" aria-expanded={open} data-testid="review-button" onClick={() => setOpen((o) => !o)}>
        {pending > 0 ? `Review (${pending} pending)` : 'Review'} ▾
      </button>
      {open && <ReviewPanel close={close} />}
    </div>
  );
});

function ReviewPanel({ close }: { close: () => void }) {
  const pr = usePr((s) => s.pr);
  const pending = usePr((s) => s.pendingReview);
  const ref = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const initial = useRef(usePr.getState().drafts.get(draftKey.reviewSummary)?.body ?? '');
  const [hasText, setHasText] = useState(initial.current.trim() !== '');
  const [event, setEvent] = useState<ReviewEvent>('COMMENT');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<{ message: string; retry: () => void } | null>(null);
  const submitted = useRef(false);

  const isAuthor = !!pr && !!pr.author && pr.author === pr.viewer.login;
  const count = pending?.count ?? 0;

  /** Writes the summary to its draft now (an empty summary removes the draft). */
  const save = useCallback((el: HTMLTextAreaElement | null) => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (!el || submitted.current) return;
    const s = usePr.getState();
    const body = el.value;
    if (body === '') s.clearDraft(draftKey.reviewSummary);
    else if (s.drafts.get(draftKey.reviewSummary)?.body !== body) s.setDraft(draftKey.reviewSummary, { body, updatedAt: Date.now() });
  }, []);

  useEffect(() => {
    const el = ref.current;
    el?.focus();
    // A real reload may come before the debounce fires: write the summary now (it is then in sessionStorage).
    const flush = () => save(el);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      save(el);
    };
  }, [save]);

  const onInput = () => {
    const el = ref.current;
    setHasText((el?.value.trim() ?? '') !== '');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(el), SAVE_DEBOUNCE_MS);
  };

  const run = (fn: () => Promise<void>, onDone: () => void) => {
    const attempt = () => {
      setBusy(true);
      setError(null);
      fn()
        .then(onDone)
        .catch((err: unknown) => {
          if (!isNoTokenError(err)) setError({ message: errorMessage(err), retry: attempt });
        })
        .finally(() => setBusy(false));
    };
    attempt();
  };

  const submit = () => {
    const body = ref.current?.value.trim() ?? '';
    run(
      () => submitReview(event, body),
      () => {
        submitted.current = true;
        if (ref.current) ref.current.value = '';
        usePr.getState().clearDraft(draftKey.reviewSummary);
        usePr.getState().setNotice({ kind: 'info', message: 'Review submitted.' });
        close();
      },
    );
  };

  const discard = () => {
    setConfirming(false);
    run(discardReview, () => usePr.getState().setNotice({ kind: 'info', message: 'Pending review discarded.' }));
  };

  const canSubmit = !busy && pr?.viewer.canReview !== false && (event !== 'COMMENT' || hasText || count > 0);

  return (
    <div className="popover-panel review-panel" role="dialog" aria-label="Finish your review">
      <h3 className="review-title">Finish your review</h3>
      <textarea
        ref={ref}
        className="review-summary"
        rows={5}
        placeholder="Leave a comment"
        defaultValue={initial.current}
        readOnly={busy}
        onInput={onInput}
        onBlur={() => save(ref.current)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canSubmit) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <fieldset className="review-events" disabled={busy}>
        {REVIEW_EVENTS.map((o) => {
          const disabled = o.event !== 'COMMENT' && isAuthor;
          return (
            <label key={o.event} className={`review-event${disabled ? ' review-event-disabled' : ''}`}>
              <input type="radio" name="reviewEvent" value={o.event} checked={event === o.event} disabled={disabled} onChange={() => setEvent(o.event)} />
              <span>
                <span className="review-event-label">{o.label}</span>
                <span className="review-event-desc">{disabled ? o.authorDescription : o.description}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      {error && (
        <div className="thread-error" role="alert">
          {error.message}{' '}
          <button type="button" className="fh-link" onClick={error.retry}>
            Retry
          </button>
        </div>
      )}
      <div className="review-actions">
        {pending && !confirming && (
          <button type="button" className="btn btn-danger-text" disabled={busy} onClick={() => setConfirming(true)}>
            Discard pending review
          </button>
        )}
        {confirming && (
          <span className="review-confirm">
            Discard your review and its {count} pending {count === 1 ? 'comment' : 'comments'}?{' '}
            <button type="button" className="btn btn-danger" onClick={discard}>
              Discard review
            </button>{' '}
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </span>
        )}
        <span className="grow" />
        <button type="button" className="btn" onClick={close} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn-primary" disabled={!canSubmit} onClick={submit}>
          {busy ? 'Submitting…' : 'Submit review'}
        </button>
      </div>
    </div>
  );
}
