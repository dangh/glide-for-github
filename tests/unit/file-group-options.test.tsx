// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FileGroupSettingsForm } from '../../src/options/FileGroupSettings';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { saveFileGroups } from '../../src/shared/file-groups-storage';
import { ALL_GROUP } from '../../src/shared/file-groups';

vi.mock('../../src/shared/file-groups-storage', async (original) => ({
  ...await original<typeof import('../../src/shared/file-groups-storage')>(),
  loadFileGroups: async () => [{ label: 'Docs', patterns: ['*.md'] }],
  onFileGroupsChange: () => () => undefined,
  saveFileGroups: vi.fn(() => new Promise<void>(() => undefined)),
}));
// jsdom has no layout observer; textarea sizing is covered in the browser tests.
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it('issues the renamed default write during pagehide without waiting for the group write', async () => {
  const update = vi.fn();
  await act(async () => root.render(createElement(FileGroupSettingsForm, {
    settings: { ...DEFAULT_SETTINGS.fileGroups, defaultGroup: 'Docs' }, update,
  })));
  const input = container.querySelector<HTMLInputElement>('[aria-label="Name of group 1"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Documentation');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => void window.dispatchEvent(new Event('pagehide')));
  expect(saveFileGroups).toHaveBeenCalledWith([{ label: 'Documentation', patterns: ['*.md'] }]);
  expect(update).toHaveBeenCalledWith({ fileGroups: { defaultGroup: 'Documentation' } });
});

it.each(['Documentation', ALL_GROUP])('rolls a failed rename back only if the default still follows it (%s)', async (defaultGroup) => {
  let reject!: (error: Error) => void;
  vi.mocked(saveFileGroups).mockReturnValueOnce(new Promise<void>((_resolve, no) => { reject = no; }));
  const update = vi.fn();
  const render = (defaultGroup: string) => act(async () => root.render(createElement(FileGroupSettingsForm, {
    settings: { ...DEFAULT_SETTINGS.fileGroups, defaultGroup }, update,
  })));
  await render('Docs');
  const input = container.querySelector<HTMLInputElement>('[aria-label="Name of group 1"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Documentation');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => vi.advanceTimersByTime(400));
  expect(update).toHaveBeenLastCalledWith({ fileGroups: { defaultGroup: 'Documentation' } });
  await render(defaultGroup);
  await act(async () => reject(new Error('sync failed')));
  expect(update.mock.calls).toEqual(defaultGroup === 'Documentation'
    ? [[{ fileGroups: { defaultGroup: 'Documentation' } }], [{ fileGroups: { defaultGroup: 'Docs' } }]]
    : [[{ fileGroups: { defaultGroup: 'Documentation' } }]]);
  expect(input.value).toBe('Documentation');
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('sync failed');
});

it('tracks consecutive default renames while writes are pending and ignores an older failure', async () => {
  let reject!: (error: Error) => void;
  vi.mocked(saveFileGroups).mockReturnValueOnce(new Promise<void>((_resolve, no) => { reject = no; }));
  const update = vi.fn();
  const render = (defaultGroup: string) => act(async () => root.render(createElement(FileGroupSettingsForm, {
    settings: { ...DEFAULT_SETTINGS.fileGroups, defaultGroup }, update,
  })));
  const rename = (value: string) => act(async () => {
    const input = container.querySelector<HTMLInputElement>('[aria-label="Name of group 1"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await render('Docs');
  await rename('Documentation');
  await act(async () => vi.advanceTimersByTime(400));
  await render('Documentation');
  await rename('Guides');
  await act(async () => vi.advanceTimersByTime(400));
  await render('Guides');
  await act(async () => reject(new Error('older failure')));
  expect(update.mock.calls).toEqual([
    [{ fileGroups: { defaultGroup: 'Documentation' } }],
    [{ fileGroups: { defaultGroup: 'Guides' } }],
  ]);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('restores the previous default when deleting its group fails', async () => {
  let reject!: (error: Error) => void;
  vi.mocked(saveFileGroups).mockReturnValueOnce(new Promise<void>((_resolve, no) => { reject = no; }));
  const update = vi.fn();
  const render = (defaultGroup: string) => act(async () => root.render(createElement(FileGroupSettingsForm, {
    settings: { ...DEFAULT_SETTINGS.fileGroups, defaultGroup }, update,
  })));
  await render('Docs');
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Delete Docs"]')!.click());
  await act(async () => { window.dispatchEvent(new Event('pagehide')); });
  expect(saveFileGroups).toHaveBeenCalledWith([]);
  expect(update).toHaveBeenLastCalledWith({ fileGroups: { defaultGroup: ALL_GROUP } });
  await render(ALL_GROUP);
  await act(async () => reject(new Error('sync failed')));
  expect(update).toHaveBeenLastCalledWith({ fileGroups: { defaultGroup: 'Docs' } });
});
