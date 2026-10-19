// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { importLegacyState, legacyStateKeys, migrationKey, parseLegacyState, readLegacyState } from '../../src/shared/legacy-session';
import { migrateLegacyState, serveLegacyState } from '../../src/inpage/legacyState';

const pr = 'owner/repo#1';
const ref = { owner: 'owner', repo: 'repo', number: 1, page: 'files' } as const;
const draft = `pierre.drafts:${pr}`;
const batch = `pierre.applySuggestions.batch:${pr}`;
const key = `pierre.applySuggestions.key:${pr}`;
beforeEach(() => sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());

it('recovers every supported key without exporting credentials, unrelated state, or another PR', () => {
  const source = new Map(legacyStateKeys(pr).map(name => [name, `saved:${name}`]));
  source.set('pierre.tokens', 'private');
  source.set('pierre.drafts:owner/repo#2', 'other PR');
  const original = [...source];
  const snapshot = readLegacyState({ getItem: name => source.get(name) ?? null, setItem: vi.fn() }, pr);
  importLegacyState(sessionStorage, pr, snapshot);
  expect(readLegacyState(sessionStorage, pr)).toEqual(snapshot);
  expect(snapshot).toHaveLength(5);
  expect([...source]).toEqual(original);
  expect(sessionStorage.getItem('pierre.tokens')).toBeNull();
  expect(sessionStorage.getItem('pierre.drafts:owner/repo#2')).toBeNull();
});

it('keeps newer page state and never resurrects drafts deleted after migration', () => {
  sessionStorage.setItem(draft, 'newer');
  importLegacyState(sessionStorage, pr, [[draft, 'old']]);
  expect(sessionStorage.getItem(draft)).toBe('newer');
  sessionStorage.removeItem(draft);
  importLegacyState(sessionStorage, pr, [[draft, 'old']]);
  expect(sessionStorage.getItem(draft)).toBeNull();
});

it.each([batch, key])('does not combine an existing suggestion state item (%s) with an old pair', existing => {
  sessionStorage.setItem(existing, 'new');
  importLegacyState(sessionStorage, pr, [[batch, 'old batch'], [key, 'old key']]);
  expect(sessionStorage.getItem(existing)).toBe('new');
  expect(sessionStorage.getItem(existing === key ? batch : key)).toBeNull();
});

it('replays the recorded copy after a partial failure, retaining the original idempotency key', () => {
  const store = {
    getItem: (name: string) => sessionStorage.getItem(name),
    setItem(name: string, value: string) {
      if (name === key) throw new Error('quota');
      sessionStorage.setItem(name, value);
    },
  };
  expect(() => importLegacyState(store, pr, [[batch, 'batch'], [key, 'retry-key']])).toThrow('quota');
  expect(sessionStorage.getItem(migrationKey(pr))).not.toBe('done');
  importLegacyState(sessionStorage, pr, []);
  expect(sessionStorage.getItem(batch)).toBe('batch');
  expect(sessionStorage.getItem(key)).toBe('retry-key');
  expect(sessionStorage.getItem(migrationKey(pr))).toBe('done');
});

it.each([null, [['pierre.tokens', 'private']], [[draft, 1]], [[draft, 'a'], [draft, 'b']]])('rejects invalid snapshots: %j', snapshot => {
  expect(() => parseLegacyState(snapshot, pr)).toThrow('Invalid saved viewer state');
  expect(sessionStorage.length).toBe(0);
});

it('only responds to the same extension, top frame, tab and PR through runtime messaging', async () => {
  const addListener = vi.fn();
  vi.stubGlobal('chrome', { runtime: { id: 'extension', onMessage: { addListener } }, tabs: { getCurrent: async () => ({ id: 7 }) } });
  sessionStorage.setItem(draft, 'saved');
  await serveLegacyState();
  const listener = addListener.mock.calls[0]![0];
  const sender = { id: 'extension', tab: { id: 7 }, frameId: 0, url: 'https://github.com/owner/repo/pull/1/files' };
  const request = { type: 'glide:legacy-session', pr };
  const respond = vi.fn();
  for (const invalid of [
    { ...sender, id: 'other' }, { ...sender, tab: { id: 8 } }, { ...sender, frameId: 1 },
    { ...sender, url: 'https://github.com/owner/repo/pull/2/files' }, { ...sender, url: 'https://example.com/' },
  ]) listener(request, invalid, respond);
  expect(respond).not.toHaveBeenCalled();
  listener(request, sender, respond);
  expect(respond).toHaveBeenCalledWith({ entries: [[draft, 'saved']] });
});

it('ignores recovery responses after the viewer unmounts', async () => {
  const controller = new AbortController();
  vi.stubGlobal('chrome', { runtime: { sendMessage: async () => {
    controller.abort();
    return { entries: [[draft, 'old PR']] };
  } } });
  await migrateLegacyState(ref, controller.signal);
  expect(sessionStorage.length).toBe(0);
});

it('leaves migration retryable when the extension frame cannot be reached', async () => {
  vi.stubGlobal('chrome', { runtime: { sendMessage: async () => undefined } });
  await expect(migrateLegacyState(ref, new AbortController().signal)).rejects.toThrow('Reload to retry');
  expect(sessionStorage.length).toBe(0);
});
