import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_OWNER_KEY,
  TOKENS_STORAGE_KEY,
  getToken,
  listTokens,
  removeToken,
  setToken,
  setTokenStorage,
  tokenKind,
  type TokenStorageArea,
} from '../../src/viewer/auth/tokens';

function fakeArea(): TokenStorageArea & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (key) => (key in data ? { [key]: structuredClone(data[key]) } : {}),
    set: async (items) => {
      Object.assign(data, structuredClone(items));
    },
  };
}

const CLASSIC = 'ghp_classicSecretValue1234567890';
const FINE = 'github_pat_fineGrainedSecretValue1234567890';
const DEFAULT_TOKEN = 'ghp_defaultSecretValue0987654321';

afterEach(() => setTokenStorage(undefined));

describe('token store', () => {
  it('uses the owner token over the default, falls back to *, and is case-insensitive', async () => {
    setTokenStorage(fakeArea());
    expect(await getToken('dangh')).toBeNull();
    await setToken(DEFAULT_OWNER_KEY, DEFAULT_TOKEN, { login: 'dangh' });
    expect(await getToken('dangh')).toBe(DEFAULT_TOKEN);
    await setToken('DangH', FINE, { login: 'dangh' });
    expect(await getToken('dangh')).toBe(FINE);
    expect(await getToken('DANGH')).toBe(FINE);
    expect(await getToken('someone-else')).toBe(DEFAULT_TOKEN);
  });

  it('stores under the lower-cased owner key', async () => {
    const area = fakeArea();
    setTokenStorage(area);
    await setToken('Acme', CLASSIC, { login: 'me' });
    const stored = area.data[TOKENS_STORAGE_KEY] as Record<string, unknown>;
    expect(Object.keys(stored)).toEqual(['acme']);
  });

  it('removeToken drops only that owner (case-insensitive)', async () => {
    setTokenStorage(fakeArea());
    await setToken('a', CLASSIC);
    await setToken('b', FINE);
    await removeToken('A');
    expect(await getToken('a')).toBeNull();
    expect(await getToken('b')).toBe(FINE);
  });

  it('listTokens returns login/kind metadata and never a token string', async () => {
    setTokenStorage(fakeArea());
    await setToken('*', DEFAULT_TOKEN, { login: 'dangh' });
    await setToken('Org', FINE, { login: 'dangh' });
    await setToken('Other', 'some-opaque-token', { login: 'dangh' });
    const list = await listTokens();
    expect(list).toEqual([
      { owner: '*', login: 'dangh', kind: 'classic' },
      { owner: 'org', login: 'dangh', kind: 'fine-grained' },
      { owner: 'other', login: 'dangh', kind: 'classic' },
    ]);
    const json = JSON.stringify(list);
    for (const secret of [CLASSIC, FINE, DEFAULT_TOKEN, 'some-opaque-token']) expect(json).not.toContain(secret);
    expect(Object.keys(list[0]!).sort()).toEqual(['kind', 'login', 'owner']);
  });

  it('determines the kind by token prefix', () => {
    expect(tokenKind(FINE)).toBe('fine-grained');
    expect(tokenKind(CLASSIC)).toBe('classic');
    expect(tokenKind('gho_whatever')).toBe('classic');
  });

  it('trims the token, rejects an empty one without echoing it, and ignores malformed stored entries', async () => {
    const area = fakeArea();
    setTokenStorage(area);
    await setToken('x', `  ${CLASSIC}\n`);
    expect(await getToken('x')).toBe(CLASSIC);
    await expect(setToken('x', '   ')).rejects.toThrow(/empty/i);
    area.data[TOKENS_STORAGE_KEY] = { ...(area.data[TOKENS_STORAGE_KEY] as object), bad: 42, worse: { nope: true } };
    expect(await getToken('bad')).toBeNull();
    expect((await listTokens()).map((t) => t.owner)).toEqual(['x']);
  });

  it('serializes concurrent writes so none is lost', async () => {
    setTokenStorage(fakeArea());
    await Promise.all([setToken('a', CLASSIC), setToken('b', FINE), setToken('c', DEFAULT_TOKEN)]);
    expect((await listTokens()).map((t) => t.owner)).toEqual(['a', 'b', 'c']);
  });
});
