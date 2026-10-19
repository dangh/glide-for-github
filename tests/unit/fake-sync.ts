import type { GroupsStorage } from '../../src/shared/file-groups-storage';

/** In-memory `chrome.storage.sync` with Chrome's per-item quota and change events. */
export function fakeSync(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = structuredClone(initial);
  const listeners = new Set<(keys: string[]) => void>();
  const storage: GroupsStorage = {
    get: async () => structuredClone(data),
    async set(items) {
      for (const [k, v] of Object.entries(items)) {
        if (new TextEncoder().encode(k + JSON.stringify(v)).length > 8192) throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
      }
      Object.assign(data, structuredClone(items));
      for (const l of listeners) l(Object.keys(items));
    },
    async remove(keys) {
      for (const k of keys) delete data[k];
      for (const l of listeners) l(keys);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { data, storage };
}
