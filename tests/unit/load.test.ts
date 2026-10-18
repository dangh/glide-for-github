import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPr } from '../../src/viewer/state/load';
import { usePr } from '../../src/viewer/state/store';
import { base, fakeRpc, ref } from './sandbox-fixtures';

const header = (position: number) => ({
  featureStates: { pullRequestStacks: 'ENABLED' },
  stack: {
    number: 5,
    position,
    size: 2,
    baseBranch: 'main',
    repositoryOwnerLogin: ref.owner,
    repositoryName: ref.repo,
    pulls: [
      { number: 2, title: 'Top', state: 'OPEN', headBranch: 'top' },
      { number: ref.number, title: 'Bottom', state: 'OPEN', headBranch: 'bottom' },
    ],
  },
});

const settled = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  usePr.getState().setStack(null);
  vi.restoreAllMocks();
});

describe('loadPr', () => {
  it("puts the PR's stack in the store after the PR, from page_data/header", async () => {
    let gate!: () => void;
    const headerAsked = new Promise<void>((r) => (gate = r));
    const rpc = fakeRpc(async (path) => {
      if (path !== `${base}/page_data/header`) return undefined;
      await headerAsked;
      return { data: header(1), link: null };
    });
    await loadPr(rpc, ref);
    expect(usePr.getState().pr).not.toBeNull();
    expect(usePr.getState().stack).toBeNull();
    gate();
    await settled();
    expect(usePr.getState().stack).toMatchObject({ number: 5, position: 1, size: 2 });
  });

  it('keeps the stack shown when a reload cannot read it, and drops it when GitHub says there is none', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await loadPr(fakeRpc((path) => (path === `${base}/page_data/header` ? { data: header(1), link: null } : undefined)), ref);
    await settled();
    await loadPr(fakeRpc((path) => (path === `${base}/page_data/header` ? Promise.reject({ status: 500, message: 'HTTP 500' }) : undefined)), ref);
    await settled();
    expect(usePr.getState().stack?.number).toBe(5);
    expect(warn).toHaveBeenCalledWith('[pierre] stack', expect.anything());
    await loadPr(fakeRpc(), ref);
    await settled();
    expect(usePr.getState().stack).toBeNull();
  });
});
