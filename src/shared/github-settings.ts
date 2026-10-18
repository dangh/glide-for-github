/**
 * The `github` section of the stored settings item: how Glide fits into GitHub's pull request page. Like
 * ./experiments.ts, the content script reads only this section, so it does not bundle the display schema.
 */

/** Options page only (not in the viewer's Display menu). */
export interface GithubSettings {
  /** Hide GitHub's Files changed tab and open Glide instead of its page (src/content/lifecycle.ts). */
  replaceFilesTab: boolean;
}

/** The `github` section of a stored settings item: anything but `true` is off, the default. */
export function githubSettingsOf(item: unknown): GithubSettings {
  const raw = (item as { github?: Partial<Record<keyof GithubSettings, unknown>> } | null | undefined)?.github;
  return { replaceFilesTab: raw?.replaceFilesTab === true };
}
