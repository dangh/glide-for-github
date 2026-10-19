/**
 * Where the related-files rules live: one `chrome.storage.sync` item, `pierre.relatedFiles` (`{ rules }`, each rule's
 * companions one newline-separated string), beside the settings and the file groups. The default rules are under 1 KB,
 * so one item holds them with room to spare, and a save is one atomic write. No item means the default rules, so users
 * who never edit them get later changes to the defaults. The race fixes are the file groups' (file-groups-storage.ts):
 * the write is issued before anything is awaited, and a change read that resolves late is dropped.
 */
import { chromeSync, type GroupsStorage } from './file-groups-storage';
import { DEFAULT_RELATED_RULES, parseRule, rulesProblem, type RelatedRule } from './related-files';

export const RELATED_RULES_KEY = 'pierre.relatedFiles';
/** chrome.storage.sync.QUOTA_BYTES_PER_ITEM: the key plus the JSON of its value, in bytes. */
const QUOTA_BYTES_PER_ITEM = 8192;

export const defaultRules = (): RelatedRule[] => DEFAULT_RELATED_RULES.map((r) => ({ main: r.main, companions: [...r.companions] }));

export const sameRules = (a: readonly RelatedRule[], b: readonly RelatedRule[]) =>
  a.length === b.length && a.every((r, i) => r.main === b[i]!.main && r.companions.join('\n') === b[i]!.companions.join('\n'));

/** The rules in a snapshot of the storage area: the stored ones when they are valid, else the defaults. */
export function rulesFromItems(items: Record<string, unknown>): RelatedRule[] {
  const stored = items[RELATED_RULES_KEY] as { rules?: unknown } | undefined;
  const list = typeof stored === 'object' && stored !== null && Array.isArray(stored.rules) ? stored.rules : null;
  if (!list) return defaultRules();
  const rules = list.map(parseRule);
  if (rules.some((r) => r === null)) return defaultRules();
  return rulesProblem(rules as RelatedRule[]) ? defaultRules() : (rules as RelatedRule[]);
}

export async function loadRelatedRules(storage: GroupsStorage = chromeSync()): Promise<RelatedRule[]> {
  return rulesFromItems(await storage.get(null));
}

/** Stores `rules` (the defaults are stored as nothing). Rejects rules `rulesProblem` rejects or too big to sync. */
export async function saveRelatedRules(rules: readonly RelatedRule[], storage: GroupsStorage = chromeSync()): Promise<void> {
  const problem = rulesProblem(rules);
  if (problem) throw new Error(problem);
  if (sameRules(rules, DEFAULT_RELATED_RULES)) return storage.remove([RELATED_RULES_KEY]);
  const value = { rules: rules.map((r) => ({ main: r.main.trim(), companions: r.companions.map((c) => c.trim()).filter(Boolean).join('\n') })) };
  const size = new TextEncoder().encode(RELATED_RULES_KEY + JSON.stringify(value)).length;
  if (size > QUOTA_BYTES_PER_ITEM) throw new Error('These rules are too many to sync (8 KB in all).');
  await storage.set({ [RELATED_RULES_KEY]: value });
}

/** Calls `cb` with the rules whenever another context (or this one) changes them. */
export function onRelatedRulesChange(cb: (rules: RelatedRule[]) => void, storage: GroupsStorage = chromeSync()): () => void {
  let active = true;
  let revision = 0;
  const off = storage.subscribe((keys) => {
    if (!keys.includes(RELATED_RULES_KEY)) return;
    const read = ++revision;
    void loadRelatedRules(storage).then((rules) => active && read === revision && cb(rules), () => undefined);
  });
  return () => {
    active = false;
    off();
  };
}
