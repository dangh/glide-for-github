// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { FileGroupSettingsForm } from '../../src/options/FileGroupSettings';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import type { FileGroup } from '../../src/shared/file-groups';
const storage = vi.hoisted(() => ({
  load: vi.fn<() => Promise<FileGroup[]>>(),
  change: (_groups: FileGroup[]): void => undefined,
}));
vi.mock('../../src/shared/file-groups-storage', async (original) => ({
  ...await original<typeof import('../../src/shared/file-groups-storage')>(),
  loadFileGroups: storage.load,
  onFileGroupsChange: (cb: typeof storage.change) => { storage.change = cb; return () => undefined; },
}));
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it('keeps a newer group change when the initial read resolves late', async () => {
  let finish!: (groups: FileGroup[]) => void;
  storage.load.mockImplementation(() => new Promise(resolve => {finish = resolve;}));
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(FileGroupSettingsForm, {settings: DEFAULT_SETTINGS.fileGroups, update: () => undefined})));
    await act(async () => storage.change([{ label: 'New', patterns: ['*.new'] }]));
    await act(async () => finish([{ label: 'Old', patterns: ['*.old'] }]));
    expect(container.querySelector<HTMLInputElement>('[aria-label="Name of group 1"]')?.value).toBe('New');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
