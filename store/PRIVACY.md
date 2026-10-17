# Glide for GitHub privacy policy

Glide for GitHub does not collect, sell or share any personal data. It has no server of its own, no analytics and no
tracking, and it talks to no third party.

**What it reads.** On GitHub pull request pages (`https://github.com/*`) it reads the pull request's files, diffs,
comments and review threads, in your browser, to show them in the Glide tab. It does this with GitHub's pages and
endpoints, using your existing GitHub session, and with the GitHub API when you have given it a token. Avatars and
images in comments load from GitHub's own image servers. To expand unchanged context it reads file contents from
github.com, which redirects to `raw.githubusercontent.com`, GitHub's file-content host.

**What it stores.**
- A GitHub personal access token, only if you add one (to post comments, replies, reviews, edits and reactions). It is
  kept in `chrome.storage.local`, on your device only, never synced, together with the GitHub username the token
  belongs to (shown in the options page) and the owner it is for. The options page lists tokens by owner and
  never shows their values; you can remove them there at any time.
- Your display settings (layout, themes and so on) in `chrome.storage.sync`, which Chrome may sync between your
  signed-in browsers. They contain no tokens and no pull request data.
- Unsent comment drafts and a pending suggestion batch, in the browser tab's `sessionStorage`. They are discarded
  when the tab closes.

**What it sends, and where.** Only to GitHub:
- `github.com`: requests with your signed-in session for the pull request you are viewing, including file contents
  (which GitHub serves through `raw.githubusercontent.com` by redirect). This includes GitHub's
  private same-session endpoints, which Glide uses to apply suggestions and, when you have no token or GitHub refuses
  it, to resolve and unresolve threads and to mark files viewed.
- `api.github.com`: your token is sent here, and only here, from the extension's own pages, never to the github.com
  page. It is used to post comments, replies, reviews, edits and reactions, and to resolve threads and mark files viewed.

- Your draft comment text, when you use the Write / Preview toggle: the Preview tab posts the draft to `github.com`
  (its `/preview` endpoint) so GitHub renders it. This is not a comment; nothing is posted until you submit one.

**Who gets this data.** The data above (your token, your GitHub username, pull request content and your drafts) stays
on your device or goes only to GitHub, and only because you asked for the action that needs it. Nothing is sent to the
developer or to any other third party.

**Remote code.** None. All code ships inside the extension package.

**Open source.** The source is at https://github.com/dangh/glide-for-github, so you can check all of the above.

**Contact.** Open an issue at https://github.com/dangh/glide-for-github/issues.
