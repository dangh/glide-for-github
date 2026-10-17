/**
 * The single source of user-visible brand strings. TS/TSX code imports BRAND directly. Static files take it at
 * build time: build.mjs writes dist/manifest.json (`name`, `description`) and replaces `%BRAND_NAME%` in the
 * HTML pages from it, and scripts/zip.mjs names the zip after `slug`. To rename the product, change this file
 * (plus README.md and package.json's `name`, which are manual).
 */
export const BRAND = {
  /** Full product name, as in the Chrome Web Store, the manifest and page titles. */
  name: 'Glide for GitHub',
  /** Short name used in prose and on the PR tab ("Glide needs a GitHub token"). */
  short: 'Glide',
  /** File-name form of the name (zip file). */
  slug: 'glide-for-github',
  /** Manifest description (Chrome Web Store limit: 132 characters). */
  description: 'Adds a Glide tab to GitHub pull requests: fast diffs, a file tree and review tools, powered by Pierre (@pierre/diffs).',
} as const;
