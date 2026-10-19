/** Only per-PR viewer state crosses from the old extension frame into the page. */
export const legacyStateKeys = (pr: string) => [
  `pierre.drafts:${pr}`,
  `pierre.applySuggestions.batch:${pr}`,
  `pierre.applySuggestions.key:${pr}`,
  `pierre.fileGroup:${pr}`,
  `glide.scroll:${pr}`,
];

type Entry = [string, string];
type Store = Pick<Storage, 'getItem' | 'setItem'>;
export const migrationKey = (pr: string) => `glide.legacy-session:${pr}`;

export function readLegacyState(store: Store, pr: string): Entry[] {
  return legacyStateKeys(pr).flatMap(key => {
    const value = store.getItem(key);
    return value === null ? [] : [[key, value]];
  });
}

export function parseLegacyState(value: unknown, pr: string): Entry[] {
  if (!Array.isArray(value)) throw new Error('Invalid saved viewer state');
  const keys = new Set(legacyStateKeys(pr));
  const entries: Entry[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || typeof entry[1] !== 'string' || !keys.delete(entry[0])) {
      throw new Error('Invalid saved viewer state');
    }
    entries.push([entry[0], entry[1]]);
  }
  return entries;
}

/** A journal makes a partial copy retryable, including the batch/idempotency-key pair. Originals stay intact. */
export function importLegacyState(store: Store, pr: string, snapshot: unknown): void {
  const marker = migrationKey(pr);
  const journal = store.getItem(marker);
  if (journal === 'done') return;
  let entries: Entry[];
  if (journal !== null) {
    entries = parseLegacyState(JSON.parse(journal), pr);
  } else {
    const batch = `pierre.applySuggestions.batch:${pr}`;
    const key = `pierre.applySuggestions.key:${pr}`;
    const hasSuggestionState = store.getItem(batch) !== null || store.getItem(key) !== null;
    entries = parseLegacyState(snapshot, pr).filter(([name]) =>
      store.getItem(name) === null && (!(name === batch || name === key) || !hasSuggestionState));
    // The viewer must not mount until the journal is complete, so its edits cannot race a retry.
    store.setItem(marker, JSON.stringify(entries));
  }
  for (const [name, value] of entries) store.setItem(name, value);
  store.setItem(marker, 'done');
}
