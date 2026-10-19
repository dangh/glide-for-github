import { describe, expect, it } from 'vitest';
import type { GroupsStorage } from '../../src/shared/file-groups-storage';
import { DEFAULT_RELATED_RULES, type RelatedRule } from '../../src/shared/related-files';
import { loadRelatedRules, onRelatedRulesChange, RELATED_RULES_KEY, rulesFromItems, saveRelatedRules } from '../../src/shared/related-files-storage';
import { SETTINGS_STORAGE_KEY } from '../../src/shared/settings';
import { fakeSync } from './fake-sync';

const custom: RelatedRule[] = [
  { main: 'build.py', companions: ['extra.py'] },
  { main: '*.ts', companions: ['${basename}.js'] },
];

describe('related files storage', () => {
  it('loads the default rules when nothing is stored', async () => {
    const { storage } = fakeSync({ [SETTINGS_STORAGE_KEY]: { diff: {} } });
    expect(await loadRelatedRules(storage)).toEqual(DEFAULT_RELATED_RULES);
  });

  it('stores the rules in one item and reads them back', async () => {
    const { data, storage } = fakeSync({ [SETTINGS_STORAGE_KEY]: { diff: {} } });
    await saveRelatedRules(custom, storage);
    expect(data).toEqual({
      [SETTINGS_STORAGE_KEY]: { diff: {} },
      [RELATED_RULES_KEY]: { rules: [{ main: 'build.py', companions: 'extra.py' }, { main: '*.ts', companions: '${basename}.js' }] },
    });
    expect(await loadRelatedRules(storage)).toEqual(custom);
  });

  it('stores the defaults as nothing, so later default changes reach the user', async () => {
    const { data, storage } = fakeSync();
    await saveRelatedRules(custom, storage);
    await saveRelatedRules(DEFAULT_RELATED_RULES, storage);
    expect(data).toEqual({});
  });

  it('keeps an empty list: every rule deleted means nothing relates', async () => {
    const { storage } = fakeSync();
    await saveRelatedRules([], storage);
    expect(await loadRelatedRules(storage)).toEqual([]);
  });

  it('writes before it reads anything, so a save started as the options page closes is not lost', () => {
    const { data, storage } = fakeSync();
    const stalled: GroupsStorage = { ...storage, get: () => new Promise(() => undefined) };
    void saveRelatedRules(custom, stalled);
    expect(data[RELATED_RULES_KEY]).toBeDefined();
    void saveRelatedRules(DEFAULT_RELATED_RULES, stalled);
    expect(data[RELATED_RULES_KEY]).toBeUndefined();
  });

  it('refuses invalid rules and rules too big to sync, before writing anything', async () => {
    const { data, storage } = fakeSync();
    await expect(saveRelatedRules([{ main: 'a/b', companions: ['c'] }], storage)).rejects.toThrow(/folder/);
    const huge = Array.from({ length: 50 }, (_, i) => ({ main: `main-${i}.json`, companions: Array.from({ length: 8 }, (_, j) => `companion-${i}-${j}.lock`) }));
    await expect(saveRelatedRules(huge, storage)).rejects.toThrow(/too many/);
    expect(data).toEqual({});
  });

  it('falls back to the defaults when the stored rules are damaged', () => {
    expect(rulesFromItems({ [RELATED_RULES_KEY]: { rules: [{ main: 'a', companions: 'b' }] } })).toEqual([{ main: 'a', companions: ['b'] }]);
    for (const damaged of [{ rules: 'x' }, { rules: [{ main: 'a' }] }, { rules: [{ main: 'a/b', companions: 'c' }] }, 7]) {
      expect(rulesFromItems({ [RELATED_RULES_KEY]: damaged })).toEqual(DEFAULT_RELATED_RULES);
    }
  });

  it('reports changes to the rules, not to other items, and drops an older read that resolves late', async () => {
    const { storage } = fakeSync();
    let finishOld!: (items: Record<string, unknown>) => void;
    let first = true;
    const delayed: GroupsStorage = {
      ...storage,
      get: () => {
        if (!first) return storage.get(null);
        first = false;
        return new Promise((resolve) => (finishOld = resolve));
      },
    };
    const seen: RelatedRule[][] = [];
    const off = onRelatedRulesChange((rules) => seen.push(rules), delayed);
    try {
      await storage.set({ [SETTINGS_STORAGE_KEY]: { diff: {} } });
      await saveRelatedRules(custom, storage);
      const old = await storage.get(null);
      const newer = [{ main: 'x.json', companions: ['x.lock'] }];
      await saveRelatedRules(newer, storage);
      await new Promise((r) => setTimeout(r, 0));
      finishOld(old);
      await new Promise((r) => setTimeout(r, 0));
      expect(seen).toEqual([newer]);
    } finally {
      off();
    }
  });
});
