/**
 * "Connect Pierre to GitHub" modal: asks for a personal access token for one repo owner, validates it with
 * `GET /user` (api.github.com only), saves it and hands back a `GithubApi`. Opened through `requireToken`;
 * `TokenPromptHost` (mounted once in App) renders the first queued request.
 *
 * The token lives only in this component's state and the extension's storage: it is never logged, never put in a
 * DOM attribute and never sent anywhere but api.github.com.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { PrRef } from '../../shared/pr-url';
import { cancelPrompt, completePrompt, useTokenPrompt, type TokenPromptRequest } from '../auth/requireToken';
import { DEFAULT_OWNER_KEY, removeToken, setToken } from '../auth/tokens';
import { GithubApi } from '../github/api';
import { isWriteError } from '../github/errors';

export const CLASSIC_TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo&description=Pierre%20for%20GitHub';
const FINE_GRAINED_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

/**
 * Fine-grained token page with the token name, description and permissions pre-filled (GitHub documents these
 * URL parameters: name, description, pull_requests, contents). The resource owner is left for the user to pick.
 */
export function fineGrainedTokenUrl(): string {
  const params = new URLSearchParams({
    name: 'Pierre for GitHub',
    description: 'Pierre for GitHub: Pull requests read and write, Contents read',
    pull_requests: 'write',
    contents: 'read',
  });
  return `${FINE_GRAINED_TOKEN_URL}?${params.toString().replace(/\+/g, '%20')}`;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function reasonText(owner: string, reason: string | undefined, ref: PrRef): string {
  const where = ref.owner.toLowerCase() === owner.toLowerCase() ? `${ref.owner}/${ref.repo}` : owner;
  return reason
    ? `To ${reason} on ${where}, Pierre needs a GitHub token for ${owner}.`
    : `To make changes on ${where}, Pierre needs a GitHub token for ${owner}.`;
}

export function TokenPrompt({ request }: { request: TokenPromptRequest }) {
  const { owner, reason, problem, ref } = request;
  // The field is uncontrolled: React would copy a controlled value into the `value` attribute, where DOM snapshots capture it.
  const [hasValue, setHasValue] = useState(false);
  const [allOwners, setAllOwners] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const alive = useRef(true);

  const cancel = useCallback(() => cancelPrompt(request), [request]);

  // Focus management: password field first, Tab trapped inside, focus returned to the opener on close.
  useEffect(() => {
    alive.current = true;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    field.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Captured and stopped: Esc closes the prompt only, never an inline composer underneath.
        e.preventDefault();
        e.stopPropagation();
        cancel();
        return;
      }
      if (e.key !== 'Tab' || !dialog.current) return;
      const items = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      const outside = !(active instanceof Node) || !dialog.current.contains(active);
      if (e.shiftKey && (active === first || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      alive.current = false;
      document.removeEventListener('keydown', onKey, true);
      opener?.focus?.();
    };
  }, [cancel]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const value = (field.current?.value ?? '').trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      const api = new GithubApi(value, ref);
      const { login, scopes } = await api.viewer();
      // Classic tokens report their scopes; writing review comments needs `repo` (or `public_repo` for public repos).
      if (scopes && !scopes.includes('repo') && !scopes.includes('public_repo')) {
        if (alive.current) setError('This classic token does not have the repo scope. Create one with the repo scope (link above).');
        return;
      }
      await setToken(allOwners ? DEFAULT_OWNER_KEY : owner, value, { login });
      // An owner-specific token would keep winning over `*`; if it was the stale one that caused this prompt, drop it.
      if (allOwners && owner.toLowerCase() !== DEFAULT_OWNER_KEY) await removeToken(owner);
      if (!alive.current) return;
      completePrompt(request, api);
    } catch (err) {
      if (!alive.current) return;
      setError(isWriteError(err) ? err.message : 'Could not save the token.');
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="token-prompt-title" ref={dialog}>
        <form onSubmit={save}>
          <h2 id="token-prompt-title">Connect Pierre to GitHub</h2>
          {problem && <p className="modal-problem">{problem}</p>}
          <p>{reasonText(owner, reason, ref)}</p>
          <ul className="modal-links">
            <li>
              <a href={fineGrainedTokenUrl()} target="_blank" rel="noopener noreferrer">
                Create a fine-grained token
              </a>
              <span className="modal-muted"> (Pull requests: Read and write, Contents: Read)</span>
            </li>
            <li>
              <a href={CLASSIC_TOKEN_URL} target="_blank" rel="noopener noreferrer">
                Create a classic token
              </a>
              <span className="modal-muted"> (repo scope)</span>
            </li>
          </ul>
          <p className="modal-muted">If your organization uses SAML SSO, authorize the token for it after creating it.</p>
          <label className="modal-field">
            <span>Token for {owner}</span>
            <input
              ref={field}
              type="password"
              name="pierre-token"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setHasValue(e.target.value.trim() !== '')}
              aria-describedby={error ? 'token-prompt-error' : undefined}
              aria-invalid={error ? true : undefined}
            />
          </label>
          <label className="modal-check">
            <input type="checkbox" checked={allOwners} onChange={(e) => setAllOwners(e.target.checked)} /> Use this token for all owners
          </label>
          {error && (
            <p className="modal-error" id="token-prompt-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" className="btn" onClick={cancel}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={busy || !hasValue}>
              {busy ? 'Checking…' : 'Save token'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Renders the oldest pending token request (mounted once, next to the notices). */
export function TokenPromptHost() {
  const request = useTokenPrompt((s) => s.queue[0]);
  return request ? <TokenPrompt key={request.owner + request.ref.number} request={request} /> : null;
}
