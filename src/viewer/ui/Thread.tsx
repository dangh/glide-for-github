/**
 * A review thread rendered inline at its line (Pierre line annotation). Reads its own thread from the store, so
 * replies, edits, reactions and resolve state re-render this thread only, never the CodeView item.
 *
 * Outdated threads (line from an older commit; placed at the top of the file) and resolved threads start
 * collapsed with an "Outdated" / "Resolved" label and expand on click. Expansion survives remounts (virtualization).
 */
import { memo, useCallback, useState, useSyncExternalStore } from 'react';
import { isNoTokenError } from '../auth/requireToken';
import type { ReactionContent } from '../github/api';
import type { CommentModel, ThreadModel } from '../github/threads';
import { deleteComment, errorMessage, REACTIONS, setResolved, toggleReaction } from '../state/review';
import { draftKey, threadById, usePr } from '../state/store';
import { Composer, focusComposer } from './Composer';
import { CommentBody } from './Markdown';

// ---- expansion state, kept outside React so a remount (scrolling away and back) keeps it ---------------

const expanded = new Set<string>();
const expandListeners = new Set<() => void>();
let expandVersion = 0;
function setExpanded(id: string, open: boolean) {
  if (open) expanded.add(id);
  else expanded.delete(id);
  expandVersion++;
  for (const l of expandListeners) l();
}
const subscribeExpanded = (l: () => void) => (expandListeners.add(l), () => void expandListeners.delete(l));
function useExpanded(id: string): boolean {
  useSyncExternalStore(subscribeExpanded, () => expandVersion);
  return expanded.has(id);
}

/** Runs a thread/comment action, reporting failures (except a cancelled token prompt) through `onError`. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; retry: () => void } | null>(null);
  const run = useCallback((fn: () => Promise<void>) => {
    const attempt = () => {
      setBusy(true);
      setError(null);
      fn()
        .catch((err: unknown) => {
          if (!isNoTokenError(err)) setError({ message: errorMessage(err), retry: attempt });
        })
        .finally(() => setBusy(false));
    };
    attempt();
  }, []);
  return { busy, error, run };
}

function ActionError({ error }: { error: { message: string; retry: () => void } | null }) {
  if (!error) return null;
  return (
    <div className="thread-error" role="alert">
      {error.message}{' '}
      <button type="button" className="fh-link" onClick={error.retry}>
        Retry
      </button>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
/** `YYYY-MM-DD HH:mm`, local time. */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const Reactions = memo(function Reactions({ comment }: { comment: CommentModel }) {
  const [picking, setPicking] = useState(false);
  const { busy, error, run } = useAction();
  const toggle = (content: ReactionContent) => {
    setPicking(false);
    run(() => toggleReaction(comment.databaseId, content));
  };
  const shown = REACTIONS.map((r) => ({ ...r, group: comment.reactions.find((g) => g.content === r.content) })).filter((r) => (r.group?.count ?? 0) > 0);
  return (
    <div className="reactions">
      {shown.map((r) => (
        <button
          key={r.content}
          type="button"
          className={`reaction${r.group!.viewerHasReacted ? ' reaction-on' : ''}`}
          aria-pressed={r.group!.viewerHasReacted}
          title={r.label}
          data-reaction={r.content}
          disabled={busy}
          onClick={() => toggle(r.content)}
        >
          {r.emoji} {r.group!.count}
        </button>
      ))}
      <span className="reaction-picker">
        <button type="button" className="reaction reaction-add" aria-label="Add reaction" aria-expanded={picking} onClick={() => setPicking((p) => !p)} disabled={busy}>
          ☺+
        </button>
        {picking && (
          <span className="reaction-menu" role="menu">
            {REACTIONS.map((r) => {
              const on = comment.reactions.find((g) => g.content === r.content)?.viewerHasReacted === true;
              return (
                <button
                  key={r.content}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={on}
                  className={`reaction-choice${on ? ' reaction-on' : ''}`}
                  title={r.label}
                  data-reaction={r.content}
                  onClick={() => toggle(r.content)}
                >
                  {r.emoji}
                </button>
              );
            })}
          </span>
        )}
      </span>
      <ActionError error={error} />
    </div>
  );
});

const Comment = memo(function Comment({ threadId, comment }: { threadId: string; comment: CommentModel }) {
  const editKey = draftKey.edit(comment.databaseId);
  const editing = usePr((s) => s.drafts.has(editKey));
  const [confirming, setConfirming] = useState(false);
  const { busy, error, run } = useAction();

  const edit = () => {
    const s = usePr.getState();
    if (!s.drafts.has(editKey)) s.setDraft(editKey, { body: comment.body, databaseId: comment.databaseId, updatedAt: Date.now() });
    focusComposer(editKey);
  };

  return (
    <div className="comment" data-comment-id={comment.databaseId}>
      <div className="comment-head">
        {comment.author.avatarUrl ? <img className="avatar" src={comment.author.avatarUrl} alt="" width={20} height={20} /> : null}
        <span className="comment-author">{comment.author.login}</span>
        <span className="comment-time" title={comment.createdAt}>
          {formatTime(comment.createdAt)}
        </span>
        {comment.state === 'pending' && <span className="label label-pending">Pending</span>}
        <span className="grow" />
        {!editing && comment.viewerCanUpdate && (
          <button type="button" className="fh-link" onClick={edit} disabled={busy}>
            Edit
          </button>
        )}
        {!editing && comment.viewerCanDelete && !confirming && (
          <button type="button" className="fh-link" onClick={() => setConfirming(true)} disabled={busy}>
            Delete
          </button>
        )}
        {confirming && (
          <span className="comment-confirm">
            Delete this comment?{' '}
            <button
              type="button"
              className="fh-link fh-error"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                run(() => deleteComment(comment.databaseId));
              }}
            >
              Delete
            </button>{' '}
            <button type="button" className="fh-link" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </span>
        )}
      </div>
      {editing ? (
        <Composer key={editKey} draftKey={editKey} mode="edit" threadId={threadId} comment={comment} />
      ) : (
        <CommentBody html={comment.bodyHTML} text={comment.body} />
      )}
      <ActionError error={error} />
      {!editing && <Reactions comment={comment} />}
    </div>
  );
});

function lineLabel(t: ThreadModel): string {
  if (t.subject === 'file') return 'File';
  const end = t.side === 'deletions' ? `L${t.line}` : `R${t.line}`;
  if (t.startLine === undefined) return `Line ${t.line}`;
  return `Lines ${t.startLine}–${t.line}${t.startSide !== t.side ? ` (${t.startSide === 'deletions' ? 'L' : 'R'}${t.startLine}–${end})` : ''}`;
}

export const Thread = memo(function Thread({ threadId }: { threadId: string }) {
  const thread = usePr((s) => threadById(s.threads, threadId));
  const replyKey = draftKey.reply(threadId);
  const replying = usePr((s) => s.drafts.has(replyKey));
  const open = useExpanded(threadId);
  const { busy, error, run } = useAction();

  if (!thread || thread.comments.length === 0) return null;
  const foldable = thread.isOutdated || thread.isResolved;
  const shown = !foldable || open;
  const n = thread.comments.length;

  const reply = () => {
    const s = usePr.getState();
    if (!s.drafts.has(replyKey)) s.setDraft(replyKey, { body: '', threadId, updatedAt: Date.now() });
    focusComposer(replyKey);
  };

  return (
    <div
      className={`thread${thread.isResolved ? ' thread-resolved' : ''}${thread.isOutdated ? ' thread-outdated' : ''}`}
      data-thread-id={thread.id}
      data-resolved={thread.isResolved || undefined}
      data-outdated={thread.isOutdated || undefined}
    >
      {foldable && (
        <button type="button" className="thread-fold" aria-expanded={shown} onClick={() => setExpanded(threadId, !open)}>
          <span className="thread-chevron">{shown ? '▾' : '▸'}</span>
          {thread.isOutdated && <span className="label label-outdated">Outdated</span>}
          {thread.isResolved && <span className="label label-resolved">Resolved</span>}
          <span className="thread-fold-text">
            {thread.isOutdated ? `${lineLabel(thread)} · ` : ''}
            {thread.comments[0]!.author.login}
            {n > 1 ? ` + ${n - 1} more` : ''}
          </span>
        </button>
      )}
      {shown && (
        <>
          {thread.comments.map((c) => (
            <Comment key={c.databaseId} threadId={threadId} comment={c} />
          ))}
          {replying ? (
            <Composer key={replyKey} draftKey={replyKey} mode="reply" threadId={threadId} />
          ) : (
            <div className="thread-actions">
              {thread.viewerCanReply && (
                <button type="button" className="thread-reply" onClick={reply}>
                  Reply…
                </button>
              )}
              <span className="grow" />
              {/* A thread in a pending (unsubmitted) review cannot be resolved yet. */}
              {thread.comments[0]!.state === 'submitted' ? (
                <button type="button" className="btn" disabled={busy} onClick={() => run(() => setResolved(threadId, !thread.isResolved))}>
                  {thread.isResolved ? 'Unresolve conversation' : 'Resolve conversation'}
                </button>
              ) : null}
            </div>
          )}
          <ActionError error={error} />
        </>
      )}
    </div>
  );
});
