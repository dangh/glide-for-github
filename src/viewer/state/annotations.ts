/**
 * The CodeView annotation source (Task 9): per file, open new-thread composers and review threads.
 *
 * - Composers come first, in the order they were opened, then threads by `threadKey` (creation order). Pierre keys each
 *   annotation slot by its index in the array, so this order means a thread arriving later (a refetch, another
 *   comment posted on the same file) never shifts, and so never remounts, a composer someone is typing in.
 * - Line threads sit at `{side, lineNumber: line}` (multi-line threads at their end line, like GitHub).
 *   File-level threads and outdated threads (whose line belongs to an older commit) sit at `lineNumber: 0`.
 * - Threads are identified by `threadKey` (first comment id), so a provisional thread replaced by the server's copy
 *   (new id) keeps its annotation, slot and component instance.
 * - The returned array is reference-stable per file while that file's annotation POSITIONS are unchanged:
 *   typing (debounced draft bodies), new replies, edits, reactions and resolve state do not touch the CodeView
 *   item; the Thread / Composer components read their own data from the store.
 */
import type { ThreadModel } from '../github/threads';
import type { AnnotationSource, FileAnnotation } from './items';
import { targetOfDraft } from './compose';
import { threadKey, threadsByPath, type Draft, type DraftKey } from './store';

const EMPTY: readonly FileAnnotation[] = Object.freeze([]);

interface ComposerSlot {
  key: DraftKey;
  side: FileAnnotation['side'];
  line: number;
}

interface PathComposers {
  list: ComposerSlot[];
  /** Keys joined: changes only when composers open or close on the file. */
  sig: string;
}

const composersCache = new WeakMap<Map<DraftKey, Draft>, Map<string, PathComposers>>();

/** Open new-thread composers grouped by path; cached per `drafts` map. */
export function composersByPath(drafts: Map<DraftKey, Draft>): Map<string, PathComposers> {
  let map = composersCache.get(drafts);
  if (!map) {
    map = new Map();
    for (const [key, draft] of drafts) {
      const target = targetOfDraft(draft);
      if (!target) continue;
      let entry = map.get(target.path);
      if (!entry) map.set(target.path, (entry = { list: [], sig: '' }));
      entry.list.push({ key, side: target.side, line: target.subject === 'file' ? 0 : target.line });
      entry.sig += `${key}\n`;
    }
    composersCache.set(drafts, map);
  }
  return map;
}

/** Where a thread's annotation goes. */
export const threadLine = (t: ThreadModel): number => (t.subject === 'file' || t.isOutdated ? 0 : t.line);

export function createAnnotationSource(): AnnotationSource {
  const cache = new Map<string, { threads: ThreadModel[] | undefined; composers: string; sig: string; value: readonly FileAnnotation[] }>();
  return (path, state) => {
    const threads = threadsByPath(state.threads).get(path);
    const composers = composersByPath(state.drafts).get(path);
    const composerSig = composers?.sig ?? '';
    const prev = cache.get(path);
    if (prev && prev.threads === threads && prev.composers === composerSig) return prev.value;

    const list: FileAnnotation[] = [];
    let sig = composerSig;
    for (const c of composers?.list ?? []) list.push({ side: c.side, lineNumber: c.line, metadata: { kind: 'composer', key: c.key } });
    // Threads ordered by their stable key (first comment id = creation order): a new thread goes last and a
    // provisional → server swap keeps its slot, whatever order the refetch lists them in.
    const keyed = (threads ?? []).map((t) => ({ t, key: threadKey(t) })).sort((x, y) => Number(x.key) - Number(y.key) || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
    for (const { t, key } of keyed) {
      const lineNumber = threadLine(t);
      list.push({ side: t.side, lineNumber, metadata: { kind: 'thread', threadKey: key } });
      sig += `${key}@${t.side}:${lineNumber}\n`;
    }
    if (prev && prev.sig === sig) {
      cache.set(path, { ...prev, threads, composers: composerSig });
      return prev.value;
    }
    const value = list.length > 0 ? list : EMPTY;
    cache.set(path, { threads, composers: composerSig, sig, value });
    return value;
  };
}
