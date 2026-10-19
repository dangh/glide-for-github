import { parsePrUrl, prKey, type PrRef } from '../shared/pr-url';
import { importLegacyState, migrationKey, readLegacyState } from '../shared/legacy-session';

const REQUEST = 'glide:legacy-session';

/** Runtime messaging authenticates the content script; page scripts cannot request old drafts. */
export async function serveLegacyState(): Promise<void> {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id === undefined) return;
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.tab?.id !== tab.id || sender.frameId !== 0) return;
    if (!message || typeof message !== 'object' || !('type' in message) || message.type !== REQUEST || !('pr' in message)) return;
    const ref = sender.url ? parsePrUrl(sender.url) : null;
    if (!ref || message.pr !== prKey(ref)) return;
    try {
      respond({ entries: readLegacyState(sessionStorage, prKey(ref)) });
    } catch {
      respond({ error: 'Could not read saved drafts from the previous viewer.' });
    }
  });
}

export async function migrateLegacyState(ref: PrRef, signal: AbortSignal): Promise<void> {
  const pr = prKey(ref);
  if (sessionStorage.getItem(migrationKey(pr)) === 'done') return;
  const response: unknown = await chrome.runtime.sendMessage({ type: REQUEST, pr });
  if (signal.aborted) return;
  if (!response || typeof response !== 'object' || !('entries' in response)) {
    throw new Error('Could not recover saved viewer state. Reload to retry; the original data is unchanged.');
  }
  importLegacyState(sessionStorage, pr, response.entries);
}
