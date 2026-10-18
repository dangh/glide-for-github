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
> - Optionally, Glide replaces GitHub's Files changed tab and opens wherever that page would.
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
- `storage`: saves the user's display settings (`chrome.storage.sync`) and, if the user adds one, their GitHub token and
  the username it belongs to (`chrome.storage.local`, never synced).
- Host permission `https://github.com/*`: content scripts on pull request pages add the Glide tab and mount the
  viewer, and the extension makes same-origin requests with the user's own GitHub session to read the pull request's
  diffs and threads and to apply suggestions, resolve threads and mark files viewed. It also posts the draft text of
  the comment box's Preview tab to github.com's `/preview`, and reads file contents to expand context from github.com,
  which redirects to `raw.githubusercontent.com` (GitHub's file-content host; reached by redirect, not a separate host
  permission). It runs on no other site.
- Host permission `https://api.github.com/*`: sends the user's token to GitHub's API to post comments, replies,
  reviews, edits and reactions, and to resolve threads and mark files viewed. Nothing else is sent there.

**Remote code:** No. All code ships in the package.

**Data usage:** tick **Authentication information** (the GitHub token the user may add, with the GitHub username it
belongs to, stored in `chrome.storage.local`) and **Website content** (pull request files, diffs and comments read from
github.com, and the draft text sent to its `/preview`). Leave the other types unticked. Everything stays on the device or
goes only to GitHub at the user's direction; nothing goes to the developer or any third party, and there is no analytics.
Settings sync through the user's Chrome account. Tick all three certifications (no sale or transfer to third parties
outside the approved use cases, no use unrelated to the single purpose, no use for creditworthiness or lending).

**Privacy policy URL:** https://github.com/dangh/glide-for-github/blob/main/store/PRIVACY.md

## First submission checklist

The first upload is manual (the store API can only update an item that exists). Version 0.2.0 is the first one submitted.

1. Push the `v0.2.0` tag. CI builds, creates the GitHub release with `glide-for-github.zip`, and skips the store
   upload (no secrets yet; the job says so in a notice).
2. [Developer dashboard](https://chrome.google.com/webstore/devconsole) > **Add new item** > upload
   `glide-for-github.zip` from the v0.2.0 GitHub release.
3. **Store listing** tab: fill name, summary, description, category and language from the Listing section above; upload
   the icon, the four screenshots and the small and marquee tiles from the Assets table.
4. **Privacy** tab: single purpose, the three permission justifications, remote code "No", data usage, and the privacy
   policy URL above.
5. **Submit for review.**
6. Copy the item's ID from the dashboard (the 32-letter ID in the item's URL) and set the five environment secrets
   (next section; protect the environment first). From the next tag on, CI uploads and publishes by itself.
7. Add the store link to the README's Install section. Also upload `promo/social-preview.png` in the GitHub repository's
   Settings > Social preview.

## Automatic publishing

CI uploads and publishes every `v*` tag when all five secrets exist. The publish job runs in the `chrome-web-store`
GitHub environment, so the secrets belong there, not at repository level.

**Before adding any secret**, create the environment and protect it: Settings > Environments > New environment, name
`chrome-web-store`, turn on **Required reviewers** and add yourself (and any co-maintainer), and under **Deployment
branches and tags** limit it to `v*` tags. Without reviewers, anyone who can push a tag can publish to the store with
your credentials; with them, the job waits for an approval. Then add the five secrets as **environment secrets** of
`chrome-web-store` (Environment secrets > Add environment secret). Without the secrets the publish job is skipped with
a notice, and the release still gets the zip.

The upload tool (`chrome-webstore-upload-cli`) is an exact-version devDependency in `package.json` and
`package-lock.json`, and every action in the workflow is pinned to a commit SHA, so the job runs nothing that was not
reviewed in the repository. Update them deliberately (Dependabot can propose both).

| Secret | Where it comes from |
|---|---|
| `CWS_EXTENSION_ID` | The item's ID in the developer dashboard. This is the only new value: it exists once the first manual upload does. |
| `CWS_CLIENT_ID` | An OAuth client (type Desktop app) in a Google Cloud project with the Chrome Web Store API enabled and the consent screen in production. An existing client for the same publisher account can be reused. |
| `CWS_CLIENT_SECRET` | The same OAuth client |
| `CWS_REFRESH_TOKEN` | A refresh token for the publisher account, generated for that client; see the [chrome-webstore-upload keys guide](https://github.com/fregante/chrome-webstore-upload-keys). It belongs to the account, not to one extension, so an existing token for the same publisher works for this item too. |
| `CWS_PUBLISHER_ID` | Chrome Web Store developer dashboard > Account > Publisher ID. It belongs to the publisher account, so it is the same for every item that account owns. |

If the same publisher account already publishes another extension from CI, reuse its client ID, client secret, refresh
token and publisher ID, and add only the new `CWS_EXTENSION_ID`. Treat all five as sensitive: anyone holding the client
secret or refresh token can publish a new version of the extension.

Each release: bump `version` in `manifest.json` (and `package.json`), commit, tag `vX.Y.Z` with the same number and
push the tag. CI fails the build if the tag and the manifest version differ.
