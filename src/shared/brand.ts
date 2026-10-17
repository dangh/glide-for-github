/**
 * User-visible brand strings, in one place. Used by the options page and by the token links. (The manifest
 * `name`, the viewer's <title> and the token prompt's wording live in static files and prompts; keep them in step.)
 */
export const BRAND = {
  /** Full product name, as in the Chrome Web Store and the manifest. */
  name: 'Pierre for GitHub',
  /** Short name used in prose ("Pierre needs a GitHub token"). */
  short: 'Pierre',
} as const;
