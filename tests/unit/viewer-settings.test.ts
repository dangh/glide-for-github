import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, setSettingsStorage, type DisplaySettings, type SettingsStorage } from '../../src/shared/settings';
import { initSettings, reconcileSettings, useSettings } from '../../src/viewer/state/settings';
import { createDiffOptionsBuilder, ITEM_METRICS, itemMetricsFor } from '../../src/viewer/state/view';

/** In-memory sync area that, like chrome.storage, echoes every write back to subscribers (async). */
function echoingStorage(): SettingsStorage & { writes: number } {
  const data: Record<string, unknown> = {};
  const listeners = new Set<(c: Record<string, { newValue?: unknown }>) => void>();
  const storage = {
    writes: 0,
    area: {
      get: async (key: string) => (key in data ? { [key]: structuredClone(data[key]) } : {}),
      set: async (items: Record<string, unknown>) => {
        storage.writes++;
        Object.assign(data, structuredClone(items));
        const changes = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { newValue: structuredClone(v) }]));
        setTimeout(() => listeners.forEach((l) => l(changes)), 0);
      },
    },
    subscribe(l: (c: Record<string, { newValue?: unknown }>) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return storage;
}

const settle = () => new Promise((r) => setTimeout(r, 10));

afterEach(() => setSettingsStorage(undefined));

describe('viewer settings identity', () => {
  it('a tree-only change, a review toggle and the storage echo produce no new diff-options object', async () => {
    const storage = echoingStorage();
    setSettingsStorage(storage);
    const unsubscribe = initSettings();
    await settle();
    expect(useSettings.getState().loaded).toBe(true);

    const build = createDiffOptionsBuilder();
    const diffOptions = () => build(useSettings.getState().settings.diff, undefined);
    const initial = diffOptions();
    expect(initial.itemMetrics).toBe(ITEM_METRICS);

    let notifications = 0;
    const stop = useSettings.subscribe(() => notifications++);

    useSettings.getState().update({ tree: { stickyFolders: true } });
    await settle(); // the echo of our own write arrives
    expect(diffOptions()).toBe(initial);
    expect(notifications).toBe(1); // the change itself; the echo is a no-op

    useSettings.getState().update({ review: { hideWhitespace: true } });
    await settle();
    expect(diffOptions()).toBe(initial);
    expect(notifications).toBe(2);

    // A diff change makes exactly one new options object, which the echo keeps.
    useSettings.getState().update({ diff: { diffStyle: 'unified' } });
    const unified = diffOptions();
    expect(unified).not.toBe(initial);
    expect(unified.diffStyle).toBe('unified');
    await settle();
    expect(diffOptions()).toBe(unified);
    expect(notifications).toBe(3);
    expect(storage.writes).toBe(3);

    // Re-applying the same values is a no-op.
    useSettings.getState().update({ diff: { diffStyle: 'unified' } });
    expect(notifications).toBe(3);

    stop();
    unsubscribe();
  });

  it("diff options carry the code line height in itemMetrics (CodeView's row estimate), reused while unchanged", () => {
    const build = createDiffOptionsBuilder();
    const diff = DEFAULT_SETTINGS.diff;
    const base = build(diff, undefined);
    expect(base.itemMetrics).toBe(ITEM_METRICS);
    expect(ITEM_METRICS).toMatchObject({ lineHeight: 20, diffHeaderHeight: 42, hunkSeparatorHeight: 24 });
    const big = build(diff, undefined, undefined, undefined, 40);
    expect(big).not.toBe(base);
    expect(big.itemMetrics).toMatchObject({ lineHeight: 40, diffHeaderHeight: 42 });
    expect(build(diff, undefined, undefined, undefined, 40)).toBe(big);
    expect(itemMetricsFor(40)).toBe(big.itemMetrics);
    expect(itemMetricsFor(20)).toBe(ITEM_METRICS);
  });

  it("reserves each header style's height and GitHub's 24 px separator rows only for hunkSeparators 'default'", () => {
    const build = createDiffOptionsBuilder();
    const pierre = build({ ...DEFAULT_SETTINGS.diff, fileHeaderStyle: 'pierre', hunkSeparators: 'line-info-basic' }, undefined).itemMetrics;
    expect(pierre).toMatchObject({ diffHeaderHeight: 40 });
    expect(pierre).not.toHaveProperty('hunkSeparatorHeight');
  });

  it('estimates no space under wrapped files and Pierre\'s 8 px scrollbar strip under scrolling ones', () => {
    const build = createDiffOptionsBuilder();
    expect(build(DEFAULT_SETTINGS.diff, undefined).itemMetrics).toMatchObject({ paddingBottom: 0 });
    expect(build({ ...DEFAULT_SETTINGS.diff, overflow: 'scroll' }, undefined).itemMetrics).toMatchObject({ paddingBottom: 8 });
    expect(build({ ...DEFAULT_SETTINGS.diff, overflow: 'wrap' }, undefined).itemMetrics).toBe(ITEM_METRICS);
  });

  it('reconcileSettings keeps section identity when values are equal', () => {
    const prev = structuredClone(DEFAULT_SETTINGS) as DisplaySettings;
    const same = structuredClone(prev);
    expect(reconcileSettings(prev, same)).toBe(prev);
    const next = { ...same, tree: { ...same.tree, density: 'compact' as const } };
    const merged = reconcileSettings(prev, next);
    expect(merged).not.toBe(prev);
    expect(merged.diff).toBe(prev.diff);
    expect(merged.review).toBe(prev.review);
    expect(merged.fonts).toBe(prev.fonts);
    expect(merged.layout).toBe(prev.layout);
    expect(merged.tree).toBe(next.tree);

    // The new sections reconcile like the others.
    const fonts = { ...merged, fonts: { ...merged.fonts, codeFontSize: 14 } };
    const withFonts = reconcileSettings(merged, fonts);
    expect(withFonts.fonts).toBe(fonts.fonts);
    expect(withFonts.diff).toBe(prev.diff);
    const layout = { ...withFonts, layout: { treePosition: 'right' as const } };
    expect(reconcileSettings(withFonts, layout).layout).toBe(layout.layout);
    expect(SETTINGS_STORAGE_KEY).toBe('pierre.settings');
  });
});
