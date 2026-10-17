// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenSettings } from '../../src/options/TokenSettings';
import { DEFAULT_OWNER_KEY, TOKENS_STORAGE_KEY, listTokens, setToken, setTokenStorage, type TokenStorageArea } from '../../src/viewer/auth/tokens';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SECRET_A = 'ghp_ListSecretAAAA0123456789';
const SECRET_B = 'github_pat_ListSecretBBBB0123456789';
const SECRET_NEW = 'ghp_ListSecretNEW0123456789';

type Listener = (changes: Record<string, unknown>, area: string) => void;

function fakeArea(): TokenStorageArea & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (key) => (key in data ? { [key]: structuredClone(data[key]) } : {}),
    set: async (items) => void Object.assign(data, structuredClone(items)),
  };
}

let root: Root;
let container: HTMLDivElement;
let area: ReturnType<typeof fakeArea>;
let listeners: Set<Listener>;
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const rows = () => [...container.querySelectorAll<HTMLElement>('[data-testid="token-row"]')];
const button = (name: string | RegExp, within: ParentNode = document) =>
  [...within.querySelectorAll('button')].find((b) => (typeof name === 'string' ? b.textContent === name : name.test(b.textContent ?? '')))!;
const click = (el: HTMLElement) => act(async () => el.click());
async function type(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(async () => {
  area = fakeArea();
  setTokenStorage(area);
  listeners = new Set();
  vi.stubGlobal('chrome', {
    storage: { onChanged: { addListener: (l: Listener) => listeners.add(l), removeListener: (l: Listener) => listeners.delete(l) } },
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ login: 'newuser' }), { status: 200, headers: { 'X-OAuth-Scopes': 'repo' } })));
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
  await setToken('acme', SECRET_A, { login: 'alice' });
  await setToken(DEFAULT_OWNER_KEY, SECRET_B, { login: 'bob' });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(TokenSettings)));
  await settle();
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  setTokenStorage(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TokenSettings', () => {
  it('lists each token by owner, login and kind', () => {
    const text = rows().map((r) => r.textContent ?? '');
    expect(text).toHaveLength(2);
    expect(text[0]).toContain('*');
    expect(text[0]).toContain('bob');
    expect(text[0]).toContain('fine-grained');
    expect(text[1]).toContain('acme');
    expect(text[1]).toContain('alice');
    expect(text[1]).toContain('classic');
  });

  it('never shows a token value, in text or attributes', () => {
    for (const secret of [SECRET_A, SECRET_B]) expect(container.innerHTML).not.toContain(secret);
    expect(container.querySelector('input')).toBeNull();
  });

  it('removes a token after a confirmation, leaving the others', async () => {
    const acme = rows().find((r) => r.dataset.owner === 'acme')!;
    await click(button(/^Remove/, acme));
    expect(rows()).toHaveLength(2); // not yet: asks first
    await click(button('Confirm remove', acme));
    await settle();
    expect((await listTokens()).map((t) => t.owner)).toEqual([DEFAULT_OWNER_KEY]);
    expect(rows().map((r) => r.dataset.owner)).toEqual([DEFAULT_OWNER_KEY]);
  });

  it('cancelling the confirmation keeps the token', async () => {
    const acme = rows().find((r) => r.dataset.owner === 'acme')!;
    await click(button(/^Remove/, acme));
    await click(button('Keep', acme));
    expect((await listTokens()).map((t) => t.owner)).toContain('acme');
    expect(button(/^Remove/, acme)).toBeDefined();
  });

  it('Add token opens the standalone prompt; saving adds a row and closes it', async () => {
    await click(button('Add token'));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await type(document.querySelector<HTMLInputElement>('input[name="pierre-token-owner"]')!, 'Newowner');
    await type(document.querySelector<HTMLInputElement>('input[type="password"]')!, SECRET_NEW);
    await click(button('Save token'));
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(rows().map((r) => r.dataset.owner)).toContain('newowner');
    expect(container.innerHTML).not.toContain(SECRET_NEW);
  });

  it('keeps focus in the open dialog when the list refreshes underneath it', async () => {
    await click(button('Add token'));
    const secret = document.querySelector<HTMLInputElement>('input[type="password"]')!;
    secret.focus();
    expect(document.activeElement).toBe(secret);
    await setToken('other', SECRET_NEW, { login: 'carol' });
    await act(async () => listeners.forEach((l) => l({ [TOKENS_STORAGE_KEY]: {} }, 'local')));
    await settle();
    expect(rows().map((r) => r.dataset.owner)).toContain('other');
    expect(document.activeElement).toBe(document.querySelector('input[type="password"]'));
  });

  it('shows an empty state without tokens', async () => {
    area.data[TOKENS_STORAGE_KEY] = {};
    await act(async () => root.render(createElement('div')));
    await act(async () => root.render(createElement(TokenSettings)));
    await settle();
    expect(rows()).toHaveLength(0);
    expect(container.textContent).toMatch(/No tokens saved/);
  });

  it('refreshes when tokens change elsewhere (the viewer saved one)', async () => {
    await setToken('other', SECRET_NEW, { login: 'carol' });
    await act(async () => listeners.forEach((l) => l({ [TOKENS_STORAGE_KEY]: {} }, 'local')));
    await settle();
    expect(rows().map((r) => r.dataset.owner)).toContain('other');
  });

  it('ignores storage changes in other areas or other keys', async () => {
    await setToken('other', SECRET_NEW, { login: 'carol' });
    await act(async () => listeners.forEach((l) => l({ [TOKENS_STORAGE_KEY]: {} }, 'sync')));
    await act(async () => listeners.forEach((l) => l({ unrelated: {} }, 'local')));
    await settle();
    expect(rows().map((r) => r.dataset.owner)).not.toContain('other');
  });

  it('unsubscribes on unmount', async () => {
    expect(listeners.size).toBe(1);
    await act(async () => root.unmount());
    expect(listeners.size).toBe(0);
    root = createRoot(container);
  });
});
