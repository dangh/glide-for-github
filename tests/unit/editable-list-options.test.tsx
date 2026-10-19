// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileGroupSettingsForm } from '../../src/options/FileGroupSettings';
import { RelatedFilesSettingsForm } from '../../src/options/RelatedFilesSettings';
import type { FileGroup } from '../../src/shared/file-groups';
import type { RelatedRule } from '../../src/shared/related-files';
import { defaultGroups } from '../../src/shared/file-groups-storage';
import { defaultRules } from '../../src/shared/related-files-storage';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';

const storage = vi.hoisted(() => ({
  groups: {
    load: vi.fn<() => Promise<FileGroup[]>>(),
    save: vi.fn<(groups: readonly FileGroup[]) => Promise<void>>(),
    change: (_groups: FileGroup[]): void => undefined,
    off: vi.fn(),
  },
  rules: {
    load: vi.fn<() => Promise<RelatedRule[]>>(),
    save: vi.fn<(rules: readonly RelatedRule[]) => Promise<void>>(),
    change: (_rules: RelatedRule[]): void => undefined,
    off: vi.fn(),
  },
}));
vi.mock('../../src/shared/file-groups-storage', async (original) => ({
  ...await original<typeof import('../../src/shared/file-groups-storage')>(),
  loadFileGroups: storage.groups.load,
  saveFileGroups: storage.groups.save,
  onFileGroupsChange: (cb: typeof storage.groups.change) => { storage.groups.change = cb; return storage.groups.off; },
}));
vi.mock('../../src/shared/related-files-storage', async (original) => ({
  ...await original<typeof import('../../src/shared/related-files-storage')>(),
  loadRelatedRules: storage.rules.load,
  saveRelatedRules: storage.rules.save,
  onRelatedRulesChange: (cb: typeof storage.rules.change) => { storage.rules.change = cb; return storage.rules.off; },
}));
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const groups = (label: string): FileGroup[] => [{ label, patterns: ['*.md'] }];
const rules = (main: string): RelatedRule[] => [{ main, companions: ['*.lock'] }];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const editors = [
  {
    name: 'file groups',
    render: () => createElement(FileGroupSettingsForm, { settings: DEFAULT_SETTINGS.fileGroups, update: () => undefined }),
    selector: '[aria-label="Name of group 1"]',
    seed: () => storage.groups.load.mockResolvedValue(groups('Initial')),
    deferLoad: (promise: Promise<string>) => storage.groups.load.mockImplementation(() => promise.then(groups)),
    change: (name: string) => storage.groups.change(groups(name)),
    savedNames: () => storage.groups.save.mock.calls.map(([items]) => items[0]?.label),
    defaultName: defaultGroups()[0]!.label,
    storage: storage.groups,
  },
  {
    name: 'related rules',
    render: () => createElement(RelatedFilesSettingsForm, { style: 'nested', update: () => undefined }),
    selector: '[aria-label="Main file of rule 1"]',
    seed: () => storage.rules.load.mockResolvedValue(rules('Initial')),
    deferLoad: (promise: Promise<string>) => storage.rules.load.mockImplementation(() => promise.then(rules)),
    change: (name: string) => storage.rules.change(rules(name)),
    savedNames: () => storage.rules.save.mock.calls.map(([items]) => items[0]?.main),
    defaultName: defaultRules()[0]!.main,
    storage: storage.rules,
  },
];

for (const editor of editors) describe(editor.name, () => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;
  const input = () => container.querySelector<HTMLInputElement>(editor.selector)!;
  const mount = () => act(async () => root.render(editor.render()));
  const edit = (value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
  const advance = (ms: number) => act(async () => vi.advanceTimersByTime(ms));

  beforeEach(() => {
    vi.useFakeTimers();
    editor.seed();
    editor.storage.save.mockResolvedValue(undefined);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    mounted = true;
  });
  afterEach(async () => {
    if (mounted) await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('uses defaults when the initial read fails', async () => {
    editor.storage.load.mockRejectedValue(new Error('read failed'));
    await mount();
    expect(input().value).toBe(editor.defaultName);
    expect(editor.storage.save).not.toHaveBeenCalled();
  });

  it('keeps a storage event when an older initial read fails', async () => {
    const load = deferred<string>();
    editor.deferLoad(load.promise);
    await mount();
    await act(async () => editor.change('External'));
    await act(async () => load.reject(new Error('read failed')));
    expect(input().value).toBe('External');
  });

  it('debounces valid edits for 400 ms and saves the latest normalized draft', async () => {
    await mount();
    await edit('First');
    await advance(200);
    await edit(' Edited ');
    await advance(399);
    expect(editor.storage.save).not.toHaveBeenCalled();
    await advance(1);
    expect(editor.savedNames()).toEqual(['Edited']);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Saved');
  });

  it.each(['Draft', ''])('protects an unsaved draft %j from external changes', async (value) => {
    await mount();
    await edit(value);
    await act(async () => editor.change('External'));
    expect(input().value).toBe(value);
  });

  it('adopts changes once the local draft is saved and keeps the input for identical echoes', async () => {
    await mount();
    await edit('Edited');
    await advance(400);
    const current = input();
    await act(async () => editor.change('Edited'));
    expect(input()).toBe(current);
    await act(async () => editor.change('External'));
    expect(input().value).toBe('External');
  });

  it('cancels a pending save when the next edit is invalid', async () => {
    await mount();
    await edit('Valid');
    await edit('');
    await act(async () => { window.dispatchEvent(new Event('pagehide')); });
    await advance(400);
    expect(editor.storage.save).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it.each(['pagehide', 'hidden', 'unmount'])('flushes synchronously on %s and cancels the timer', async (event) => {
    await mount();
    await edit('Edited');
    await act(async () => {
      if (event === 'unmount') {
        root.unmount();
        mounted = false;
      } else if (event === 'hidden') {
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
      } else {
        window.dispatchEvent(new Event('pagehide'));
      }
      expect(editor.savedNames()).toEqual(['Edited']);
    });
    await advance(400);
    expect(editor.storage.save).toHaveBeenCalledTimes(1);
    if (!mounted) expect(editor.storage.off).toHaveBeenCalledTimes(1);
  });

  it('keeps the draft and shows the error when its save fails', async () => {
    editor.storage.save.mockRejectedValueOnce(new Error('sync failed'));
    await mount();
    await edit('Edited');
    await advance(400);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('sync failed');
    await act(async () => editor.change('External'));
    expect(input().value).toBe('Edited');
  });

  it('does not mark newer unsaved edits as saved when an older write completes', async () => {
    const write = deferred<void>();
    editor.storage.save.mockReturnValueOnce(write.promise);
    await mount();
    await edit('First');
    await advance(400);
    await edit('Second');
    await act(async () => write.resolve());
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(input().value).toBe('Second');
  });

  it('ignores an older write failure after a newer save succeeds', async () => {
    const write = deferred<void>();
    editor.storage.save.mockReturnValueOnce(write.promise);
    await mount();
    await edit('First');
    await advance(400);
    await edit('Second');
    await advance(400);
    await act(async () => write.reject(new Error('old failure')));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Saved');
    expect(input().value).toBe('Second');
  });
});
