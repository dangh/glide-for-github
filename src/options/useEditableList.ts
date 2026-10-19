import { useEffect, useRef, useState } from 'react';

const SAVE_DELAY_MS = 400;
type Status = { kind: 'idle' } | { kind: 'saved' } | { kind: 'error'; message: string };

interface EditableListOptions<Item, Draft> {
  load(): Promise<Item[]>;
  subscribe(listener: (items: Item[]) => void): () => void;
  defaults(): Item[];
  toDraft(items: readonly Item[]): Draft[];
  fromDraft(draft: readonly Draft[]): Item[];
  same(a: readonly Item[], b: readonly Item[]): boolean;
  problem(items: readonly Item[]): string | null;
  save(items: readonly Item[]): Promise<void>;
  /** Issue companion changes synchronously; return their rollback for a current write's failure. */
  onSave?(next: Draft[], previous: Draft[]): (() => void) | undefined;
}

/** Persistence for the options page's editable groups and rules. Storage/conversion functions stay fixed. */
export function useEditableList<Item, Draft>({ load, subscribe, defaults, toDraft, fromDraft, same, problem, save, onSave }: EditableListOptions<Item, Draft>) {
  const [draft, setDraft] = useState<Draft[] | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const saved = useRef<Draft[]>([]);
  const submitted = useRef<Draft[] | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<Draft[] | null>(null);

  const commit = (next: Draft[]) => {
    clearTimeout(timer.current);
    pending.current = null;
    const previous = submitted.current ?? saved.current;
    submitted.current = next;
    // Both the list and companion writes must be issued before pagehide returns.
    const write = save(fromDraft(next));
    const rollback = onSave?.(next, previous);
    write.then(
      () => {
        if (submitted.current !== next) return;
        saved.current = next;
        if (same(fromDraft(draftRef.current ?? []), fromDraft(next))) setStatus({ kind: 'saved' });
      },
      (err: unknown) => {
        if (submitted.current !== next) return;
        submitted.current = saved.current;
        rollback?.();
        setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      },
    );
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;

  useEffect(() => {
    let active = true;
    let changed = false;
    const adopt = (items: Item[]) => {
      // Keep unsaved edits, including invalid drafts, when storage changes or echoes our write.
      setDraft((current) => {
        if (current && !same(fromDraft(current), fromDraft(saved.current))) return current;
        if (current && same(fromDraft(current), items)) return current;
        const next = toDraft(items);
        saved.current = next;
        submitted.current = next;
        return next;
      });
    };
    const initial = (items: Item[]) => { if (active && !changed) adopt(items); };
    void load().then(initial, () => initial(defaults()));
    const off = subscribe((items) => {
      changed = true;
      adopt(items);
    });
    const flush = () => {
      if (pending.current) commitRef.current(pending.current);
    };
    const onHidden = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      active = false;
      off();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHidden);
      flush();
    };
  }, []);

  const edit = (next: Draft[]) => {
    setDraft(next);
    clearTimeout(timer.current);
    pending.current = null;
    const message = problem(fromDraft(next));
    if (message) return setStatus({ kind: 'error', message });
    setStatus({ kind: 'idle' });
    pending.current = next;
    timer.current = setTimeout(() => commit(next), SAVE_DELAY_MS);
  };

  return { draft, status, edit };
}
