// @vitest-environment jsdom
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isNoTokenError, requireToken } from '../../src/viewer/auth/requireToken';
import { DEFAULT_OWNER_KEY, TOKENS_STORAGE_KEY, getToken, listTokens, setToken, setTokenStorage, type TokenStorageArea } from '../../src/viewer/auth/tokens';
import { GithubApi } from '../../src/viewer/github/api';
import type { PrData } from '../../src/viewer/github/private';
import { usePr } from '../../src/viewer/state/store';
import { TokenPromptHost } from '../../src/viewer/ui/TokenPrompt';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TOKEN = 'ghp_PromptSecretToken0123456789';
const FINE = 'github_pat_PromptFineGrained0123456789';

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

const reply = (status: number, json: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(json), { status, headers });

beforeEach(async () => {
  area = fakeArea();
  setTokenStorage(area);
  usePr.setState({ pr: { ref: { owner: 'dangh', repo: 'pierre-sandbox', number: 7, page: 'changes' } } as PrData });
  fetchMock = vi.fn(async () => reply(200, { login: 'dangh' }, { 'X-OAuth-Scopes': 'repo' }));
  vi.stubGlobal('fetch', fetchMock);
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(TokenPromptHost)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  setTokenStorage(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const input = () => document.querySelector<HTMLInputElement>('input[type="password"]')!;
const checkbox = () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
const button = (name: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === name)!;

async function type(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const click = (el: HTMLElement) => act(async () => el.click());
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

describe('requireToken', () => {
  it('resolves a GithubApi immediately, without a prompt, when a token is stored (owner key is case-insensitive)', async () => {
    await setToken('DangH', TOKEN, { login: 'dangh' });
    const api = await requireToken('dangh', 'comment');
    expect(api).toBeInstanceOf(GithubApi);
    expect(dialog()).toBeNull();
  });

  it('opens the prompt naming the owner and reason, with both links, the all-owners checkbox and the SSO note', async () => {
    const pending = requireToken('dangh', 'comment');
    pending.catch(() => undefined);
    await settle();
    const d = dialog()!;
    expect(d).not.toBeNull();
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(d.querySelector('h2')!.textContent).toBe('Connect Pierre to GitHub');
    expect(d.textContent).toContain('To comment on dangh/pierre-sandbox, Pierre needs a GitHub token for dangh.');
    const hrefs = [...d.querySelectorAll('a')].map((a) => a.getAttribute('href')!);
    expect(hrefs.some((h) => h.startsWith('https://github.com/settings/personal-access-tokens/new'))).toBe(true);
    expect(hrefs).toContain('https://github.com/settings/tokens/new?scopes=repo&description=Pierre%20for%20GitHub');
    const fine = new URL(hrefs.find((h) => h.includes('personal-access-tokens'))!);
    expect(fine.searchParams.get('pull_requests')).toBe('write');
    expect(fine.searchParams.get('contents')).toBe('read');
    for (const a of d.querySelectorAll('a')) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toContain('noopener');
    }
    expect(d.textContent).toContain('Pull requests: Read and write');
    expect(d.textContent).toContain('Contents: Read');
    expect(d.textContent).toContain('If your organization uses SAML SSO, authorize the token for it after creating it.');
    expect(input().type).toBe('password');
    expect(input().autocomplete).toBe('off');
    expect(d.textContent).toContain('Use this token for all owners');
    expect(button('Save token')).toBeTruthy();
    expect(document.activeElement).toBe(input());
    await click(button('Cancel'));
    await expect(pending).rejects.toMatchObject({ kind: 'no-token', owner: 'dangh', name: 'WriteError' });
  });

  it('validates via GET /user, saves under the lower-cased owner and resolves a working GithubApi', async () => {
    const pending = requireToken('DangH', 'comment');
    await settle();
    await type(input(), `  ${TOKEN}  `);
    await click(button('Save token'));
    await settle();
    const api = await pending;
    expect(api).toBeInstanceOf(GithubApi);
    expect(dialog()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/user');
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(await getToken('dangh')).toBe(TOKEN);
    expect(await listTokens()).toEqual([{ owner: 'dangh', login: 'dangh', kind: 'classic' }]);
  });

  it('"Use this token for all owners" saves under *', async () => {
    const pending = requireToken('dangh', 'comment');
    await settle();
    await type(input(), TOKEN);
    await click(checkbox());
    await click(button('Save token'));
    await settle();
    await pending;
    expect(Object.keys(area.data[TOKENS_STORAGE_KEY] as object)).toEqual([DEFAULT_OWNER_KEY]);
    expect(await getToken('anyone')).toBe(TOKEN);
  });

  it('shows the classified reason inline and keeps the prompt open when validation fails', async () => {
    fetchMock.mockResolvedValueOnce(reply(401, { message: 'Bad credentials' }));
    const pending = requireToken('dangh', 'comment');
    pending.catch(() => undefined);
    await settle();
    await type(input(), TOKEN);
    await click(button('Save token'));
    await settle();
    const alert = dialog()!.querySelector('[role="alert"]')!;
    expect(alert.textContent).toMatch(/rejected the token/i);
    expect(alert.textContent).not.toContain(TOKEN);
    expect(await getToken('dangh')).toBeNull();
    // A second attempt with a good token succeeds in the same prompt.
    await type(input(), FINE);
    await click(button('Save token'));
    await settle();
    await expect(pending).resolves.toBeInstanceOf(GithubApi);
    expect(await listTokens()).toEqual([{ owner: 'dangh', login: 'dangh', kind: 'fine-grained' }]);
  });

  it('rejects a classic token without the repo scope', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { login: 'dangh' }, { 'X-OAuth-Scopes': 'read:org' }));
    const pending = requireToken('dangh', 'comment');
    pending.catch(() => undefined);
    await settle();
    await type(input(), TOKEN);
    await click(button('Save token'));
    await settle();
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toMatch(/repo scope/);
    expect(await getToken('dangh')).toBeNull();
    await click(button('Cancel'));
  });

  it('Save is disabled while the field is empty; Cancel and Esc reject with no-token and change nothing', async () => {
    const first = requireToken('dangh', 'comment');
    first.catch(() => undefined);
    await settle();
    expect(button('Save token').disabled).toBe(true);
    await act(async () => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    const err = await first.catch((e: unknown) => e);
    expect(isNoTokenError(err)).toBe(true);
    expect(dialog()).toBeNull();

    const second = requireToken('dangh');
    second.catch(() => undefined);
    await settle();
    await click(button('Cancel'));
    expect(isNoTokenError(await second.catch((e: unknown) => e))).toBe(true);
    expect(area.data[TOKENS_STORAGE_KEY]).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('traps Tab focus inside the dialog and restores focus on close', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const pending = requireToken('dangh', 'comment');
    pending.catch(() => undefined);
    await settle();
    await type(input(), TOKEN); // enables Save, so it is focusable
    const focusable = [...dialog()!.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input')];
    const last = focusable[focusable.length - 1]!;
    last.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    await act(async () => void document.dispatchEvent(tab));
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(focusable[0]);
    const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    await act(async () => void document.dispatchEvent(back));
    expect(document.activeElement).toBe(last);
    await click(button('Cancel'));
    expect(document.activeElement).toBe(opener);
  });

  it('concurrent requests for one owner share a single prompt', async () => {
    const a = requireToken('dangh', 'comment');
    const b = requireToken('DANGH', 'resolve a thread');
    await settle();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    await type(input(), TOKEN);
    await click(button('Save token'));
    await settle();
    const [apiA, apiB] = await Promise.all([a, b]);
    expect(apiA).toBeInstanceOf(GithubApi);
    expect(apiB).toBeInstanceOf(GithubApi);
  });

  it('force re-prompts even when a token is stored and shows the problem', async () => {
    await setToken('dangh', TOKEN);
    const pending = requireToken('dangh', 'comment', { force: true, problem: 'GitHub rejected the token for dangh.' });
    pending.catch(() => undefined);
    await settle();
    expect(dialog()!.textContent).toContain('GitHub rejected the token for dangh.');
    await click(button('Cancel'));
    await pending.catch(() => undefined);
    expect(await getToken('dangh')).toBe(TOKEN); // cancel keeps the old token
  });

  it('rejects with no-token when no PR is loaded', async () => {
    usePr.setState({ pr: null });
    await expect(requireToken('dangh')).rejects.toMatchObject({ kind: 'no-token' });
    expect(dialog()).toBeNull();
  });

  it('never writes the token to the console', async () => {
    const pending = requireToken('dangh', 'comment');
    await settle();
    await type(input(), TOKEN);
    await click(button('Save token'));
    await settle();
    await pending;
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) expect(JSON.stringify(vi.mocked(console[m]).mock.calls)).not.toContain(TOKEN);
  });
});
