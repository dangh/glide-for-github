/**
 * Token gate for every token write (Task 8 replaces this body with the TokenPrompt flow:
 * `requireToken(owner, reason?): Promise<GithubApi>` resolving after the user saved a token).
 *
 * Stub for Task 7: there is no token support yet, so it always rejects with a `WriteError`-like
 * `{kind: 'no-token'}`. Callers must already handle that rejection (show a notice, revert optimistic UI).
 */
export interface NoTokenError extends Error {
  kind: 'no-token';
  owner: string;
}

export function isNoTokenError(err: unknown): err is NoTokenError {
  return typeof err === 'object' && err !== null && (err as { kind?: unknown }).kind === 'no-token';
}

export async function requireToken(owner: string, reason?: string): Promise<never> {
  const err = new Error(
    `A GitHub token for ${owner} is needed${reason ? ` to ${reason}` : ''}. Token setup is not available yet.`,
  ) as NoTokenError;
  err.name = 'WriteError';
  err.kind = 'no-token';
  err.owner = owner;
  throw err;
}
