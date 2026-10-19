// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../../src/viewer/App';
import { fetchPrData } from '../../src/viewer/github/private';
import { useFileGroups } from '../../src/viewer/state/fileGroups';
import { startLoader } from '../../src/viewer/state/controller';
import { useSettings } from '../../src/viewer/state/settings';
import { usePr } from '../../src/viewer/state/store';
import { fakeRpc, ref } from './sandbox-fixtures';

vi.mock('../../src/viewer/state/controller', () => ({ startLoader: vi.fn() }));
vi.mock('../../src/viewer/state/load', () => ({ loadPr: async () => undefined }));
vi.mock('../../src/viewer/ui/DiffPane', () => ({ DiffPane: () => null }));
vi.mock('../../src/viewer/ui/TreePane', () => ({ TreePane: () => null }));
vi.mock('../../src/viewer/ui/Toolbar', () => ({ Toolbar: () => null }));
vi.mock('../../src/viewer/ui/ApplySuggestions', () => ({ BatchBar: () => null, CommitDialogHost: () => null }));
vi.mock('../../src/viewer/ui/TokenPrompt', () => ({ TokenPromptHost: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const container = document.createElement('div');
const root = createRoot(container);
afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllMocks();
});

it('waits for stored groups before issuing the first diff requests', async () => {
  const rpc = fakeRpc();
  usePr.getState().setPr(await fetchPrData(rpc, ref));
  useSettings.setState({ loaded: true });
  useFileGroups.setState({ loaded: false });
  await act(async () => root.render(createElement(App, { prRef: ref, rpc })));
  expect(startLoader).not.toHaveBeenCalled();
  await act(async () => useFileGroups.setState({ loaded: true }));
  expect(startLoader).toHaveBeenCalledTimes(1);
});
