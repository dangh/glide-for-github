// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FileGroupSettingsForm } from '../../src/options/FileGroupSettings';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { saveFileGroups } from '../../src/shared/file-groups-storage';

vi.mock('../../src/shared/file-groups-storage', async (original) => ({
  ...await original<typeof import('../../src/shared/file-groups-storage')>(),
  loadFileGroups: async () => [{ label: 'Docs', patterns: ['*.md'] }],
  onFileGroupsChange: () => () => undefined,
  saveFileGroups: vi.fn(() => new Promise<void>(() => undefined)),
}));
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
