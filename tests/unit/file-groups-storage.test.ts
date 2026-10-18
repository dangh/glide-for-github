import { describe, expect, it } from 'vitest';
import { DEFAULT_FILE_GROUPS, type FileGroup } from '../../src/shared/file-groups';
import {
  FILE_GROUPS_KEY,
  groupsFromItems,
  loadFileGroups,
  onFileGroupsChange,
  saveFileGroups,
  type GroupsStorage,
} from '../../src/shared/file-groups-storage';
import { SETTINGS_STORAGE_KEY } from '../../src/shared/settings';

/** In-memory `chrome.storage.sync` with Chrome's per-item quota and change events. */
function fakeSync(initial: Record<string, unknown> = {}) {
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

const custom: FileGroup[] = [
  { label: 'Code', patterns: ['!Tests'] },
  { label: 'Tests', patterns: ['*.test.*', '# a comment'] },
];

describe('file groups storage', () => {
  it('loads the default groups when nothing is stored', async () => {
    const { storage } = fakeSync({ [SETTINGS_STORAGE_KEY]: { diff: {} } });
    expect(await loadFileGroups(storage)).toEqual(DEFAULT_FILE_GROUPS);
  });

  it('stores each group as its own item, next to a count, and reads them back', async () => {
    const { data, storage } = fakeSync({ [SETTINGS_STORAGE_KEY]: { diff: {} } });
    await saveFileGroups(custom, storage);
    expect(data).toEqual({
      [SETTINGS_STORAGE_KEY]: { diff: {} },
      [FILE_GROUPS_KEY]: 2,
      [`${FILE_GROUPS_KEY}.0`]: { label: 'Code', patterns: '!Tests' },
      [`${FILE_GROUPS_KEY}.1`]: { label: 'Tests', patterns: '*.test.*\n# a comment' },
    });
    expect(await loadFileGroups(storage)).toEqual(custom);
  });

  it('stores the defaults as nothing, so later default changes reach the user', async () => {
    const { data, storage } = fakeSync();
    await saveFileGroups(custom, storage);
    await saveFileGroups(DEFAULT_FILE_GROUPS, storage);
    expect(data).toEqual({});
  });

  it('removes items a shorter list leaves behind', async () => {
    const { data, storage } = fakeSync();
    await saveFileGroups([...custom, { label: 'Docs', patterns: ['*.md'] }], storage);
    await saveFileGroups(custom, storage);
    expect(Object.keys(data).sort()).toEqual([FILE_GROUPS_KEY, `${FILE_GROUPS_KEY}.0`, `${FILE_GROUPS_KEY}.1`]);
  });

  it('keeps rules bigger than one sync item could hold in total (Sift\'s defaults are about 5 KB)', async () => {
    const { storage } = fakeSync();
    const big = DEFAULT_FILE_GROUPS.map((g) => ({ label: `${g.label}2`, patterns: [...g.patterns, ...g.patterns] }));
    await saveFileGroups(big, storage);
    expect(await loadFileGroups(storage)).toEqual(big);
  });

  it('refuses a group too big to sync, and invalid groups, before writing anything', async () => {
    const { data, storage } = fakeSync();
    const huge = { label: 'Huge', patterns: Array.from({ length: 900 }, (_, i) => `file-${i}.ts`) };
    await expect(saveFileGroups([huge], storage)).rejects.toThrow(/Huge: too many patterns/);
    await expect(saveFileGroups([{ label: 'A', patterns: [] }, { label: 'a', patterns: [] }], storage)).rejects.toThrow(/Two groups/);
    expect(data).toEqual({});
  });

  it('falls back to the defaults when the stored groups are damaged', () => {
    const ok = { [FILE_GROUPS_KEY]: 1, [`${FILE_GROUPS_KEY}.0`]: { label: 'A', patterns: '*.a' } };
    expect(groupsFromItems(ok)).toEqual([{ label: 'A', patterns: ['*.a'] }]);
    for (const damaged of [
      { ...ok, [FILE_GROUPS_KEY]: 'one' },
      { ...ok, [FILE_GROUPS_KEY]: 2 },
      { ...ok, [`${FILE_GROUPS_KEY}.0`]: { label: '', patterns: '' } },
      { ...ok, [`${FILE_GROUPS_KEY}.0`]: { label: 'A', patterns: 7 } },
      { ...ok, [`${FILE_GROUPS_KEY}.0`]: { label: 'A', patterns: '!' } },
    ]) {
      expect(groupsFromItems(damaged)).toEqual(DEFAULT_FILE_GROUPS);
    }
    expect(groupsFromItems({ [FILE_GROUPS_KEY]: 0 })).toEqual([]);
  });

  it('reports changes to the groups, not to other items', async () => {
    const { storage } = fakeSync();
    const seen: FileGroup[][] = [];
    const off = onFileGroupsChange((groups) => seen.push(groups), storage);
    await storage.set({ [SETTINGS_STORAGE_KEY]: { diff: { diffStyle: 'split' } } });
    await saveFileGroups(custom, storage);
    await new Promise((r) => setTimeout(r, 0));
    expect(seen.at(-1)).toEqual(custom);
    const count = seen.length;
    off();
    await saveFileGroups(DEFAULT_FILE_GROUPS, storage);
    await new Promise((r) => setTimeout(r, 0));
    expect(seen.length).toBe(count);
  });
});
