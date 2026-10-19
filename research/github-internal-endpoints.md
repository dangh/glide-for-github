# GitHub "Files changed" (React `/pull/N/changes`) — private endpoint reference

Research date: 2026-10-17 (SGT). GitHub client release seen: `meta[name=release]` = `3bcf25cf…` (deploy-specific).
Test PRs: `react/react#37778` (167 files, 1 file-level thread), `react/react#36921` (51 files, 6 line threads incl. outdated/resolved).

Confidence labels:
- **VERIFIED-STATIC**: read in GitHub's shipped JS. GitHub serves **public source maps with full original TypeScript** (`//# sourceMappingURL=<chunk>-<hash>.js.map` on `github.githubassets.com/assets/`), so most items below come from readable source (`packages/pull-requests/**`, `packages/diff-lines/**`, `packages/verified-fetch/**`, `packages/comment-box/**`, `packages/fetch-graphql/**`).
- **VERIFIED-LIVE-GET**: actually requested (read-only GET) from the logged-in session, with the response inspected.
- **VERIFIED-CAPTURED**: triggered through the real UI with a fetch/XHR/form/beacon blocker installed and self-tested. The request was recorded and **never sent**. The server-side state was re-checked afterwards: nothing changed.
- **UNKNOWN**: not observable without sending a write.

No cookies, nonces or tokens are reproduced here. `<NONCE>` and similar are placeholders.

---

## 0. Transport, headers, and auth (applies to everything)

### 0.1 `verifiedFetch` (all React PR-page requests) — VERIFIED-STATIC + VERIFIED-CAPTURED
Source: `packages/verified-fetch/verified-fetch.ts`, `packages/fetch-headers`, `packages/fetch-nonce`, `packages/client-version`.

Headers GitHub's own client sends (captured on real writes):

| Header | Value / source |
|---|---|
| `GitHub-Verified-Fetch` | `true` (the CSRF replacement for page_data and other "allow_verified_fetch" controller actions) |
| `X-Requested-With` | `XMLHttpRequest` |
| `X-Fetch-Nonce` | `document.querySelector('meta[name="fetch-nonce"]').content`. GitHub's fetch override also collects newer values from the `X-Fetch-Nonce` **response** header. |
| `X-GitHub-Client-Version` | `document.querySelector('meta[name="release"]').content` |
| `GitHub-Is-React` | `true` (added by `reactFetch` / `reactFetchJSON`; used for metrics) |
| `Accept` | `application/json` (JSON variants) |
| `Content-Type` | `application/json` (JSON variants; the body is `JSON.stringify`ed) |
| `x-github-ui-experience` | optional; not used by the PR mutations |

- Credentials come from the same-origin session cookies. **No `authenticity_token` is sent in any page_data, `file_review` or `/preview` request.** Requests must be same-origin (`verifiedFetch` throws on cross-origin URLs).
- Query params `_features` and `_tracing` are copied from the page URL if present. You can ignore them.
- **Minimum for GETs (VERIFIED-LIVE-GET):** `page_data/*` and the route JSON return **406** without `X-Requested-With: XMLHttpRequest`. They return 200 with only `Accept: application/json` plus `X-Requested-With`. `GitHub-Verified-Fetch` alone gives 406.
- **Minimum for writes: UNKNOWN.** Send the full header set above. Re-read the nonce from the meta tag (or from the last response's `X-Fetch-Nonce`) before each write.

### 0.2 Base path
`basePath` = `pullRequest.pathName` from the embedded data, e.g. `/react/react/pull/37778`. Every page_data URL is `${basePath}/page_data/<name>`.

### 0.3 Error handling — VERIFIED-STATIC
Source: `pull-request-page-data-tooling/utils/fetch-error-handling.ts`.
- Non-2xx responses carry JSON `{error: "..."}`.
- 5xx responses may be HTML.
- Edit endpoints may return `{stale: true, ...fresh data}` on a body-version conflict.
- Apply-suggestion endpoints may return `{code: "HEAD_OID_MISMATCH"}` (409).

### 0.4 Extension note (assumption, not verified)
A content script `fetch` to `https://github.com/...` is same-origin with the page, but Chrome sets some request properties (Origin, Sec-Fetch-*) from the extension context. Running the calls in the page's MAIN world (`chrome.scripting.executeScript({world:'MAIN'})` or an injected `<script>`) reproduces GitHub's own requests exactly and is the safer option.

---

## 1. Reading: PR metadata, file list, diffs

### 1.1 Embedded route data — VERIFIED-LIVE-GET
- `script[data-target="react-app.embeddedData"]` → `JSON.parse(...).payload.pullRequestsChangesRoute`.
- The **same JSON** is returned by `GET /o/r/pull/N/changes` with `Accept: application/json` and `X-Requested-With: XMLHttpRequest`. The response is `{meta:{title}, payload:{pullRequestsChangesRoute}}`, about 75 KB for 167 files.
- Range variant route: `/o/r/pull/N/changes/:range`.

Top-level fields of `pullRequestsChangesRoute`:

**Fields that are ready to use as-is**
- `pullRequest`: `{id (database id), globalRelayId ("PR_kw…" node id), number, pathName, state, title, titleHtml, baseBranch, headBranch, headRepositoryOwnerLogin, headRepositoryName, author{login,avatarUrl,…}, comparison{baseOid,headOid}, commitsCount, viewerAllowedNonCommentReviewTypes (e.g. ["APPROVE","REQUEST_CHANGES"]), mergedBy, mergedTime, aliveChannel}`.
- `repository`: `{id, name, ownerLogin, defaultBranch, viewerPermission ("read"/"write"/…), isEnterprise, …}`.
- `user`: `{currentUserLogin, canComment, canApplySuggestion, viewedFilesCount, lastReviewOid, tabSize, viewSettings{hideWhitespace, splitPreference, lineSpacing, commentsPreference, whitespacePreference}}`.
- `comparison`: `{fullDiff:{baseOid, headOid}, selectedRange: null | {baseOid, headOid}, viewing: "FULL" | …}`.
- `commits[]`: `{oid, shortOid, messageHeadline, actorLogin, createdAt}`.
- `viewerPendingReview`: `{id: null | <id>, comments: [...]}`. This is how you know whether the viewer has a pending review.
- `pageLimits`: `{filesLimit:3000, linesChangedLimit:10000, reviewThreadsLimit:40, reviewCommentsPerThreadLimit:20, reviewThreadsPaginatedLimit:350, annotationsPaginatedLimit:350, …Exceeded flags}`.
- `virtualizeDiffEntries`, `isSingleFileMode`, `fileFilter`, `userNotices`, `bannersData`, `changeGroupGeneration`, `urls{…}`.

**Fields that need explanation**
- `aliveChannel`: a signed live-update channel token. Do not log it.
- `diffSummaries[]`: **all files**. Each entry is `{path, pathDigest, changeType ("MODIFIED"/"ADDED"/"DELETED"/"RENAMED"…), linesAdded, linesDeleted, linesChanged, markedAsViewed, isVendored, isManifestFile, isCodeowner, isSymlink, highestAnnotationLevel, markersMap}`.
  - `pathDigest` = `sha256(path)` in hex (verified). DOM anchors are `#diff-<pathDigest>R<line>` / `L<line>`.
  - `markersMap`: `{ "R107": {threads:[{id: 2874503893}], annotations:[], ctx:[104,110]} , "FILE": {...} }`. Keys are `R<n>`/`L<n>` (side plus line on that side) or `FILE`. `ctx` is the context-line range the UI injects so that the thread's line is visible.
- `diffContents[]`: diffs for **only the first few files** (1–2 seen). Every other file must be fetched via §1.2.
- `markers`: `{threads: {<threadId>: Thread}, threadsPageInfo:{hasNextPage, cursor}, annotations:{}, annotationsPageInfo}`. Covers up to `reviewThreadsLimit` (40) threads; the rest come via `page_data/threads` (§2).

### 1.2 `GET ${basePath}/page_data/diff_entries` — VERIFIED-STATIC + VERIFIED-LIVE-GET
Source: `pull-requests/page-data/loaders/use-diff-entries.ts`.

Query params:
- `paths`: `paths.map(encodeURIComponent).join(',')`, then URL-encoded again by `URLSearchParams` (double encoding). Single encoding also worked (VERIFIED-LIVE-GET).
- `ctx` (optional): injected context ranges, ordered to match `paths`. Ranges within a file are separated by `,` and files by `:`. Example: `paths=a,b&ctx=:1-3,4-7` means no ranges for `a`, lines 1–3 and 4–7 for `b`.
- `w`: `0` | `1` (`1` hides whitespace changes; verified to change the hunks).
- `range`: `<headOid>` when the base equals the PR base. Otherwise `<baseOid>..<headOid>`.
  - Verified: `range=<sha>` returns PR-base..sha (cumulative), **not** a single commit.
  - For one commit, use `range=<parentSha>..<sha>`.
  - With `range=c1..cN`, `oldCommitOid=c1` and `newCommitOid=cN`.
- `outdated=1`: optional. Sent when the comparison is outdated.

Response: `DiffEntry[]`, one per path that has changes in that range. Paths without changes are omitted. Each entry is:
```
{ isBinary, isSubmodule, isTooBig, diffLines: DiffLine[], linesAdded, linesChanged, linesDeleted,
  oldCommitOid, newCommitOid,
  oldTreeEntry:{mode, path, lineCount}, newTreeEntry:{mode, path, lineCount, isGenerated},
  path, pathDigest, richDiff:{canToggleRichDiff, defaultToRichDiff, proseDiffHtml, renderInfo, dependencyDiffPath},
  submodule, status ("MODIFIED"…), truncatedReason (string|null), diffSize }
```

**Batching / limits (VERIFIED-LIVE-GET):**
- 51 paths in one request: 200 in about 1.0 s.
- 80 paths (URL about 7.3 KB): 200 in about 1.3 s.
- 100 paths (URL about 8.8 KB): **414 URI Too Long**.
- Keep the URL under about 8 KB; chunk by URL length, not by file count.
- GitHub's own UI loads progressively in small batches (`PROGRESSIVE_DIFF_BATCH_SIZE = 4`).

**`DiffLine` format** (VERIFIED-LIVE-GET):
```
{type, blobLineNumber, position, displayNoNewLineWarning, text, html, left, right, problems: []}
```

`type` is one of `HUNK`, `CONTEXT`, `ADDITION`, `DELETION`, `INJECTED_CONTEXT`. Client-only types are `EMPTY` and `empty-diff-line`.

- `text`:
  - Raw line, prefixed with one marker character: `+` (ADDITION), `-` (DELETION), ` ` (CONTEXT), `~` (INJECTED_CONTEXT).
  - HUNK lines carry the header, e.g. `@@ -96,10 +96,18 @@`.
- `html`:
  - The same line, **already syntax-highlighted** with GitHub "prettylights" classes (`pl-k`, `pl-c1`, `pl-s`, `pl-en`, `pl-kos`, …). It is HTML-escaped.
  - The first character is the marker (a space for INJECTED_CONTEXT).
  - Intra-line word diff is wrapped in `<span class="x x-first x-last">…</span>`.
  - `thread_previews` uses unquoted class attributes (`class=pl-k`).
- `left` / `right`: old-file and new-file line numbers.
  - On a DELETION, `right` is the previous right-side line number, and on an ADDITION, `left` is the previous left-side line number. Use only the side that matches the type.
  - On a HUNK, `left`/`right` = the hunk start minus 1.
- `blobLineNumber`: the line number on the "owning" side (left for deletions, right otherwise).
- `position`: index within the file's diff (0 = first hunk header). This is the legacy REST "position".

**Too-big files** (VERIFIED-LIVE-GET):
- Large files come back as `isTooBig: true, diffLines: []` (4 of 51 files in #36921).
- The UI's "Load diff" button calls `diff_entry_lines` (§1.3) with **no** ranges, which returned the full diff (976 lines) for such a file.
- `truncatedReason` (string) is used for other hidden cases. Deleted and generated files are also collapsed client-side but have lines.
- If `linesChangedLimit` (10,000) is exceeded, page-level limits apply (see the `*LimitExceeded` flags).

### 1.3 `GET ${basePath}/page_data/diff_entry_lines` — context expansion and full file (VERIFIED-STATIC + VERIFIED-LIVE-GET)
Source: `page-data/loaders/use-context-lines-data.ts`, `components/PullRequestDiff.tsx`.

Query params:
- `path=<path>` (sent once, plain)
- repeated `context_line_ranges[]=<JSON {"start":N,"end":M}>`
- `w=0|1`
- `range` (same rules as §1.2)

Response: `{diffEntryLines: DiffLine[]}`. This is the **whole file's diff** with the requested ranges injected as `INJECTED_CONTEXT` lines.

How the UI uses it:
- **Expand up/down:** the UI accumulates all ranges and re-requests.
- **Expand all:** one range `{start:1, end:max(oldTreeEntry.lineCount, newTreeEntry.lineCount)}`.
  - Verified: a 466-line file returned 467 lines (1 HUNK + 448 INJECTED_CONTEXT + diff lines), syntax-highlighted.
  - This is the easiest way to get **the full highlighted new-side file** in diff form.

### 1.4 Raw file contents — VERIFIED-LIVE-GET
- `GET https://github.com/<o>/<r>/raw/<sha>/<path>` (cookies) returns a **302** to `https://raw.githubusercontent.com/<o>/<r>/<sha>/<path>`. `fetch` follows it and gets `text/plain`.
- This worked from the page for a public repo.
- For private repos, the redirect target carries a short-lived `?token=`. Whether that is readable cross-origin from the page is **UNKNOWN**. Prefer §1.3 "expand all" for private repos.

### 1.5 Other read endpoints — VERIFIED-LIVE-GET unless noted

| Endpoint | Response |
|---|---|
| `GET page_data/file_tree` | Proto-JSON (response header `X-Proto-JSON: true`): `{baseRefOid, commits[], diffs[{changeType:"CHANGE_TYPE_MODIFIED"…, path, pathDigest, linesAdded, linesDeleted, linesChanged, isVendored, isManifestFile}], ownerLogin, repositoryName, pullRequestId, pullRequestNumber, pathName}`. Lighter file list (no viewed state). |
| `GET page_data/header` | VERIFIED-LIVE-GET (2026-10-17, Task 12): ~5 KB JSON `{pullRequest{headSha, mergeCommitSha, number, state, title, …}, mergeStatusButtonData{headSha, …}, aliveChannel(s), bannersData, featureStates, repository, urls, user, viewerPendingReview, viewSettings, …}`. `pullRequest.headSha` equals the route's `comparison.fullDiff.headOid` (react/react#37778, microsoft/vscode#151512); used by the freshness poll. On vscode#151512: 5,232 chars in ~0.65 s vs the route's 508,747 chars in ~2.3 s; `file_tree` (211,732 chars) and `base_comparison_info` (≈ the route) also carry the head oid in `commits[]` but are not lighter enough. |
| `page_data/header` → `stack` (stacked PRs) | VERIFIED-LIVE-GET + VERIFIED-STATIC (2026-10-19; public stacks martin-macak/claude-code-mod-tracking#70, github/gh-stack#529, WonderForgeLabs/gooey#387/#246, paulnsorensen/easy-cheese#722; `packages/pull-requests/components/StackState.tsx`, `StackOverlay.tsx`). `stack: null` for a PR in no stack, else `{id, number ("Stack #N"), position (1 = bottom), size, baseBranch, repositoryOwnerLogin, repositoryName, createdAt, allPullsLocked, pulls[{number, title, state (OPEN/DRAFT/CLOSED/MERGED/QUEUED), url ("/o/r/pull/N"), headBranch, headOid, isUnstackable, isInAutoMergeRange}]}`, `pulls` top of the stack first. Kept after the stack merges, and for a stack of one. GitHub shows its stack button when `featureStates.pullRequestStacks` is `ENABLED` and `stack` is set: in the title header (`4/5`, bordered), and in the stuck Files changed toolbar before the commit range (compact, with a chevron). Opening the menu refetches `page_data/header`. The route JSON has no stack data. |
| `page_data/header` → `aliveChannel` (live updates) | VERIFIED-LIVE (2026-10-19, dangh/pierre-sandbox#1; Files changed bundle `RefreshButton`). A signed alive channel name for the PR (`pull_request:<id>`, also `aliveChannels.pullRequest` and `mergeStatusButtonData.channels.pullRequestChannel`). GitHub's page script subscribes any `.js-socket-channel[data-channel=<name>]` element in the document and dispatches `socket:message` on it, `detail = {name, data: {timestamp, wait (ms of jitter), reason, gid, event_updates}}`. A push (new commit) sends `event_updates: {git_updated: true, timeline_updated: true}`; an issue comment and an inline review comment send only `{timeline_updated: true}`. Files changed shows its **Refresh** button (severe colors, sync icon, before the viewed counter) for `git_updated` only, about 2 to 3 s after the push, after waiting `wait` ms and a 2 s debounce; for comments it shows nothing and does not add the new thread until reloaded. Its layout header also refetches on `git_updated` or `title_updated`. |
| `GET page_data/diffstat` | `{diffstat:{linesAdded, linesDeleted, linesChanged}}` |
| `GET page_data/annotations?end_commit_oid=<sha>` | Check-run annotations `[]` (paginated, limit 350) |
| `GET page_data/rich_diff?path=…&range=…` | Rich (prose/render) diff, or `null` |
| `GET page_data/review_menu[?threadIds[]=…]` | `{viewerHasViolatedPushPolicy, viewerIsCopilotAttributed, viewerPermission:"READ"…, threads:[pending threads]}` |
| `GET page_data/tab_counts`, `page_data/codeowners`, `page_data/stacks` | Exist in code (VERIFIED-STATIC); not inspected |

All page_data names (from `PageData` enum, VERIFIED-STATIC):
- Reads: `annotations, base_comparison_info, change_groups, codeowners, conversation_comments, diff_entries, diff_entry_lines, diffstat, file_tree, header, pending_review, review_menu, rich_diff, stacks, tab_counts, thread_preview_positioning, thread_previews, threads, timeline, user_diff_view_settings, …`
  - `pending_review` returned 404 on GET, so it is not a standalone GET.
- Mutations: `abandon_review, add_comment_reaction, remove_comment_reaction, create_review_comment, update_review_comment, resolve_thread, unresolve_thread, submit_review, apply_suggestions, apply_review_suggestions, hide_comment, unhide_comment, update_whitespace_preference, …`

---

## 2. Existing review threads and comments

**How the page loads them** (VERIFIED-STATIC + VERIFIED-LIVE-GET). The page does **not** use `/_graphql`. The sources are:
1. Embedded `markers.threads` plus per-file `diffSummaries[].markersMap`, for the first 40 threads.
2. `GET page_data/threads[?after=<cursor>]` → `{threads: Thread[], aliveChannel}`.
   - Pagination uses the `Link: <…>; rel="next"` response header. `cursor` = `markers.threadsPageInfo.cursor`.
   - These threads include **full comments** but **no positioning**.
3. `GET page_data/thread_previews` → `Thread[]` with positioning, used by the comments side panel:
   ```
   {id, isOutdated, path, subject:{diffLines[4 StaticDiffLine], startLine, endLine, startDiffSide, endDiffSide ("LEFT"|"RIGHT"),
    originalStartLine, originalEndLine, pullRequestCommit}, originalDiffPathUri, diffSide, subjectType ("LINE"|"FILE"),
    line, startLine, startDiffSide, commentCount, commentsData?}
   ```
4. `GET page_data/thread_preview_positioning?thread_ids=1,2,3` (UI pages 40 at a time) → proto-JSON `{threads: {<id>: {commitOid, diffLines[], endDiffSide, endLine, startLine?, startDiffSide?, path, isOutdated?, originalDiffPathUri?}}}`.

Recommended way to build a full map:
- `threads` gives the bodies and state.
- `markersMap` gives the current positions for non-outdated threads.
- `thread_previews` or `thread_preview_positioning` give outdated and original positions.

**Thread object** (embedded and `threads`):
```
{id: "2874503884" (numeric string = thread DB id), subjectType: "LINE"|"FILE", isResolved, resolvedBy (login),
 resolutionReason, viewerCanReply, pullRequestReviewId, reviewCommentsLimit:20, reviewCommentsLimitExceeded,
 commentsData:{__id, comments: Comment[]}}
```

**Comment object** (VERIFIED-LIVE-GET):
- Identity and content: `id`/`relayId` = `"PRRC_…"` node id, `databaseId` (number; used by edit, delete and react), `body` (markdown), `bodyHTML`, `bodyVersion` (needed for edit).
- Authorship: `author{login, avatarUrl, isAgent, userType}`, `authorAssociation`, `viewerDidAuthor`, `viewerRelationship`.
- State and timing: `createdAt`, `publishedAt`, `state: "pending"|"submitted"`, `subjectType: "line"|"file"`, `reviewId`, `reviewVariantType` (`vanilla|copilot|code_scanning|…`), `automatedComment`.
- Edits and hiding: `lastUserContentEdit`, `isHidden`, `minimizedReason`.
- Reactions: `reactionGroups[{reaction:{content:"THUMBS_UP"|"THUMBS_DOWN"|"LAUGH"|"HOORAY"|"CONFUSED"|"HEART"|"ROCKET"|"EYES", viewerHasReacted}, reactors[], totalCount}]`.
- Permissions: `viewerCanUpdate`, `viewerCanDelete`, `viewerCanReact`, `viewerCanMinimize`, `viewerCanReport`, `viewerCanBlockFromOrg`, ….
- Other: `url` (`…#discussion_r<databaseId>`), `repository{…}`, `reference{number, author}`, `footnoteTextHTML`, `currentDiffResourcePath`, `stafftoolsUrl`.

Live updates use alive channels (`aliveChannel`, websocket via SharedWorker). The UI refetches `threads` on `{item_type:"thread"}` events. Using these is optional.

---

## 3. Mark file viewed / unviewed — VERIFIED-CAPTURED (viewed) / VERIFIED-STATIC (unviewed)
Source: `mutations/use-update-file-viewed-status-mutation.ts`.

- **Mark viewed:** `POST ${basePath}/file_review` (not under page_data), JSON body `{"path":"<path>","viewed":"viewed"}`.
- **Mark unviewed:** `DELETE ${basePath}/file_review`, JSON body `{"path":"<path>","_method":"delete"}`.
- Headers: the full verified-fetch JSON set (§0.1).
- Response: JSON. Errors are `{error}`.
- The UI disables this unless viewing the full diff ("can only be marked as viewed on the All files page").

Legacy question: the path `/o/r/pull/N/file_review` **is still the live endpoint**, now taking JSON with verified-fetch headers. Whether the old form-encoded `authenticity_token` variant is still accepted is **UNKNOWN** (not tested).

---

## 4. Comments and reviews

### 4.1 Create a review comment / thread — `POST ${basePath}/page_data/create_review_comment`
Source: `mutations/use-create-review-comment-mutation.ts`, `diff-lines/helpers/review-comment-factory.ts`, `components/conversations/StartConversation.tsx`.

Two body shapes exist, chosen by feature flag `cotd_ui` ("comment outside the diff"). It was **ON** for this account.

**Single line, `cotd_ui` on — VERIFIED-CAPTURED:**
```json
{"comparisonEndOid":"<effectiveRange.headOid>","comparisonStartOid":"<effectiveRange.baseOid>",
 "text":"<markdown>","submitBatch":true,
 "line":303,"path":"<path on that side>",
 "positioning":{"type":"line","baseCommitOid":"<base>","headCommitOid":"<head>","path":"<path>","line":303,"commitOid":"<head if right, base if left>"},
 "side":"right","subjectType":"line"}
```

**Multi-line, `cotd_ui` on — VERIFIED-STATIC:**
```json
{"comparisonEndOid":"…","comparisonStartOid":"…","text":"…","submitBatch":true,
 "line":<endLine>,"path":"<end path>","side":"left|right","startLine":<n>,"startSide":"left|right","subjectType":"multiline",
 "positioning":{"type":"multiline","baseCommitOid":"…","headCommitOid":"…",
   "startPath":"…","startLine":<n>,"startCommitOid":"<base|head by startSide>",
   "endPath":"…","endLine":<m>,"endCommitOid":"<base|head by endSide>"}}
```

**File-level — VERIFIED-STATIC:**
```json
{"comparisonEndOid":"…","comparisonStartOid":"…","text":"…","submitBatch":true,"path":"…","subjectType":"file"}
```
(No `positioning` is sent, by design.)

**Legacy shape, `cotd_ui` off — VERIFIED-STATIC:**
```json
{"text":"…","line":N,"path":"…","side":"left|right","startSide":"left|right"?,"startLine":N?,"submitBatch":bool,
 "comparisonEndOid":"<selectedRange.headOid|undefined>","comparisonStartOid":"<selectedRange.baseOid|undefined>"}
```
File-level legacy: `{text, path, submitBatch, subjectType:"file", comparisonEndOid, comparisonStartOid}`.

Field rules:
- `side` is lowercase `left`/`right`. Line numbers are on that side's file (left = old file, right = new file).
- For renamed files, a left-side `path` is `oldTreeEntry.path`.
- `submitBatch` decides where the comment goes (VERIFIED-CAPTURED):
  - **`true`** = the "Comment" / "Reply" button. Publishes immediately as a standalone comment.
  - **`false`** = "Start a review" / "Add review comment". Adds the comment to the viewer's pending review, creating one if needed.
  - When a pending review exists, the UI hides the `true` option. What the server does with `true` in that state is UNKNOWN.

Response (VERIFIED-STATIC): `{thread: Thread, comment: Comment, totalCommentsCount}`.

### 4.2 Reply to a thread — same endpoint — VERIFIED-STATIC
```json
{"text":"…","submitBatch":true|false,"inReplyTo":<databaseId of LAST comment in thread>,"path":"<thread file path>",
 "comparisonStartOid":"<selectedRange.baseOid>"|omitted,"comparisonEndOid":"<selectedRange.headOid>"|omitted}
```
- "Reply and resolve" sends the reply with `submitBatch:true`, then calls resolve (§4.6).

### 4.3 Submit review — `PUT ${basePath}/page_data/submit_review` — VERIFIED-CAPTURED
```json
{"body":"<markdown, may be empty if pending comments exist>","event":"comment"|"approve"|"request changes","headSha":"<pullRequest.comparison.headOid>"}
```
- Note: `event` values are lowercase, with a space in `"request changes"`.
- Response: `ReviewResponse` with `redirectUrl` (the UI navigates to it or applies its hash).
- Pending comments are included automatically. No review id is passed.
- Approve / Request changes are only allowed if listed in `pullRequest.viewerAllowedNonCommentReviewTypes`.

### 4.4 Discard pending review — `DELETE ${basePath}/page_data/abandon_review` — VERIFIED-STATIC
- No body. Verified-fetch JSON headers.
- Response JSON (`ReviewResponse`, or `{error}`).

### 4.5 Edit / delete comment — VERIFIED-STATIC
- **Edit:** `PUT ${basePath}/page_data/update_review_comment?body_version=<comment.bodyVersion>`.
  - Body: `{"body":"<new markdown>","commentId":"<String(databaseId)>"}`.
  - Response: `{threadId, commentDatabaseId, body, bodyHTML, bodyVersion}`.
- **Delete:** `DELETE ${basePath}/page_data/review_comments/<databaseId>`.
  - No body. Success is **204 or 200**. Otherwise the response is a JSON error.
  - Deleting the last comment deletes the thread.
- **Review summary edit** (different flow): `PUT ${basePath}/reviews/<reviewId>/update`.
  - multipart `FormData`: `pull_request_review[body]`, `body_version`.
  - Can return `{stale:true, updated_markdown, updated_html, version}`.

### 4.6 Resolve / unresolve — VERIFIED-STATIC
- `POST ${basePath}/page_data/resolve_thread`, body `{"threadId":"<thread.id>","resolution_reason":<string|omitted>}`.
  - A reason is only used for Copilot threads behind `thread_resolution_reason`.
- `POST ${basePath}/page_data/unresolve_thread`, body `{"threadId":"<thread.id>"}`.
- `thread.id` is the numeric-string id (e.g. `"2874503884"`), **not** a `PRRT_` node id.

### 4.7 Reactions — VERIFIED-STATIC
- Add: `POST ${basePath}/page_data/add_comment_reaction`.
- Remove: `POST ${basePath}/page_data/remove_comment_reaction`.
- Body for both: `{"reaction":"THUMBS_UP"|"THUMBS_DOWN"|"LAUGH"|"HOORAY"|"CONFUSED"|"HEART"|"ROCKET"|"EYES","commentId":<databaseId number>}`.
- The UI chooses add vs remove from `viewerHasReacted`.
- Response: `{reactionGroups:[…]}`.

### 4.8 Hide / unhide (minimize) — VERIFIED-STATIC
- `POST page_data/hide_comment` with `{"classifier":"<reason>","commentId":<databaseId>}`.
- `POST page_data/unhide_comment` with `{"commentId":<databaseId>}`.

---

## 5. Suggested changes — VERIFIED-STATIC
- A suggestion is **plain body text**: a fenced block ```` ```suggestion ```` in `text`. No separate field exists.
- It is rendered and validated client-side against `sourceContentFromDiffLines` (`diff-lines/helpers/suggested-changes.ts`).

**Apply a single suggestion** (legacy path): `POST page_data/apply_suggestions`, body:
```
{changes: SuggestedChange[], currentOid: <head>, message: <commit msg>}
```
where `SuggestedChange = {authorLogin, commentId, commentDatabaseId, path, suggestion: string[], threadId, lineRange:{startLineNumber, endLineNumber, startOrientation, endOrientation}, suggestionIndex}`. On success the page reloads.

**Apply a batch** (current UI): `POST page_data/apply_review_suggestions`.
- Header `Idempotency-Key: <crypto.randomUUID(), kept per PR in sessionStorage>`.
- Body: `{comments:[{id:<commentDatabaseId>, suggestionIndex?:n}] (sorted), message, expectedHeadOid:<head>}`.
- A 409 with `{code:"HEAD_OID_MISMATCH"}` means the PR head moved.

Applying requires `user.canApplySuggestion` (write access).

---

## 6. Markdown preview — VERIFIED-CAPTURED
`POST /preview`. This is the **site-root** path, not under the repo.
- Headers: verified-fetch base headers. No JSON headers; the body is `multipart/form-data`.
- FormData fields captured from the inline composer:
  - `text`
  - `issue=<pullRequest.id (database id)>`
  - `repository=<repository.id>`
  - `project=<same as issue>`
  - `subject_type=PullRequest`
  - `subject=<PR number>`
  - `path`, `line_number`
  - `start_commit_oid=<base>`, `end_commit_oid=<head>`, `base_commit_oid=<base>`
  - optional `start_line_number`
- The path, line and oid fields let `suggestion` blocks render as diffs.
- Response: an HTML string (sanitized server-side). Non-OK responses produce "Markdown preview unavailable".

---

## 7. `/_graphql` and persisted queries — VERIFIED-STATIC
- **None of the review actions on `/pull/N/changes` use GraphQL.** Everything above is `page_data` / `file_review` / `/preview`.
- Of about 1,790 chunks reachable from this page's runtime, only 15 Relay operations exist, all issue-viewer or label related (e.g. `useIssueQueryQuery`, `updateIssueMutationContentOnlyMutation`).

Request format (`packages/fetch-graphql/fetch-graphql.ts`):
- The payload is `{persistedQueryName, query:<id>, variables}` with keys sorted.
- **GET:** `GET /_graphql?body=<encodeURIComponent(JSON)>`, sent with `credentials:'include'`, `cache:'no-cache'`, `Accept: application/json` plus the base headers.
- **POST:** `POST /_graphql` via `verifiedFetch`, body = the same JSON string.
- Subscriptions add `&subscription=1` (and scope/topic params).

Where the ids come from:
- They are Relay persisted-query ids (32-hex, the Relay compiler hash of the query text).
- They are embedded in chunks as `params:{id:"<hex32>",metadata:{},name:"<OperationName>",operationKind:"query|mutation",text:null}`.
- They are stable **until the query text changes**. Chunk filenames change every deploy.

How a third-party script can find ids at runtime:
1. Fetch the loaded script URLs (`performance.getEntriesByType('resource')`, `document.scripts`).
2. Find lazy chunks via the `wp-runtime-*.js` chunk map (`n.u=e=>…` returns `chunk-<name>-<hash>.js` on `github.githubassets.com/assets/`).
3. Regex the text for `name:"<Op>"`.

Not needed for this extension.

---

## 8. Summary table

| Action | Method + URL | Body | Status |
|---|---|---|---|
| Route JSON (meta, file list, threads) | GET `/o/r/pull/N/changes` (JSON headers) | – | LIVE-GET |
| Diffs | GET `page_data/diff_entries?paths&ctx&w&range[&outdated]` | – | LIVE-GET |
| Context / full file / load big diff | GET `page_data/diff_entry_lines?path&context_line_ranges[]&w&range` | – | LIVE-GET |
| Threads | GET `page_data/threads[?after=]`, `thread_previews`, `thread_preview_positioning?thread_ids=` | – | LIVE-GET |
| Viewed | POST `/o/r/pull/N/file_review` | `{path, viewed:"viewed"}` | CAPTURED |
| Unviewed | DELETE `/o/r/pull/N/file_review` | `{path, _method:"delete"}` | STATIC |
| New comment (line, multi-line, file) | POST `page_data/create_review_comment` | see §4.1 | CAPTURED (line); STATIC (multi, file) |
| Reply | POST `page_data/create_review_comment` | `{text, inReplyTo, path, submitBatch, …}` | STATIC |
| Submit review | PUT `page_data/submit_review` | `{body, event, headSha}` | CAPTURED |
| Discard pending | DELETE `page_data/abandon_review` | – | STATIC |
| Edit comment | PUT `page_data/update_review_comment?body_version=` | `{body, commentId}` | STATIC |
| Delete comment | DELETE `page_data/review_comments/<dbId>` | – | STATIC |
| Resolve / unresolve | POST `page_data/resolve_thread` / `unresolve_thread` | `{threadId}` | STATIC |
| React | POST `page_data/add_comment_reaction` / `remove_comment_reaction` | `{reaction, commentId}` | STATIC |
| Apply suggestion(s) | POST `page_data/apply_suggestions` / `apply_review_suggestions` | see §5 | STATIC |
| Preview | POST `/preview` (multipart) | see §6 | CAPTURED |

## 9. Unknowns
- The minimum header set that the server enforces on writes (whether `X-Fetch-Nonce` / `X-GitHub-Client-Version` are mandatory). Send all of them.
- What `submitBatch:true` does while a pending review exists.
- The exact response bodies of the write endpoints (only inferred from client code: `{thread, comment, totalCommentsCount}`, `{reactionGroups}`, `{redirectUrl}`, …).
- Whether the legacy form-encoded `file_review` / review-comment endpoints with `authenticity_token` are still accepted.
- Whether the private-repo `raw` → `raw.githubusercontent.com?token=` redirect is readable from page JS.
- How `cotd_ui` off behaves now (legacy body shape); the flag may differ per account.

## 10. Fragility risks
- These are internal, unversioned endpoints. Names come from a `PageData` enum that changes with deploys (e.g. `pending_review` exists but 404s on GET).
- Feature flags change payload shapes per user (`cotd_ui`, `pr_sfv_new_diff_fetch`, `thread_resolution_reason`, proto-JSON responses with `X-Proto-JSON`).
- The `X-Fetch-Nonce` rotates. Read it fresh before each write.
- The 8 KB URL cap on `diff_entries`.
- Public source maps make re-verification easy (`curl` the `.map`, read `sourcesContent`), but they could be withdrawn.
