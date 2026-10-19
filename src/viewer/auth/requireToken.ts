/**
 * Token gate for every token write: `requireToken(owner, reason?)` resolves a `GithubApi` for the owner, asking the
 * user for a token first (TokenPrompt) when none is stored. Rejects with `WriteError` kind `'no-token'` on cancel.
 *
 * Callers (Tasks 9-10) on an auth failure (`isAuthError(err)`) call it again with `{ force: true, problem: err.message }`
 * so the prompt re-opens even though a (bad) token is stored, then retry the action with the returned api.
 */
import { create } from 'zustand';
import { GithubApi } from '../github/api';
import { noTokenError, WriteError } from '../github/errors';
import type { PrRef } from '../../shared/pr-url';
import { usePr } from '../state/store';
import { getToken } from './tokens';
import { viewerRoot } from '../rootEl';

export type NoTokenError = WriteError & { kind: 'no-token' };

export function isNoTokenError(err: unknown): err is NoTokenError {
  return err instanceof WriteError && err.kind === 'no-token';
}

export interface RequireTokenOptions {
  /** Open the prompt even if a token is stored (the stored one was rejected). */
  force?: boolean;
  /** Why the prompt is shown again, e.g. the classified error message. Shown at the top of the prompt. */
  problem?: string;
}

export interface TokenPromptRequest {
  owner: string;
  reason?: string;
  problem?: string;
  ref: PrRef;
  resolve(api: GithubApi): void;
  reject(err: WriteError): void;
}

interface PromptState {
  /** Pending requests; the first one is shown. */
  queue: TokenPromptRequest[];
}

export const useTokenPrompt = create<PromptState>()(() => ({ queue: [] }));

const dequeue = (request: TokenPromptRequest) => useTokenPrompt.setState((s) => ({ queue: s.queue.filter((r) => r !== request) }));

/** Settles the prompt request and removes it from the queue (called by TokenPrompt). */
export function completePrompt(request: TokenPromptRequest, api: GithubApi): void {
  dequeue(request);
  request.resolve(api);
}

export function cancelPrompt(request: TokenPromptRequest): void {
  dequeue(request);
  request.reject(noTokenError(request.owner));
}

/** One prompt per owner at a time: concurrent requests (several writes at once) share it. */
const pending = new Map<string, Promise<GithubApi>>();

export async function requireToken(owner: string, reason?: string, options: RequireTokenOptions = {}): Promise<GithubApi> {
  const ref = usePr.getState().pr?.ref;
  if (!ref) throw noTokenError(owner);

  if (!options.force) {
    const stored = await getToken(owner);
    if (stored) return new GithubApi(stored, ref);
  }

  // Page scripts can read an open shadow root. Keep token entry on an extension page.
  if (viewerRoot.scope instanceof ShadowRoot) throw new Error('Connect GitHub in Glide extension options before using review actions in this spike.');

  const key = owner.toLowerCase();
  const existing = pending.get(key);
  if (existing) return existing;

  const promise = new Promise<GithubApi>((resolve, reject) => {
    const request: TokenPromptRequest = {
      owner,
      ref,
      ...(reason ? { reason } : {}),
      ...(options.problem ? { problem: options.problem } : {}),
      resolve,
      reject,
    };
    useTokenPrompt.setState((s) => ({ queue: [...s.queue, request] }));
  }).finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}
