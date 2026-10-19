<p align="center"><img src="icons/icon.svg" width="96" height="96" alt=""></p>

<h1 align="center">Glide for GitHub</h1>

A Chrome extension (Manifest V3) that adds a **Glide** tab next to **Files changed** on GitHub pull requests. The tab
shows the same pull request with a fast diff viewer and file tree, powered by
[Pierre](https://diffs.com) ([@pierre/diffs](https://www.npmjs.com/package/@pierre/diffs),
[@pierre/trees](https://www.npmjs.com/package/@pierre/trees)), and keeps the GitHub
review features: comments, suggestions, resolving threads, viewed files and review submission.

![Glide tab with the file tree and diffs](store/screenshots/1-glide-tab.png)

## What it does

- Renders every changed file in one fast, virtualized diff view (split or unified), with a file tree beside it. The
  Glide tab shows the changed-file count, like Files changed.
- A file tree button in the toolbar, like GitHub's, hides or shows the tree. It sits on the tree's side: first in the
  toolbar, or last when the tree is on the right.
- Drag the line between the tree and the diffs to resize the tree, like on GitHub (or use the arrow keys on it). The
  width is remembered; a double-click goes back to the width you use on GitHub.
- Comment on a line, a range of lines (drag over the gutter) or a whole file. The composer has a Write / Preview toggle
  and an "Insert suggestion" button.
- Threads show inline: reply, edit, delete your own comments, resolve and unresolve, react.
- Pending review: the Review button counts your pending comments; submit as Comment, Approve or Request changes, or
  discard the review.
- Apply a suggestion, or a batch of suggestions, as a commit (see the caveat below).
- Viewed checkboxes stay in sync with GitHub's own viewed state, in both directions.
- Commit range picker (all commits, one commit, a range) and hide-whitespace.
- File groups: tabs in the toolbar show one kind of file at a time in the tree and the diffs (see
  [File groups](#file-groups)).
- Related files: a lock file folds under its manifest, and serverless parts under serverless.yml, with one Viewed for
  both (see [Related files](#related-files)).
- When someone pushes to the pull request, a Refresh button appears in the toolbar within seconds, as on GitHub's Files
  changed page. Glide never reloads by itself; Refresh keeps your drafts and open comment boxes.
- Reading needs no token. Posting comments, replies, reviews, edits and reactions needs one (next section). Applying
  suggestions, resolving threads and marking files viewed use your signed-in GitHub session, so they work without a
  token.
- Display options (layout, themes, line wrapping, hunk rows, tree icons and position, fonts, and more) are on the
  options page and in the viewer's Display menu, with a live preview on the options page. Every option starts at
  "Default (GitHub)", which looks like GitHub's own Files changed page (unified, GitHub's colors, fonts and file boxes,
  slim expandable "N unmodified lines" rows instead of `@@` headers, file status icons but no status letters in the
  tree); Pierre's other styles are one choice away. Changes apply to open pull requests without a reload.
- The options page shows Glide's icon and the installed version, which links to that version's release notes.
- Replace Files changed with Glide, off by default, on the options page: GitHub's Files changed tab is hidden, Glide
  takes its place, and links to that page open Glide; the Display menu still links to GitHub's page.
- Experimental, off by default, on the options page only: scroll the diffs with GitHub's page (its header scrolls
  away and the page ends with the diffs, like GitHub's own Files changed page), and fold GitHub's sticky pull request
  header into Glide's toolbar, with the stack button of a stacked pull request (its menu opens the other pull requests
  of the stack in Glide).

## File groups

Tabs in the toolbar, left of the viewed counter, split a pull request by kind of file: **All**, **Source**,
**Tests**, **Docs**, **Infra**, **Manifest** and **Artifacts**, each with its file count. A tab filters the file tree
and the diff list together, and switching is instant: diffs that already loaded stay loaded, collapsed files and
folders stay collapsed, and an open tree search stays open. The open group's diffs load first, then the rest of the
pull request. The viewed counter counts the open group (the whole pull request's count is in its tooltip). Arrow keys,
Home and End move between the tabs.

When the toolbar is too narrow for the tabs, a button showing the open group and its count takes their place and
opens a menu of the groups. Split/Unified, Wrap and Hide whitespace make room for the tabs first, and in the merged
bar the pull request's title does.

- **Smart defaults.** Source is code and business logic only. Lock files, readmes, changelogs and tool config go to
  Manifest; Dockerfiles, Terraform, CDK, serverless and CI config to Infra; `dist/`, minified and generated code and
  archives to Artifacts; test cases, mocks and fixtures to Tests.
- **Your groups.** On the options page, rename, reorder, add or delete groups, each with
  [gitignore-style patterns](https://git-scm.com/docs/gitignore#_pattern_format) (case-insensitive, a later line
  overrides an earlier one, `!Manifest` excludes what the Manifest group holds, a group whose first line is a `!`
  starts from every file). A "Try a path" box shows where a path lands.
- **Where a pull request opens.** All by default, or any group. The group you pick on a pull request is remembered
  for it across reloads. Groups with no files are hidden (an option). Turn the tabs off, and Glide shows every file
  as before.

The groups, their patterns and the pattern engine come from [Sift for GitHub](https://github.com/dangh/sift-for-github),
which adds the same tabs to GitHub's own Files changed page. Already use Sift? The options page imports its tabs, the
tab it opens pull requests on and its hide-empty switch. Unlike Sift, which opens on Source, Glide opens on All until
you pick another group there.

## Related files

Some files are best read together: `package-lock.json` with `package.json`, `serverless-resources.yml` with
`serverless.yml`. Glide shows such a related file with its main file, so skimming a pull request costs one stop, not
two.

- **Nested** (default). The related file folds into one line at the bottom of its main file's box: its name, a "lock
  file" tag for lock files, its counts and its comment count. Click the line to open its diff, where comments,
  suggestions and expanders work as in any file. One Viewed covers the main file and its related files; it marks each
  of them viewed on GitHub, and shows checked only when all are viewed. The viewed counter still counts files.
- **One box.** The files share one box under a "package.json + 1 related" header with their summed counts, each file
  with its own small header and full diff.
- **Group rail.** The files keep their own boxes under a "package.json · 2 files" line with a "Viewed all" checkbox, tied
  by a rail.
- **Off.** Every file on its own, in GitHub's order.

Pick the look in the Display menu or on the options page, which shows a preview of each. In the file tree a related
file sits right after its main file, indented and dimmed; clicking it opens it. With file groups, files are related
only when both are in the open group; otherwise each shows on its own, as does a related file whose main file the pull
request doesn't change.

**Rules.** On the options page, each rule is a main file pattern and its related files, one per line, as file names in
the same folder: `*` and `?` match characters, `${basename}` is the main file's name without its extension. Add,
delete, reorder, reset to the defaults, and try paths to see what relates. The defaults cover npm, Yarn, pnpm and Bun,
Deno, Cargo, Poetry, uv, PDM, Pipenv, pip-tools, pixi, Bundler, Go modules and workspaces, Composer, Pub, CocoaPods,
SwiftPM, Nix flakes, Mix, Helm, Gradle, NuGet and Serverless.

## Install

[Add to Chrome from the Chrome Web Store](https://chromewebstore.google.com/detail/dhbdoblfgppilljakljokgbpkjeiomka).

Or install it by hand:

**From a release (unpacked):** download `glide-for-github.zip` from the
[latest release](https://github.com/dangh/glide-for-github/releases/latest), unzip it into a folder, open
`chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the folder.

**From source:**

1. Build it: `npm install && npm run build`. This writes the extension to `dist/`.
   (Or run `npm run zip` and unzip `glide-for-github.zip` into a folder of your own.)
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and choose the `dist/` folder (or the unzipped folder).
4. Open any pull request on github.com. The **Glide** tab appears after **Files changed**. (Links ending in `#glide`
   open it directly; `#pierre` links from before the rename still work.)

Requires Node 22.13 or newer on the 22 line, Node 24, or Node 26 and newer (what vitest 5 and jsdom support), and a
Chromium-based browser that supports Manifest V3.

## Token setup

Reading a pull request works without a token, and so do applying suggestions, resolving threads and marking files viewed
(they use your signed-in GitHub session). To post comments, replies, reviews, edits or reactions, Glide asks for a
GitHub token the first time you need one. You can also add and remove tokens on the options page (right-click the
extension icon, then **Options**).

- **Fine-grained token (recommended).** Create it for the account or organization that owns the repositories, with
  **Pull requests: Read and write** and **Contents: Read**. The prompt links to GitHub's token page with these
  permissions filled in. A fine-grained token covers one owner, so add one per owner you review for.
- **Classic token.** Needs the `repo` scope (or `public_repo`, which works for public repositories only). One classic
  token can serve every owner ("Use this token for all owners").
- If your organization uses SAML SSO, authorize the token for it after creating it.
- Resolving threads and marking files viewed: with a token stored, Glide uses GitHub's GraphQL API first, which some
  fine-grained tokens cannot call. If no token is stored, or GitHub refuses it for that action, Glide uses your
  signed-in GitHub session instead. It asks for a token only if the session is refused as well.

## Privacy

- The extension only talks to GitHub: `github.com`, `api.github.com`, GitHub's image servers (for avatars and
  images in comments) and `raw.githubusercontent.com` (GitHub's file-content host, reached by redirect from github.com,
  used to expand unchanged context). The Preview tab of the comment box posts your draft text to github.com's `/preview`
  so GitHub can render it. No third parties; it has no server of its own, no analytics and loads no remote code.
- Your token is stored in `chrome.storage.local`, on this device only, with the GitHub username it belongs to. It is
  sent only to `api.github.com`, only from the extension's own pages, never to the github.com page, and the options
  page never displays it.
- Settings, file groups and related-files rules are stored in `chrome.storage.sync` (each file group is its own item),
  so Chrome can sync them between your signed-in browsers. They contain no tokens and no pull request data.
- The Sift import only parses the text you paste; Glide reads nothing from Sift. The full list of what Glide stores,
  including what it keeps in the tab's `sessionStorage`, is in the [privacy policy](store/PRIVACY.md).

## Private GitHub endpoints: please read

GitHub offers no public API for applying a suggestion, so **Apply suggestion** (single or batch) calls the same
**private endpoint GitHub's own page uses** (`page_data/apply_review_suggestions`), through your signed-in GitHub
session, not your token. The session fallback for **resolving threads** (`page_data/resolve_thread`,
`unresolve_thread`) and **marking files viewed** (`file_review`) uses private endpoints in the same way.

These can break without notice if GitHub changes them. When one fails, Glide says so and you can do the action on
GitHub instead. Comments, replies, reviews, edits and reactions use GitHub's documented REST and GraphQL APIs with your
token, and so do resolve and viewed whenever the token is allowed to.

## Performance

Measured on 0.1.0 (build `0b752fe`, 2026-10-17; the same extension code is `8647784` in this repository's history)
with `npm run perf` (see `PERF.md` for the method, every run and the raw spread): Chrome for Testing 155, headed,
logged in, median of 3 runs. Later versions have not been re-measured.

| Metric | Result | Budget |
| --- | --- | --- |
| react/react#37778 (167 files), whole PR loaded | 4.80 s (worst run 5.36 s) | 6.5 s |
| microsoft/vscode#151512 (898 files), whole PR loaded | 10.51 s (worst run 10.84 s) | 22 s |
| Scrolling the 898-file PR top to bottom at 3,000 px/s | no long task; longest frame 27 ms | no task over 50 ms |
| Typing in a comment box on the 898-file PR, p95 keystroke to next frame | 12.6 ms | under 16 ms |

Load time depends on GitHub's server response times and varies with the time of day.

## Development

```
npm install
npm run build        # dist/
npm test             # unit tests (vitest)
npm run typecheck
npm run zip          # build and write glide-for-github.zip
npm run e2e          # headed Playwright tests against real GitHub, see playwright.config.ts for setup
npm run e2e:headless # the same tests, headless
npm run e2e:token    # once: save a GitHub token in the e2e profile for the write tests
npm run perf         # performance budget, see PERF.md
```

The end-to-end tests need the logged-in browser profile described in `playwright.config.ts`.

CI (`.github/workflows/build.yml`) type-checks, tests and zips every push and pull request. A `v*` tag that matches
`manifest.json`'s version also creates a GitHub release, with that version's section of [CHANGELOG.md](CHANGELOG.md)
as its notes. Then, when the store secrets are set, the publish job waits for an approval in the `chrome-web-store`
environment and uploads the zip to the Chrome Web Store, submitting it for review. See
[store/README.md](store/README.md) for the store listing and release steps.

## Credits and license

Glide's diff viewer and file tree are Pierre's: [@pierre/diffs](https://www.npmjs.com/package/@pierre/diffs) and
[@pierre/trees](https://www.npmjs.com/package/@pierre/trees), both Apache-2.0. Their licenses and those of the other
bundled packages ship in the extension as `THIRD_PARTY_NOTICES.txt`. Glide is not affiliated with Pierre or GitHub.

File groups are ported from [Sift for GitHub](https://github.com/dangh/sift-for-github) (MIT, same author): its default
tabs, gitignore-style patterns and classifier.

Glide's own code is released under the [MIT license](LICENSE). Privacy policy: [store/PRIVACY.md](store/PRIVACY.md).
