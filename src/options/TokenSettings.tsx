/**
 * Options page: saved GitHub tokens. Lists owner, login and kind (never the token itself), removes tokens after
 * a confirmation, and adds one through TokenPrompt in standalone mode. Follows changes made elsewhere (the viewer
 * saving a token from its own prompt) through `chrome.storage.onChanged`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_OWNER_KEY, TOKENS_STORAGE_KEY, listTokens, removeToken, type TokenInfo } from '../viewer/auth/tokens';
import { TokenPrompt, type StandaloneTokenPrompt } from '../viewer/ui/TokenPrompt';

function useTokens(): [TokenInfo[] | null, () => void] {
  const [tokens, setTokens] = useState<TokenInfo[] | null>(null);
  const refresh = useCallback(() => {
    listTokens().then(setTokens, () => setTokens([]));
  }, []);
  useEffect(() => {
    refresh();
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && TOKENS_STORAGE_KEY in changes) refresh();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [refresh]);
  return [tokens, refresh];
}

function TokenRow({ token, onRemoved }: { token: TokenInfo; onRemoved(): void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const all = token.owner === DEFAULT_OWNER_KEY;
  const remove = async () => {
    setBusy(true);
    try {
      await removeToken(token.owner);
    } finally {
      setBusy(false);
      setConfirming(false);
      onRemoved();
    }
  };
  return (
    <li className="token-row" data-testid="token-row" data-owner={token.owner}>
      <span className="token-owner">
        <code>{token.owner}</code>
        {all && <span className="token-note"> all owners without their own token</span>}
      </span>
      <span className="token-login">{token.login || 'unknown account'}</span>
      <span className="token-kind">{token.kind}</span>
      <span className="token-actions">
        {confirming ? (
          <>
            <button type="button" className="btn-danger" disabled={busy} onClick={remove}>
              Confirm remove
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <button type="button" className="btn" aria-label={`Remove token for ${token.owner}`} onClick={() => setConfirming(true)}>
            Remove
          </button>
        )}
      </span>
    </li>
  );
}

export function TokenSettings() {
  const [tokens, refresh] = useTokens();
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const standalone = useMemo<StandaloneTokenPrompt>(
    () => ({
      onSaved: (owner) => {
        setAdding(false);
        setNotice(`Saved a token for ${owner === DEFAULT_OWNER_KEY ? 'all owners' : owner}.`);
        refresh();
      },
      onCancel: () => setAdding(false),
    }),
    [refresh],
  );

  return (
    <section className="options-section" aria-labelledby="tokens-heading">
      <h2 id="tokens-heading">GitHub tokens</h2>
      <p className="muted">
        Tokens stay in this browser (extension local storage) and are only sent to api.github.com. They are never shown here.
      </p>
      {tokens === null ? null : tokens.length === 0 ? (
        <p className="muted" data-testid="no-tokens">
          No tokens saved.
        </p>
      ) : (
        <ul className="token-list">
          {tokens.map((t) => (
            <TokenRow key={t.owner} token={t} onRemoved={refresh} />
          ))}
        </ul>
      )}
      <div className="options-actions">
        <button type="button" className="btn-primary" onClick={() => (setNotice(null), setAdding(true))}>
          Add token
        </button>
        {notice && (
          <span className="muted" role="status">
            {notice}
          </span>
        )}
      </div>
      {adding && <TokenPrompt standalone={standalone} />}
    </section>
  );
}
