/** Where the lifecycle learns the viewer's scroll layout: the experiments in the stored settings. */
import { experimentsOf, SETTINGS_STORAGE_KEY } from '../shared/experiments';
import { scrollLayoutOf, type ScrollLayout } from '../shared/page-scroll';

export interface LayoutSource {
  /** The layout for a viewer mounted now, or undefined while it is still being read. */
  get(): ScrollLayout | undefined;
  /** Calls `onChange` when the layout changes; returns an unsubscribe function. */
  subscribe(onChange: () => void): () => void;
}

/** Always today's in-frame scrolling (tests, and the default when nothing else is given). */
export const FRAME_LAYOUT: LayoutSource = { get: () => 'frame', subscribe: () => () => undefined };

/** The layout from `chrome.storage.sync`, following changes made on the options page while a tab is open. */
export function storedLayout(): LayoutSource {
  let layout: ScrollLayout | undefined;
  const listeners = new Set<() => void>();
  const adopt = (item: unknown) => {
    const next = scrollLayoutOf(experimentsOf(item));
    if (next === layout) return;
    layout = next;
    for (const fn of [...listeners]) fn();
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[SETTINGS_STORAGE_KEY]) adopt(changes[SETTINGS_STORAGE_KEY].newValue);
  });
  // A change that arrived while reading is newer than what was read; a failed read (extension reloaded) means 'frame'.
  const first = (item: unknown) => {
    if (layout === undefined) adopt(item);
  };
  chrome.storage.sync.get(SETTINGS_STORAGE_KEY).then((stored) => first(stored[SETTINGS_STORAGE_KEY]), () => first(undefined));
  return {
    get: () => layout,
    subscribe(onChange) {
      listeners.add(onChange);
      return () => void listeners.delete(onChange);
    },
  };
}
