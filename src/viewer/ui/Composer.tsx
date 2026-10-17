/**
 * Inline comment composer (new thread, reply, edit), rendered inside the diff as a Pierre line annotation or
 * inside a Thread.
 *
 * Typing must never lag, whatever the PR size:
 * - the textarea is UNCONTROLLED: keystrokes touch no React state, so nothing re-renders while typing;
 * - the draft is written to the store on a 300 ms debounce (at most every 5 s during continuous typing), on blur
 *   and on unmount (e.g. the file scrolls out of the virtualized window), never per keystroke;
 * - draft writes do not change any CodeView item (the annotation source keys on positions, not bodies).
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isNoTokenError, useTokenPrompt } from '../auth/requireToken';
import type { CommentModel } from '../github/threads';
import { insertBlock, openComposer, previewContext, suggestionFor, targetOfDraft, type CommentTarget } from '../state/compose';
import {
  errorMessage,
  SINGLE_COMMENT_WHILE_PENDING,
  submitEdit,
  submitNewComment,
  submitReply,
  type NewCommentMode,
} from '../state/review';
import { session } from '../state/session';
import { isCollapsed, threadByKey, usePr, type DraftKey } from '../state/store';
import { BodyHtml } from './Markdown';

export const DRAFT_DEBOUNCE_MS = 300;
export const DRAFT_MAX_WAIT_MS = 5000;

export interface ComposerProps {
  draftKey: DraftKey;
  mode: 'new' | 'reply' | 'edit';
  /** Reply / edit: the thread's stable key (`threadKey`, first comment id). */
  threadKey?: string;
  /** Edit: the comment being edited. */
  comment?: CommentModel;
}

type Action = 'single' | 'review' | 'reply' | 'edit';

// ---- focus requests (opening a composer from the gutter focuses it, also when it mounts later) ---------

const focusers = new Map<DraftKey, () => void>();
let focusOnMount: DraftKey | null = null;

/** Focuses the composer for `key` now if it is mounted, else as soon as it mounts. */
export function focusComposer(key: DraftKey): void {
  const focus = focusers.get(key);
  if (focus) focus();
  else focusOnMount = key;
}

/** Opens (or focuses) the new-thread composer for a target; expands the file first if it is collapsed. */
export function openComposerAt(target: CommentTarget): DraftKey {
  const s = usePr.getState();
  if (isCollapsed(s, target.path)) s.setCollapsed(target.path, false);
  const key = openComposer(target);
  focusComposer(key);
  return key;
}

const sideLetter = (side: CommentTarget['side']) => (side === 'deletions' ? 'L' : 'R');

/** "Comment on line R12", "Comment on lines R10 to R12", "Comment on file". */
export function targetLabel(t: CommentTarget): string {
  if (t.subject === 'file') return 'Comment on file';
  if (t.startLine === undefined) return `Comment on line ${sideLetter(t.side)}${t.line}`;
  return `Comment on lines ${sideLetter(t.startSide ?? t.side)}${t.startLine} to ${sideLetter(t.side)}${t.line}`;
}

/** The thread's position as a comment target (reply suggestions). */
function threadTarget(key: string | undefined): CommentTarget | undefined {
  const t = key ? threadByKey(usePr.getState().threads, key) : undefined;
  if (!t || t.isOutdated) return undefined;
  return {
    path: t.path,
    side: t.side,
    line: t.line,
    subject: t.subject,
    ...(t.startLine !== undefined ? { startLine: t.startLine, startSide: t.startSide ?? t.side } : {}),
  };
}

export const Composer = memo(function Composer({ draftKey, mode, threadKey, comment }: ComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const firstUnsaved = useRef(0);
  /** Set once the draft is cleared (posted / cancelled): no more saves. */
  const closed = useRef(false);

  // Read once: the textarea is uncontrolled.
  const initial = useMemo(() => {
    const d = usePr.getState().drafts.get(draftKey);
    return d?.body ?? (mode === 'edit' ? comment?.body ?? '' : '');
  }, []); // read once on mount (uncontrolled textarea)

  const pending = usePr((s) => s.pendingReview !== null);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [preview, setPreview] = useState<{ status: 'loading' | 'ok' | 'error'; html?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; action: Action } | null>(null);
  const [needsToken, setNeedsToken] = useState<Action | null>(null);

  const target = useMemo(
    () => (mode === 'new' ? targetOfDraft(usePr.getState().drafts.get(draftKey)) : threadTarget(threadKey)),
    [mode, draftKey, threadKey],
  );

  /** Writes the textarea's text to the draft now (cancelling the pending debounce). */
  const saveFrom = useCallback(
    (el: HTMLTextAreaElement | null) => {
      clearTimeout(timer.current);
      timer.current = undefined;
      firstUnsaved.current = 0;
      if (!el || closed.current) return;
      const s = usePr.getState();
      const existing = s.drafts.get(draftKey);
      // Opening a composer creates its draft; no draft means it was posted or cancelled: never recreate it.
      if (!existing || existing.body === el.value) return;
      s.setDraft(draftKey, { ...existing, body: el.value, updatedAt: Date.now() });
    },
    [draftKey],
  );
  const save = useCallback(() => saveFrom(ref.current), [saveFrom]);

  const onInput = useCallback(() => {
    const now = Date.now();
    if (!firstUnsaved.current) firstUnsaved.current = now;
    clearTimeout(timer.current);
    // Trailing debounce, but never hold an unsaved draft longer than DRAFT_MAX_WAIT_MS.
    const wait = Math.max(0, Math.min(DRAFT_DEBOUNCE_MS, firstUnsaved.current + DRAFT_MAX_WAIT_MS - now));
    timer.current = setTimeout(save, wait);
  }, [save]);

  useEffect(() => {
    // Captured now: React clears `ref.current` before passive effect cleanups run, so the unmount save must not
    // read the ref.
    const el = ref.current;
    const focus = () => {
      if (!el) return;
      el.focus({ preventScroll: false });
      el.setSelectionRange(el.value.length, el.value.length);
    };
    focusers.set(draftKey, focus);
    if (focusOnMount === draftKey) {
      focusOnMount = null;
      focus();
    }
    return () => {
      if (focusers.get(draftKey) === focus) focusers.delete(draftKey);
      saveFrom(el); // unmount (virtualized away, file collapsed, slot moved): keep what was typed
    };
  }, [draftKey, saveFrom]);

  /**
   * A new-thread composer done (posted or cancelled): drop Pierre's line selection too. Pierre's gutter "+" reuses
   * the current selection, so a leftover range would make the next "+" open that range again.
   */
  const releaseSelection = useCallback(() => {
    if (mode === 'new') session.codeView?.clearSelectedLines();
  }, [mode]);

  const close = useCallback(() => {
    closed.current = true;
    clearTimeout(timer.current);
    usePr.getState().clearDraft(draftKey);
    releaseSelection();
  }, [draftKey, releaseSelection]);

  const run = useCallback(
    async (action: Action) => {
      const el = ref.current;
      if (!el || busy) return;
      const body = el.value;
      if (!body.trim()) {
        el.focus();
        return;
      }
      save();
      setBusy(true);
      setError(null);
      setNeedsToken(null);
      try {
        if (action === 'single' || action === 'review') await submitNewComment(draftKey, body, action as NewCommentMode);
        else if (action === 'reply') await submitReply(threadKey!, body);
        else await submitEdit(comment!.databaseId, body);
        closed.current = true;
        releaseSelection();
      } catch (err) {
        if (isNoTokenError(err)) setNeedsToken(action);
        else setError({ message: errorMessage(err), action });
      } finally {
        setBusy(false);
      }
    },
    [busy, save, draftKey, threadKey, comment, releaseSelection],
  );

  const actions: { action: Action; label: string; primary: boolean }[] =
    mode === 'new'
      ? pending
        ? [
            ...(SINGLE_COMMENT_WHILE_PENDING ? [{ action: 'single' as const, label: 'Add single comment', primary: false }] : []),
            { action: 'review', label: 'Add review comment', primary: true },
          ]
        : [
            { action: 'single', label: 'Add single comment', primary: true },
            { action: 'review', label: 'Start a review', primary: false },
          ]
      : mode === 'reply'
        ? [{ action: 'reply', label: pending ? 'Add review comment' : 'Reply', primary: true }]
        : [{ action: 'edit', label: 'Update comment', primary: true }];
  const primary = actions.find((a) => a.primary)!.action;

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void run(primary);
        return;
      }
      if (e.key === 'Escape') {
        // The token prompt owns Esc while it is open.
        if (useTokenPrompt.getState().queue.length > 0) return;
        if (!e.currentTarget.value) {
          e.preventDefault();
          close();
        }
      }
    },
    [run, primary, close],
  );

  const insertSuggestion = useCallback(() => {
    const el = ref.current;
    if (!el || !target) return;
    const block = suggestionFor(target, usePr.getState().diffs.get(target.path));
    if (!block) return;
    const { value, caret } = insertBlock(el.value, el.selectionStart, el.selectionEnd, block);
    el.value = value;
    el.focus();
    el.setSelectionRange(caret, caret);
    onInput();
  }, [target, onInput]);

  const showPreview = useCallback(async () => {
    setTab('preview');
    const pr = usePr.getState().pr;
    const rpc = session.rpc;
    const text = ref.current?.value ?? '';
    if (!pr || !rpc || !text.trim()) {
      setPreview({ status: 'ok', html: '' });
      return;
    }
    setPreview({ status: 'loading' });
    try {
      const html = await rpc.call('preview', text, previewContext(pr, usePr.getState().range, target));
      setPreview({ status: 'ok', html });
    } catch {
      setPreview({ status: 'error' });
    }
  }, [target]);

  const canSuggest = !!target && target.subject === 'line' && target.side === 'additions' && (target.startSide ?? 'additions') === 'additions';

  return (
    <div className={`composer composer-${mode}`} data-draft-key={draftKey}>
      {mode === 'new' && target && <div className="composer-target">{targetLabel(target)}</div>}
      <div className="composer-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'write'} className={tab === 'write' ? 'on' : ''} onClick={() => setTab('write')}>
          Write
        </button>
        <button type="button" role="tab" aria-selected={tab === 'preview'} className={tab === 'preview' ? 'on' : ''} onClick={showPreview}>
          Preview
        </button>
        <span className="grow" />
        {canSuggest && (
          <button type="button" className="composer-tool" title="Insert a suggestion for the selected lines" onClick={insertSuggestion} disabled={busy}>
            Insert suggestion
          </button>
        )}
      </div>
      <textarea
        ref={ref}
        className="composer-input"
        defaultValue={initial}
        placeholder={mode === 'reply' ? 'Reply…' : 'Leave a comment'}
        aria-label={mode === 'reply' ? 'Reply' : mode === 'edit' ? 'Edit comment' : 'Comment'}
        rows={mode === 'reply' ? 3 : 4}
        spellCheck
        readOnly={busy}
        hidden={tab !== 'write'}
        onInput={onInput}
        onBlur={save}
        onKeyDown={onKeyDown}
      />
      {tab === 'preview' && (
        <div className="composer-preview">
          {preview?.status === 'loading' ? (
            <span className="muted">Loading preview…</span>
          ) : preview?.status === 'error' ? (
            <span className="muted">Markdown preview unavailable.</span>
          ) : preview?.html ? (
            <BodyHtml html={preview.html} />
          ) : (
            <span className="muted">Nothing to preview.</span>
          )}
        </div>
      )}
      {error && (
        <div className="composer-error" role="alert">
          {error.message}{' '}
          <button type="button" className="fh-link" onClick={() => void run(error.action)} disabled={busy}>
            Retry
          </button>
        </div>
      )}
      {needsToken && (
        <div className="composer-note">
          A GitHub token is needed to post.{' '}
          <button type="button" className="fh-link" onClick={() => void run(needsToken)} disabled={busy}>
            Retry
          </button>
        </div>
      )}
      <div className="composer-actions">
        {busy && <span className="spinner" aria-label="Posting" />}
        <span className="grow" />
        <button type="button" className="btn" onClick={close} disabled={busy}>
          Cancel
        </button>
        {actions.map((a) => (
          <button
            key={a.action}
            type="button"
            className={a.primary ? 'btn-primary' : 'btn'}
            onClick={() => void run(a.action)}
            disabled={busy}
            title={a.primary ? 'Ctrl+Enter' : undefined}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
});
