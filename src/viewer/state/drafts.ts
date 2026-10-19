/**
 * Comment drafts (new thread, reply, edit, review summary) survive a real page or iframe reload: they are kept per PR
 * in `sessionStorage` (`prKey` + the draft's `DraftKey`, like the suggestion batch in batch.ts) and restored when the
 * PR is set. Drafts with no text are not stored (a just-opened composer is not worth restoring). The soft reload
 * (the toolbar's Refresh button) never loses drafts anyway: they stay in the store.
 */
import { prKey, type PrRef } from '../../shared/pr-url';
import { sessionStore } from './batch';
import { usePr, type Draft, type DraftKey, type PrState } from './store';

/** `sessionStorage` key holding the PR's drafts. */
export const draftsKeyName = (ref: PrRef): string => `pierre.drafts:${prKey(ref)}`;

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const isSide = (v: unknown): v is 'additions' | 'deletions' => v === 'additions' || v === 'deletions';

/** A stored draft, or undefined when it is not shaped like one (storage is not trusted). */
function toDraft(v: unknown): Draft | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const r = v as Record<string, unknown>;
  if (typeof r.body !== 'string') return undefined;
  const draft: Draft = { body: r.body, updatedAt: typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : 0 };
  if (r.path !== undefined) {
    if (typeof r.path !== 'string') return undefined;
    draft.path = r.path;
  }
  for (const k of ['side', 'startSide'] as const) {
    if (r[k] === undefined) continue;
    if (!isSide(r[k])) return undefined;
    draft[k] = r[k] as 'additions' | 'deletions';
  }
  for (const k of ['line', 'startLine', 'databaseId'] as const) {
    if (r[k] === undefined) continue;
    if (!isInt(r[k])) return undefined;
    draft[k] = r[k] as number;
  }
  if (r.subject !== undefined) {
    if (r.subject !== 'line' && r.subject !== 'file') return undefined;
    draft.subject = r.subject;
  }
  if (r.threadId !== undefined) {
    if (typeof r.threadId !== 'string') return undefined;
    draft.threadId = r.threadId;
  }
  return draft;
}

function readDrafts(name: string): Map<DraftKey, Draft> {
  const out = new Map<DraftKey, Draft>();
  try {
    const parsed: unknown = JSON.parse(sessionStore().getItem(name) ?? '[]');
    if (!Array.isArray(parsed)) return out;
    for (const entry of parsed) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || entry[0] === '') continue;
      const draft = toDraft(entry[1]);
      if (draft && draft.body !== '') out.set(entry[0], draft);
    }
  } catch {
    // unreadable storage: start without drafts
  }
  return out;
}

/**
 * Keeps the PR's drafts in `sessionStorage`: restored when the PR is set (only into an empty draft map), written on
 * every draft change. Returns the unsubscribe function.
 */
export function initDraftPersistence(store = usePr): () => void {
  let name: string | null = null;
  const sync = (s: PrState, prev?: PrState) => {
    const next = s.pr ? draftsKeyName(s.pr.ref) : null;
    if (next !== name) {
      name = next;
      if (name && s.drafts.size === 0) {
        const saved = readDrafts(name);
        if (saved.size > 0) {
          store.setState({ drafts: saved });
          return;
        }
      }
    }
    if (!name || (prev && s.drafts === prev.drafts)) return;
    try {
      const entries = [...s.drafts].filter(([, d]) => d.body !== '');
      if (entries.length === 0) sessionStore().removeItem(name);
      else sessionStore().setItem(name, JSON.stringify(entries));
    } catch {
      // quota / blocked storage: drafts still live in memory for this page. Drop the stale snapshot so a later
      // reload does not restore outdated text over what was typed since.
      try {
        sessionStore().removeItem(name);
      } catch {
        // storage unusable
      }
    }
  };
  sync(store.getState());
  return store.subscribe(sync);
}
