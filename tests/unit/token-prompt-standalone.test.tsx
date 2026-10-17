// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { DEFAULT_OWNER_KEY, TOKENS_STORAGE_KEY, listTokens, setToken, setTokenStorage, type TokenStorageArea } from '../../src/viewer/auth/tokens';
import { TokenPrompt } from '../../src/viewer/ui/TokenPrompt';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TOKEN = 'ghp_StandaloneSecret0123456789';

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
let fetchMock: ReturnType<typeof vi.fn>;
let onSaved: Mock<(owner: string) => void>;
let onCancel: Mock<() => void>;

const reply = (status: number, json: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(json), { status, headers });

beforeEach(async () => {
  area = fakeArea();
  setTokenStorage(area);
  fetchMock = vi.fn(async () => reply(200, { login: 'someone' }, { 'X-OAuth-Scopes': 'repo' }));
  vi.stubGlobal('fetch', fetchMock);
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
  onSaved = vi.fn<(owner: string) => void>();
  onCancel = vi.fn<() => void>();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(TokenPrompt, { standalone: { onSaved, onCancel } })));
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  setTokenStorage(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const owner = () => document.querySelector<HTMLInputElement>('input[name="pierre-token-owner"]')!;
const secret = () => document.querySelector<HTMLInputElement>('input[type="password"]')!;
const allOwners = () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
const button = (name: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === name)!;

async function type(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const click = (el: HTMLElement) => act(async () => el.click());
const submit = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

describe('TokenPrompt, standalone', () => {
  it('asks for an owner and a token, without a pull request', () => {
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(owner()).not.toBeNull();
    expect(secret().type).toBe('password');
    expect(button('Save token').hasAttribute('disabled')).toBe(true);
    expect(document.body.textContent).toMatch(/fine-grained/i);
  });

  it('says the token is tried first and the session is the fallback for resolving threads and marking files viewed', () => {
    const text = document.querySelector('[role="dialog"] p')!.textContent ?? '';
    expect(text).toContain('tried first for resolving threads and marking files viewed');
    expect(text).toContain('your GitHub session as the fallback');
    expect(text).not.toMatch(/token[^.]*is the fallback/);
    expect(text).toContain('Applying suggestions uses your session.');
  });

  it('needs a valid owner before it can save', async () => {
    await type(secret(), TOKEN);
    expect(button('Save token').hasAttribute('disabled')).toBe(true);
    await type(owner(), 'not/valid');
    expect(button('Save token').hasAttribute('disabled')).toBe(true);
    await type(owner(), 'pierre-e2e-owner');
    expect(button('Save token').hasAttribute('disabled')).toBe(false);
  });

  it('validates the token with GET /user, saves it for the lower-cased owner and reports it', async () => {
    await type(owner(), 'Pierre-E2E-Owner');
    await type(secret(), TOKEN);
    await click(button('Save token'));
    await submit();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://api.github.com/user');
    expect(await listTokens()).toEqual([{ owner: 'pierre-e2e-owner', login: 'someone', kind: 'classic' }]);
    expect(onSaved).toHaveBeenCalledWith('pierre-e2e-owner');
  });

  it('saves under the default key when "all owners" is checked, and ignores the owner field', async () => {
    await setToken('keep-me', 'ghp_Existing0123456789', { login: 'x' });
    await type(owner(), 'ignored-owner');
    await click(allOwners());
    expect(owner().disabled).toBe(true);
    await type(secret(), TOKEN);
    await click(button('Save token'));
    await submit();
    expect((await listTokens()).map((t) => t.owner)).toEqual([DEFAULT_OWNER_KEY, 'keep-me']);
    expect(onSaved).toHaveBeenCalledWith(DEFAULT_OWNER_KEY);
  });

  it('shows the error and saves nothing when GitHub rejects the token', async () => {
    fetchMock.mockImplementation(async () => reply(401, { message: 'Bad credentials' }));
    await type(owner(), 'pierre-e2e-owner');
    await type(secret(), 'dummy-not-a-token');
    await click(button('Save token'));
    await submit();
    expect(document.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    expect(area.data[TOKENS_STORAGE_KEY]).toBeUndefined();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('rejects a classic token without the repo scope, saving nothing', async () => {
    fetchMock.mockImplementation(async () => reply(200, { login: 'someone' }, { 'X-OAuth-Scopes': 'read:user' }));
    await type(owner(), 'pierre-e2e-owner');
    await type(secret(), TOKEN);
    await click(button('Save token'));
    await submit();
    expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/repo scope/);
    expect(area.data[TOKENS_STORAGE_KEY]).toBeUndefined();
  });

  it('Cancel and Escape call onCancel', async () => {
    await click(button('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    await act(async () => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('keeps focus when the parent re-renders with new callbacks', async () => {
    secret().focus();
    await act(async () => root.render(createElement(TokenPrompt, { standalone: { onSaved: vi.fn(), onCancel: vi.fn() } })));
    expect(document.activeElement).toBe(secret());
  });

  it('calls the latest callbacks after a re-render', async () => {
    const latest = vi.fn();
    await act(async () => root.render(createElement(TokenPrompt, { standalone: { onSaved: vi.fn(), onCancel: latest } })));
    await click(button('Cancel'));
    expect(latest).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('never puts the token in the DOM', async () => {
    await type(secret(), TOKEN);
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });
});
