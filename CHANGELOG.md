# Changelog

Newest first. Each release's GitHub notes are its section here (`scripts/release-notes.sh`).

## Unreleased

### New

- **Related files.** A lock file shows with its manifest, and serverless parts with serverless.yml, so they read as one
  change. By default each related file folds into one line at the bottom of its main file's box, with a "lock file" tag,
  its counts and its comments; click it to open its diff. One Viewed covers the main file and its related files, and
  marks each of them viewed on GitHub. In the tree, a related file sits right under its main file, indented. Pick
  another look in the Display menu or on the options page (one box, a group rail, or off), and edit the rules there:
  a main file pattern and its related files, in the same folder, with `${basename}` for the main file's name.

## 0.3.1 (2026-10-19)

### Fixes

- The "Scroll with the page" option no longer says GitHub's footer is reachable: the page ends with the diffs, like
  GitHub's own Files changed page.
- The options page's version link now opens real release notes.

## 0.3.0 (2026-10-19)

### New

- **File groups.** Tabs in the toolbar split a pull request by kind of file: All, Source, Tests, Docs, Infra, Manifest
  and Artifacts, each with its file count. A tab filters the file tree and the diffs together, and switching is
  instant: loaded diffs, collapsed folders and an open tree search all stay. The open group's diffs load first, and the
  viewed counter counts the open group. When the toolbar is too narrow, the tabs fold into a menu.
- **Your own groups.** On the options page, rename, reorder, add or delete groups, each with gitignore-style patterns,
  and try a path to see where it lands. Pick the group pull requests open on and whether empty groups hide. The group
  you pick on a pull request is remembered across reloads.
- **Import from Sift for GitHub.** Paste Sift's settings to bring over its tabs, the tab it opens on and its hide-empty
  switch.
- **File tree button.** A toolbar button, like GitHub's, hides or shows the tree. With the tree on the right, the button
  moves to the end of the toolbar.
- **Options page header.** It shows Glide's icon and the installed version, which links to that version's release
  notes.
- **Narrow windows.** A narrow toolbar drops controls the way GitHub's does instead of cutting them off.
- **Page scrolling (experimental).** The page now ends with the diffs, like GitHub's own Files changed page. The merged
  bar reads like GitHub's sticky Files changed bar, shows the stack button of a stacked pull request, and its title
  takes you back to the top.

### Fixes

- Copy path and copy branch name now copy; before, they silently copied nothing.
- The Review button reads "Submit comments" on closed pull requests, as on GitHub.
- No error when Glide is reloaded or updated under an open page; it asks you to reload the page instead.
- The toolbar and gutters switch at GitHub's own window widths.
- A tree on the right gets the right spacing, and the diffs line up with the toolbar.
- Page scrolling: quick flicks at the top or the end of the diffs no longer jump back.

## 0.2.1 (2026-10-19)

### New

- **Replace Files changed with Glide** (option, off by default). GitHub's Files changed tab is hidden, Glide takes its
  place, and links to that page open Glide. The Display menu still links to GitHub's page.
- **Page scrolling (experimental, off by default).** Scroll the diffs with GitHub's page, and optionally fold GitHub's
  sticky pull request header into Glide's toolbar, which then shows the pull request's state, title and number.

### Fixes

- Page scrolling no longer scrolls GitHub's page twice or jumps back from its end, and measures GitHub's header less
  often.

## 0.2.0 (2026-10-19)

The first version on the Chrome Web Store.

### New

- **Looks like GitHub by default.** Every display option has a "Default (GitHub)" value: GitHub's colors, fonts, file
  boxes, gutter and line numbers, and slim "N unmodified lines" rows instead of `@@` headers. Pierre's other styles are
  one setting away.
- **Tree options.** Put the tree on the left or the right, and show git status letters in it if you like.
- **File count on the Glide tab**, like Files changed.
- A new icon.

### Fixes

- The viewer uses the full width of GitHub's Files changed page.
- Glide's menus close when you click the GitHub page around them.
- Toolbar, threads, composer and menus match GitHub's sizes.

## 0.1.0 (2026-10-17)

The first release.

- A **Glide** tab next to Files changed on GitHub pull requests, with Pierre's fast, virtualized diffs (split or
  unified) and a file tree.
- Comment on a line, a range of lines or a whole file, with Write / Preview and Insert suggestion.
- Inline threads: reply, edit, delete your own comments, resolve and unresolve, react.
- Pending reviews: submit as Comment, Approve or Request changes, or discard.
- Apply a suggestion, or a batch of suggestions, as a commit.
- Viewed checkboxes in sync with GitHub, both ways.
- Commit range picker and hide whitespace.
- A "This pull request was updated" banner with Reload, which keeps your drafts.
- Display options in the viewer and on the options page, with a live preview.
- Reading needs no token. Posting needs a GitHub token, which stays on your device and is only sent to api.github.com.
