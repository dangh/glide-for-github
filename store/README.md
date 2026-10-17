# Chrome Web Store

Everything needed to list and publish Glide for GitHub. Icons and promo tiles are regenerated with
`store/render.sh` (headless Chrome, from `icons/icon.svg`, `icons/icon-16.svg` and `store/promo/tile.html`).

## Assets

| File | Store field | Size |
|---|---|---|
| `../icons/icon128.png` | Store icon | 128x128 (96x96 artwork, 16 px padding) |
| `screenshots/1-glide-tab.png` | Screenshot | 1280x800 |
| `screenshots/2-inline-thread.png` | Screenshot | 1280x800 |
| `screenshots/3-display-menu.png` | Screenshot | 1280x800 |
| `screenshots/4-options.png` | Screenshot | 1280x800 |
| `promo/small-tile.png` | Small promo tile | 440x280 |
| `promo/marquee.png` | Marquee promo tile | 1400x560 |
| `promo/social-preview.png` | GitHub repo social preview (Settings > Social preview) | 1280x640 |

Screenshots are taken by `scripts/store-screenshots.mjs` (headed, on the logged-in e2e profile) from a public PR
(react/react#37778), with avatars hidden; the script refuses to write one if the signed-in login or a token-looking
string is visible. The inline thread screenshot shows a comment composer with a draft typed in and then cancelled:
nothing was posted. The options screenshot omits the saved-token list.

## Listing

**Name:** Glide for GitHub

**Summary** (132 characters max):
Review GitHub pull requests with fast diffs and a file tree, next to Files changed. Powered by Pierre.

**Category:** Developer Tools. **Language:** English.

**Description:**

> Glide adds a Glide tab next to Files changed on GitHub pull requests. It shows the same pull request with a fast,
> virtualized diff viewer and a file tree, powered by Pierre (@pierre/diffs and @pierre/trees), and keeps the GitHub
> review features you use.
>
> - Every changed file in one smooth diff view, split or unified, with a file tree beside it. Big pull requests stay
>   responsive.
> - Comment on a line, a range of lines or a whole file. Write and Preview, and an Insert suggestion button.
> - Threads inline: reply, edit, delete your own comments, resolve and unresolve, react.
> - Pending review: submit as Comment, Approve or Request changes, or discard it.
> - Apply a suggestion, or a batch of suggestions, as a commit.
> - Viewed checkboxes stay in sync with GitHub, both ways.
> - Commit range picker and hide whitespace.
> - Display options (layout, themes, line wrapping, tree density and more) in the viewer and on the options page.
>
> Reading a pull request needs no setup. To post comments, replies, reviews or reactions, Glide asks for a GitHub
> token (fine-grained or classic), which stays on your device and is only ever sent to api.github.com.
>
> Glide uses GitHub's own page endpoints, with your signed-in session, to apply suggestions and as a fallback to
> resolve threads and mark files viewed. GitHub does not document these, so they can change without notice; when one
> fails, Glide says so and you can do the action on GitHub instead.
>
> No analytics, no tracking, no third parties. Open source (MIT): https://github.com/dangh/glide-for-github
> Not affiliated with GitHub or Pierre.

## Privacy tab

**Single purpose:** Show a GitHub pull request's changes in a faster diff and file-tree viewer, with GitHub's review
features, in a tab next to Files changed.

**Permission justifications:**
- `storage`: saves the user's display settings (`chrome.storage.sync`) and, if the user adds one, their GitHub token
  (`chrome.storage.local`, never synced).
- Host permission `https://github.com/*`: content scripts on pull request pages add the Glide tab and mount the
  viewer, and the extension makes same-origin requests with the user's own GitHub session to read the pull request's
  diffs and threads and to apply suggestions, resolve threads and mark files viewed. It runs on no other site.
- Host permission `https://api.github.com/*`: sends the user's token to GitHub's API to post comments, replies,
  reviews, edits and reactions, and to resolve threads and mark files viewed. Nothing else is sent there.

**Remote code:** No. All code ships in the package.

**Data usage:** Collects no user data. The token is stored locally and sent only to api.github.com; settings sync
through the user's Chrome account. No analytics, no third parties, no sale or transfer of data (check the
"does not sell / does not use for unrelated purposes / does not use for creditworthiness" certifications).

**Privacy policy URL:** https://github.com/dangh/glide-for-github/blob/main/store/PRIVACY.md

## First submission checklist

The first upload is manual (the store API can only update an item that exists). Version 0.1.0 is not submitted yet.

1. Push the `v0.1.0` tag. CI builds, creates the GitHub release with `glide-for-github.zip`, and skips the store
   upload (no secrets yet; the job says so in a notice).
2. [Developer dashboard](https://chrome.google.com/webstore/devconsole) > **Add new item** > upload
   `glide-for-github.zip` from the v0.1.0 GitHub release.
3. **Store listing** tab: fill name, summary, description, category and language from the Listing section above; upload
   the icon, the four screenshots and the small and marquee tiles from the Assets table.
4. **Privacy** tab: single purpose, the three permission justifications, remote code "No", data usage, and the privacy
   policy URL above.
5. **Submit for review.**
6. Copy the item's ID from the dashboard (the 32-letter ID in the item's URL) and set the four repository secrets
   (next section). From the next tag on, CI uploads and publishes by itself.
7. Add the store link to the README's Install section. Also upload `promo/social-preview.png` in the GitHub repository's
   Settings > Social preview.

## Automatic publishing

CI uploads and publishes every `v*` tag when all four repository secrets exist (Settings > Secrets and variables >
Actions). Without them the publish job is skipped with a notice, and the release still gets the zip.

| Secret | Where it comes from |
|---|---|
| `CWS_EXTENSION_ID` | The item's ID in the developer dashboard. This is the only new value: it exists once the first manual upload does. |
| `CWS_CLIENT_ID` | Reuse the OAuth client "sift-ci-publish" (Desktop app) in Google Cloud project `sift-for-github-publish` (Chrome Web Store API enabled, consent screen in production), the one Sift for GitHub publishes with |
| `CWS_CLIENT_SECRET` | The same OAuth client |
| `CWS_REFRESH_TOKEN` | The same refresh token Sift uses. It belongs to the publisher account, not to one extension, so it can update any item that account owns, Glide included. Generate a new one only if that token was revoked; see the [chrome-webstore-upload keys guide](https://github.com/fregante/chrome-webstore-upload-keys) |

Glide is published from the same publisher account as Sift, so nothing new is needed in Google Cloud: copy the same
client ID, client secret and refresh token from Sift's repository secrets into Glide's, and add the new
`CWS_EXTENSION_ID`. Treat all four as credentials: anyone holding them can publish a new version of the extension.

Each release: bump `version` in `manifest.json` (and `package.json`), commit, tag `vX.Y.Z` with the same number and
push the tag. CI fails the build if the tag and the manifest version differ.
