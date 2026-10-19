// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_RELATED_RULES } from '../../src/shared/related-files';
import { RELATED_RULES_KEY, saveRelatedRules } from '../../src/shared/related-files-storage';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import type { FileSummary, PrData } from '../../src/viewer/github/private';
import { useFileGroups } from '../../src/viewer/state/fileGroups';
import { initRelatedFiles, relatedLayout, relationsOf, useRelatedRules } from '../../src/viewer/state/relatedFiles';
import { useSettings } from '../../src/viewer/state/settings';
import { isCollapsed, usePr } from '../../src/viewer/state/store';
import { fakeSync } from './fake-sync';

const rules = DEFAULT_RELATED_RULES;
const shown = ['src/a.ts', 'package-lock.json', 'package.json', 'yarn.lock', 'web/package.json'];

describe('the layout of each style', () => {
  it('nested: companions right after their main file, folded; the main file knows its group', () => {
    const layout = relatedLayout(rules, shown, 'nested');
    expect(layout.items).toEqual(['src/a.ts', 'package.json', 'package-lock.json', 'yarn.lock', 'web/package.json']);
    expect([...layout.folded]).toEqual(['package-lock.json', 'yarn.lock']);
    expect(layout.roles.get('package.json')).toEqual({ kind: 'main', files: ['package.json', 'package-lock.json', 'yarn.lock'] });
    expect(layout.roles.get('package-lock.json')).toEqual({ kind: 'companion', main: 'package.json', above: 'package.json', last: false });
    expect(layout.roles.get('yarn.lock')).toEqual({ kind: 'companion', main: 'package.json', above: 'package-lock.json', last: true });
    expect(layout.roles.get('web/package.json')).toBeUndefined();
  });

  it('off: the open group\'s list itself, no roles', () => {
    const layout = relatedLayout(rules, shown, 'off');
    expect(layout.items).toBe(shown);
    expect(layout.roles.size).toBe(0);
    expect(layout.relations.companions.size).toBe(0);
  });

  it('a list with no related files is shown as it is', () => {
    const plain = ['a.ts', 'b.ts'];
    expect(relatedLayout(rules, plain, 'nested').items).toBe(plain);
  });

  /** The gap CodeView puts above each item of `items` (`undefined`: the list's own gap). */
  const gaps = (layout: ReturnType<typeof relatedLayout>, items = layout.items) =>
    items.slice(1).map((id, i) => [id, layout.gapBefore?.(id, items[i]!)]);

  it('nested: no gap inside a box, so its parts touch; the list gap around it', () => {
    expect(gaps(relatedLayout(rules, shown, 'nested'))).toEqual([
      ['package.json', undefined],
      ['package-lock.json', 0],
      ['yarn.lock', 0],
      ['web/package.json', undefined],
    ]);
  });

  it('off and unrelated files keep the list gap everywhere', () => {
    expect(relatedLayout(rules, shown, 'off').gapBefore).toBeUndefined();
    expect(relatedLayout(rules, ['a.ts', 'b.ts'], 'nested').gapBefore).toBeUndefined();
  });

  it('a part keeps the list gap when CodeView still holds another list (its box is not the item above)', () => {
    const layout = relatedLayout(rules, shown, 'nested');
    expect(gaps(layout, ['package-lock.json', 'package.json', 'src/a.ts', 'yarn.lock'])).toEqual([
      ['package.json', undefined],
      ['src/a.ts', undefined],
      ['yarn.lock', undefined],
    ]);
  });

  it('is computed once per rules and file list, and again when either changes', () => {
    const relations = relationsOf(rules, shown);
    expect(relationsOf(rules, shown)).toBe(relations);
    expect(relationsOf([...rules], shown)).not.toBe(relations);
    expect(relationsOf(rules, [...shown])).not.toBe(relations);
    const layout = relatedLayout(rules, shown, 'nested');
    expect(relatedLayout(rules, shown, 'nested')).toBe(layout);
    // CodeView relays out every item when `gapBefore` changes: it changes with the layout only.
    expect(relatedLayout(rules, shown, 'nested').gapBefore).toBe(layout.gapBefore);
    expect(relatedLayout(rules, [...shown], 'nested').gapBefore).not.toBe(layout.gapBefore);
  });
});

const summary = (path: string): FileSummary => ({ path, status: 'modified', additions: 1, deletions: 1, digest: path, viewed: false }) as FileSummary;
const pr = (paths: string[]): PrData =>
  ({ ref: { owner: 'o', repo: 'r', number: 1 }, headOid: 'h', baseOid: 'b', files: paths.map(summary), viewer: { login: 'me' } }) as unknown as PrData;

describe('folded companions in the store', () => {
  let off: (() => void) | undefined;
  afterEach(() => {
    off?.();
    useSettings.setState({ settings: structuredClone(DEFAULT_SETTINGS) as typeof DEFAULT_SETTINGS });
  });

  it('follow the rules, the style and the open file group', async () => {
    const { storage } = fakeSync();
    usePr.getState().setPr(pr(['package.json', 'package-lock.json', 'src/a.ts']));
    off = initRelatedFiles(storage);
    await new Promise((r) => setTimeout(r, 0));
    expect(useRelatedRules.getState().loaded).toBe(true);
    expect([...usePr.getState().folded]).toEqual(['package-lock.json']);
    expect(isCollapsed(usePr.getState(), 'package-lock.json')).toBe(true);
    expect(isCollapsed(usePr.getState(), 'package.json')).toBe(false);

    usePr.getState().setCollapsed('package-lock.json', false);
    expect(isCollapsed(usePr.getState(), 'package-lock.json')).toBe(false);
    usePr.getState().setCollapsed('package-lock.json', undefined);

    useSettings.setState((s) => ({ settings: { ...s.settings, relatedFiles: { style: 'off' } } }));
    expect(usePr.getState().folded.size).toBe(0);
    useSettings.setState((s) => ({ settings: { ...s.settings, relatedFiles: { style: 'nested' } } }));
    expect([...usePr.getState().folded]).toEqual(['package-lock.json']);

    // A group holding only the lock file: it shows on its own, unfolded.
    useFileGroups.setState({ groups: [{ label: 'Locks', patterns: ['*-lock.json'] }], choice: 'Locks' });
    expect(usePr.getState().folded.size).toBe(0);
    useFileGroups.setState({ choice: '' });
    expect([...usePr.getState().folded]).toEqual(['package-lock.json']);

    await saveRelatedRules([], storage);
    await new Promise((r) => setTimeout(r, 0));
    expect(usePr.getState().folded.size).toBe(0);
  });

  it('reads the stored rules', async () => {
    const { storage } = fakeSync({ [RELATED_RULES_KEY]: { rules: [{ main: 'a.ts', companions: 'a.js' }] } });
    usePr.getState().setPr(pr(['a.ts', 'a.js', 'package.json', 'package-lock.json']));
    off = initRelatedFiles(storage);
    await new Promise((r) => setTimeout(r, 0));
    expect([...usePr.getState().folded]).toEqual(['a.js']);
  });
});
