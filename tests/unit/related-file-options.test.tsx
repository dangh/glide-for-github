// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { RelatedFilesSettingsForm } from '../../src/options/RelatedFilesSettings';
import type { RelatedRule } from '../../src/shared/related-files';

const storage = vi.hoisted(() => ({
  load: vi.fn<() => Promise<RelatedRule[]>>(),
  change: (_rules: RelatedRule[]) => undefined as void,
}));
vi.mock('../../src/shared/related-files-storage', async (original) => ({
  ...await original<typeof import('../../src/shared/related-files-storage')>(),
  loadRelatedRules: storage.load,
  onRelatedRulesChange: (cb: typeof storage.change) => { storage.change = cb; return () => undefined; },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('keeps a newer storage change when the initial options read resolves late', async () => {
  let finish!: (rules: RelatedRule[]) => void;
  storage.load.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(RelatedFilesSettingsForm, { style: 'nested', update: () => undefined })));
    await act(async () => storage.change([{ main: 'new.json', companions: ['new.lock'] }]));
    await act(async () => finish([{ main: 'old.json', companions: ['old.lock'] }]));
    expect(container.querySelector<HTMLInputElement>('[aria-label="Main file of rule 1"]')?.value).toBe('new.json');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
