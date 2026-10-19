/**
 * Where the file groups live: `chrome.storage.sync`, beside the settings item but not in it. Custom groups can
 * outgrow the 8 KB per-item sync quota (Sift's defaults alone are about 5 KB), so each group is its own item:
 * `pierre.fileGroups` holds the count and `pierre.fileGroups.<i>` the i-th group. No count means the default groups,
 * so users who never edit them get later changes to the defaults. Items past the count are leftovers and ignored.
 */
import { DEFAULT_FILE_GROUPS, GROUPS_MAX, groupsProblem, parseGroup, type FileGroup } from './file-groups';

export const FILE_GROUPS_KEY = 'pierre.fileGroups';
const itemKey = (i: number) => `${FILE_GROUPS_KEY}.${i}`;
const isGroupsKey = (key: string) => key === FILE_GROUPS_KEY || key.startsWith(`${FILE_GROUPS_KEY}.`);
/** chrome.storage.sync.QUOTA_BYTES_PER_ITEM: the key plus the JSON of its value, in bytes. */
const QUOTA_BYTES_PER_ITEM = 8192;

export interface GroupsStorage {
  get(keys: null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
  /** Listens for changes to the area's items; returns an unsubscribe function. */
  subscribe(listener: (changedKeys: string[]) => void): () => void;
}

function chromeSync(): GroupsStorage {
  const area = chrome.storage.sync;
  return {
    get: (keys) => area.get(keys),
    set: (items) => area.set(items),
    remove: (keys) => area.remove(keys),
    subscribe(listener) {
      const handler = (changes: Record<string, unknown>, areaName: string) => {
        if (areaName === 'sync') listener(Object.keys(changes));
      };
      chrome.storage.onChanged.addListener(handler);
      return () => chrome.storage.onChanged.removeListener(handler);
    },
  };
}

/** The groups in a snapshot of the storage area: the stored ones when they are valid, else the defaults. */
export function groupsFromItems(items: Record<string, unknown>): FileGroup[] {
  const count = items[FILE_GROUPS_KEY];
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > GROUPS_MAX) return defaultGroups();
  const groups: FileGroup[] = [];
  for (let i = 0; i < count; i++) {
    const group = parseGroup(items[itemKey(i)]);
    if (!group) return defaultGroups();
    groups.push(group);
  }
  return groupsProblem(groups) ? defaultGroups() : groups;
}

export const defaultGroups = (): FileGroup[] => DEFAULT_FILE_GROUPS.map((g) => ({ label: g.label, patterns: [...g.patterns] }));

export const sameGroups = (a: readonly FileGroup[], b: readonly FileGroup[]) =>
  a.length === b.length && a.every((g, i) => g.label === b[i]!.label && g.patterns.join('\n') === b[i]!.patterns.join('\n'));

const bytes = (text: string) => new TextEncoder().encode(text).length;

export async function loadFileGroups(storage: GroupsStorage = chromeSync()): Promise<FileGroup[]> {
  return groupsFromItems(await storage.get(null));
}

/** Every key a stored set of groups can use: the count and up to `GROUPS_MAX` groups. */
const ALL_KEYS = [FILE_GROUPS_KEY, ...Array.from({ length: GROUPS_MAX }, (_, i) => itemKey(i))];

/**
 * Stores `groups` (the defaults are stored as nothing). Rejects groups `groupsProblem` rejects or too big to sync.
 * The write is issued before anything is awaited, so a save started as the options page closes still lands.
 */
export async function saveFileGroups(groups: readonly FileGroup[], storage: GroupsStorage = chromeSync()): Promise<void> {
  const problem = groupsProblem(groups);
  if (problem) throw new Error(problem);
  if (sameGroups(groups, DEFAULT_FILE_GROUPS)) return storage.remove(ALL_KEYS);
  const items: Record<string, unknown> = { [FILE_GROUPS_KEY]: groups.length };
  for (const [i, g] of groups.entries()) {
    const item = { label: g.label.trim(), patterns: g.patterns.map((p) => p.trim()).filter(Boolean).join('\n') };
    if (bytes(itemKey(i)) + bytes(JSON.stringify(item)) > QUOTA_BYTES_PER_ITEM) throw new Error(`${item.label}: too many patterns to sync (8 KB per group).`);
    items[itemKey(i)] = item;
  }
  await storage.set(items);
  const leftovers = Object.keys(await storage.get(null)).filter((k) => isGroupsKey(k) && !(k in items));
  if (leftovers.length > 0) await storage.remove(leftovers);
}

/** Calls `cb` with the groups whenever another context (or this one) changes them. */
export function onFileGroupsChange(cb: (groups: FileGroup[]) => void, storage: GroupsStorage = chromeSync()): () => void {
  let active = true;
  const off = storage.subscribe((keys) => {
    if (!keys.some(isGroupsKey)) return;
    void loadFileGroups(storage).then((groups) => active && cb(groups), () => undefined);
  });
  return () => {
    active = false;
    off();
  };
}
