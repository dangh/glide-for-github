# In-page scroll spike, 2026-10-19

The packaged extension now renders Glide in GitHub's top document and performs highlighting in native workers. It uses the existing content lifecycle to keep the tab present when GitHub replaces its layout. The user confirmed that native bounce feels good on macOS. The adoption checks and their limits are recorded below; the implementation remains on `spike/in-page`.

## Current architecture

The viewer mounts in an open shadow root owned by GitHub's top document. Its diff list has no vertical scroller; the document scrolls, while the toolbar and file headers use native sticky positioning. The adapter patches Pierre's viewport reads, scroll anchoring, and programmatic jumps. It preserves Pierre’s bounded scroll paging for very tall lists: logical offsets are translated to document positions, and the return-to-top action clears the logical page offset.

A hidden `worker-host.html` iframe runs in the extension origin and creates the native Pierre workers. MessagePorts carry the existing worker protocol between the content script and those workers. This frame contains no viewer, toolbar, diff DOM, or scrolling relay. It exposes no token-storage or GitHub API methods.

GitHub's origin cannot construct a worker from a `chrome-extension://` script directly. The earlier spike attempted that and fell back to the main thread. The worker host removes that origin mismatch. Worker startup errors now produce a visible failure, and PR data loading cannot clear that failure and hide a fallback.

Pierre's custom-element registration also needs the page's registry: Chrome's isolated content-script registry is null. The small `elements.js` MAIN-world entry registers the two hosts; viewer logic and extension state remain isolated. Theme, focus, and menu handling use the viewer's shadow root. Token entry stays on an extension page because an open shadow root is readable by page scripts.

## Packaged-extension proof

The repository e2e tests load the actual unpacked extension in Chrome for Testing 155 with a disposable copy of a signed-in profile. They navigate a public PR through its Glide tab and check:

- The tab is visible, and is reinserted after removal to simulate GitHub replacing its strip.
- A real PR file header renders in the top document's shadow root, with no `iframe[data-pierre-viewer]`.
- The hidden extension host creates and initializes at least two native workers, completes highlighting requests, and reports zero worker errors. The recorded run had four spawned workers, four initialized workers, one completed render at the sampled point, and zero errors.
- Removing the worker host causes a remount and a new pool that completes highlighting.
- A forced native Worker constructor failure produces an alert and no file renderer, rather than silently switching to main-thread highlighting.

The earlier smoke checks missed a layout failure: GitHub's flex parent shrank the host to 334 px, leaving a 32 px diff pane. The host now explicitly occupies the content width. Actual browser assertions failed before this fix and pass after it. The same pass found a settings menu ending at 868 px in an 800 px window, and outside clicks on GitHub failing to close menus. Menu height now tracks the available viewport space; dismissal uses the document event's composed path across the shadow boundary.

The expanded checks run against `dangh/glide-for-github#1` (17 files) and `react/react#37778` (167 files at the time of the run), at actual device pixel ratios 1 and 2. They verify:

- Full content width, flex layout, usable diff width, and no document horizontal overflow at 768, 900, 1280, and 1440 px.
- Wheel scrolling with visible code, sticky toolbar screenshots, tree search/navigation, tree hiding and left/right placement, and split/unified layout changes.
- Display menu bounds, Escape and outside-click dismissal, and review menu opening/closing.
- File comment focus, typing, retained text, and cancellation without submitting.
- Switching to GitHub's Files changed and back, reload, a second PR, tab repair, and worker-host recovery.

Each interaction checkpoint saves a screenshot and geometry attachment under `test-results/`. The screenshots were visually inspected, including the narrow menu, split view, comment editor, and scrolled second PR. These are packaged-extension checks, not an injected layout fixture.

The subsequent sticky-bar audit found that the in-page entry never activated the requested layout in the shared viewer. It also retained iframe gutters, omitted the native header/footer handling, and let CodeView's padding collapse through its root. The repair connects the requested layout and stuck state, measures the native header and toolbar together, and applies that inset to the tree and file headers. Only the merged toolbar extends to the viewport edges; content stays inside GitHub's existing gutters. File boxes now align with the outside content edge, with 16 px only toward a visible tree. Conversation entry also removes the inherited 1280 px content cap. The merged title returns to the document top.

`tests/e2e/inpage-layout.spec.ts` checks both `merged` and `page`, on Files changed and Conversation, at device pixel ratios 1 and 2. At widths 767, 768, 1011, 1012, and 1440 px it asserts toolbar, tree, and file edges; native header visibility and offsets; visible document-scrolled code; left/right/hidden tree spacing; and menu bounds. It also checks file jumps with 16 px and 40 px top padding, the bottom content edge, title-click navigation, and restoration of GitHub's native header/footer on exit. Each checkpoint saves a screenshot and geometry JSON. These checks exposed the missing merged title before the repair.

An additional case replaces GitHub's header while scrolled and adds 200 px of spacing. It verifies that the same viewer remains mounted, a tracked code row moves exactly 200 px without another scroll, and the toolbar stays pinned. The layout observer follows the replacement header and invalidates CodeView's cached viewport when its document offset changes. Pierre's input handlers now follow the window too: toolbar clicks and keys outside the list cancel pending scroll targets, including keys stopped at the shadow boundary.

At the initial regression review, eight focused browser scenarios, TypeScript, build integrity checks, and 891 unit tests passed. This is a focused browser check, not a passing result for the full production e2e suite. The earlier main-branch suite has separate failures recorded in the conversation.

The lifecycle is reused rather than replaced with a one-time tab insertion. It handles DOM/route notifications, active-tab styling, settings, and tab presses. A GitHub layout replacement preserves the mounted React root if its worker host survives, or remounts the viewer and its workers if that host was removed.

## Regression review

The review reproduced an unsafe lifetime change: removing the iframe leaves viewer modules and pending promises alive. An approval started on PR A could wait for its pending-review lookup, then read PR B from the global store, start a review there, and clear B's summary draft. Review operations now capture their PR and connection, check each asynchronous continuation before another request, and reject stale local updates. Tests delay PendingReview, StartReview, and SubmitReview separately. Independent probes also covered delayed comment, discard, resolve, Viewed, and reaction responses. No real review was posted by these probes.

The same lifetime change left suggestion dialogs open across remounts. Dialog teardown now drops their refs, late completions cannot close a newer dialog, and suggestion responses cannot change the next PR's batch or head-moved state. Stale Viewed and Reload errors also cannot show notices on the next PR.

The sticky toolbar's z-index 50 was above the modal backdrop's 40. The backdrop is now 100. The browser check hit-tests the shipped backdrop CSS over a toolbar button; component tests exercise suggestion-dialog remount and delayed completion. This does not establish complete modal keyboard-focus coverage.

The in-page entry also omitted per-file scroll persistence. Browser pixel restoration lost the previously visible code line. The new attachment saves the file and offset, waits for that file's diff to load, and restores the same line. It explicitly requests a delayed collapsed file's full lines even if the initial viewport has replaced its loader priority. Failed loads restore the file header instead. User input cancels restoration; browser Back/Forward policy is left untouched.

`tests/e2e/inpage-regression.spec.ts` checks exact visible-line restoration, retained summary text, modal hit testing, and a 20-entry stack menu. The stack payload is supplied locally through the browser's network interception; the rest is the actual extension on a real GitHub PR. No comments, reviews, viewed changes, or suggestions are submitted. The earlier stack overflow suspicion was withdrawn: the stack button only exists once the merged toolbar is stuck, and its menu fits there.

The initial independent review found no remaining important issue in those fixes. This is a regression review of the spike, not production adoption approval.

## Earlier scroll and isolation probes

The T3 collaborative browser ran a synthetic 500-file list, with 160 TypeScript lines before and after per file, inside a shadow root on https://github.com/dangh/glide-for-github/pull/1/files. It was signed out, and the synthetic probe was injected through browser automation rather than loaded as an extension.

At document scroll positions 1,000, 200,000, 800,000, and the bottom at 1,633,740.5 pixels, the list's own `scrollTop` stayed at zero. Only one file was mounted at each sampled position; the bottom sample mounted file 499. The toolbar stayed at zero pixels and the native sticky file header at 56 pixels. A jump to file 250 reached its exact logical top, 817,008 pixels. Styled tokens appeared on every sampled file. Raw samples are in [evidence.json](evidence.json).

External rules setting textarea fonts to 90 pixels and toolbar heights to 999 pixels did not cross the shadow boundary: the probe retained its 14-pixel input and 56-pixel toolbar. Focus required `shadowRoot.activeElement`, rather than `document.activeElement`, which reports the shadow host. A browser check also verified that translated `:host(...)` attribute selectors apply responsive controls and header styles.

## Earlier synthetic timings

The synthetic local harness alternated document scrolling and Pierre's original element scrolling five times each, 120 animation frames per run, with the same data and two workers. This comparison had no separate iframe process, no full GitHub application load, and no network loader or actual review composer. `frame` in its measurement output means an element scroller, not the current production iframe.

Both paths had a median per-run p95 frame interval of about 16.8 ms. Per-run p95 intervals ranged from 16.7 to 50.0 ms for document scrolling and 16.7 to 50.1 ms for element scrolling. The first pair overlapped unit tests on this six-core host and has known CPU contention. No production speedup or performance equivalence is established. These measurements also predate the port-based worker host and do not measure its overhead.

The loop advanced 120 pixels per frame through the first five files; separate jump checks covered distant files. Each run recorded render calls, mounted items, actual highlighted tokens, and initialized worker statistics. The warm runs hit the display's roughly 60 Hz cadence. No full profiler or current-build comparison was run.

## Adoption checks, 2026-10-20

The current implementation passes 907 unit tests, TypeScript, the build, twelve packaged-extension browser scenarios, and the separate document-height stress test. The browser scenarios include the eight original layout/worker/regression cases plus saved-state recovery, native navigation, full-body replacement, and authenticated writes. The height test’s upward-scroll step was corrected to cross the actual paging threshold; that case passed on rerun. The navigation tests use the persistent sandbox fixture rather than depending on this implementation PR remaining open.

### Saved state

The worker host now offers a read-only recovery channel over authenticated extension runtime messaging. It accepts only this extension’s top-frame content script, in the same tab, for the PR in the sender’s URL. The allowlist is drafts, suggestion batch, suggestion retry key, file-group selection, and scroll anchor. Credentials never enter the snapshot.

Recovery completes before persistence subscriptions or the viewer mount. Existing destination values win; the batch and retry key stay paired. A journal makes interrupted copies retryable, and a completed marker prevents deleted drafts from reappearing. The old extension-origin state remains untouched. Early input still cancels saved-position restoration while recovery is pending.

Unit tests cover rejection of foreign keys and senders, partial-copy retry, destination precedence, and navigation cancellation. The packaged browser test seeds the old extension-origin storage, reloads, verifies recovered state, edits and deletes the recovered draft across more reloads, and verifies the originals remain intact.

### Authenticated writes and focus

All writes ran on disposable [pierre-sandbox#2](https://github.com/dangh/pierre-sandbox/pull/2), using a temporary copy of the existing signed-in Chrome profile. The test created a file comment, replied, edited, deleted, resolved/unresolved a conversation, submitted a Comment review, discarded a pending review, toggled Viewed in both directions with reloads, and committed a line suggestion. REST/GraphQL reads verified server state; the suggestion check also verified the new commit message and changed file contents. Test comments and pending reviews were removed, and the disposable PR and its branch were closed/deleted afterward.

The commit dialog now wraps Tab/Shift+Tab, returns focus on close, and keeps focus on an enabled field while committing. The browser test held the actual suggestion request before sending it, checked focus while the action buttons were disabled, then released it and verified the real commit. Component tests cover wrap, Escape, focus return, and busy state. The independent review identified the disabled-button focus gap before this final check.

The authenticated account owns the disposable PR, so GitHub does not allow it to approve or request changes there. Those two review events retain unit/API coverage; no claim of real second-account approval or request-changes testing is made.

### Navigation and extreme height

Actual GitHub PR-list navigation uses a full document reload in this environment. The browser checks that route and verifies the draft survives. A separate test replaces the whole body on a real PR page and dispatches `turbo:render`, then verifies one working viewer/worker host, highlighting, and retained draft. This exercises the replacement lifecycle without claiming GitHub used Turbo on the observed list route.

The height stress test uses the same viewport adapter and 10,500 synthetic files. Its logical height is **34,313,984 px**, while the physical document stays at **12,000,322 px**. It reaches the final file, checks actual mounted code, crosses page boundaries in both directions with wheel input, returns to page top, and shrinks the rebased list to ten files. The list itself never scrolls. Raw jump samples: [height-and-jumps.json](height-and-jumps.json).

### Packaged-build comparison

**No meaningful difference at p95; occasional missed frames increased in-page.** Five alternating runs per build on each real PR used identical copied settings, split diffs, merged toolbar, Chrome 155, and a 1280×800 viewport. The iframe baseline is `a9f01a5884fb1fd08a6eb70fff695cc22031bbeb`; built-script SHA-256 values are recorded with the samples.

The scroll phase moves the document 160 px per animation frame for 180 frames, about 9,600 px/s at 60 Hz. It samples the diff renderer’s own frame intervals **and** the outer page, including the iframe’s separate process. Typing inserts and checks 100 characters at 20 ms/key, then cancels the composer. Load times include the real GitHub/network path and are not isolated worker-transport measurements. Both builds completed loading all 167/898 entries, showed highlighted code after scrolling, and retained every typed character. All 20 runs completed with zero observed page errors, failed diff/API HTTP responses, or in-page worker errors.

Values are median **[minimum–maximum]** of five runs; scrolling and typing cells summarize each run’s p95.

| PR / build | First code (s) | All entries (s) | Renderer frames (ms) | Typing to next frame (ms) |
| --- | --- | --- | --- | --- |
| React 167 / iframe | 5.51 [4.97–6.30] | 6.37 [5.63–7.11] | 16.7 [16.7–16.8] | 15.3 [15.0–15.9] |
| React 167 / in-page | 4.71 [4.21–4.99] | 5.40 [5.02–5.57] | 16.7 [16.7–16.8] | 15.8 [14.5–16.1] |
| VS Code 898 / iframe | 4.72 [4.47–4.75] | 10.16 [9.89–10.73] | 16.7 [16.7–16.8] | 16.0 [14.9–16.4] |
| VS Code 898 / in-page | 4.91 [4.50–5.32] | 10.55 [10.36–11.82] | 16.8 [16.7–16.8] | 15.3 [14.0–16.7] |

The tail matters: **16 of 1,811 in-page renderer intervals exceeded 25 ms**, with a maximum of **33.4 ms**; **0 of 1,799 iframe intervals** exceeded 25 ms, with a maximum of 16.8 ms. Neither renderer reported a Long Task during the scroll samples. This is a small measured scrolling cost of the in-page path, not performance equivalence or a universal speedup. Live-network load ranges and different directions across the two PRs do not support a general load-time claim.

A separate CPU-profile pass, excluded from timing results, spent 55–63% of sampled time idle; `getBoundingClientRect` accounted for about 7–9%. The common p95 floor is therefore consistent with the roughly 60 Hz frame cadence, not a saturated renderer CPU. The timed run began at load averages 2.57/2.66/2.43 on six cores, with no other task-owned browser suite running. Both sides used fresh copied profiles initially and retained their own caches for subsequent runs. These are full-build user-path checks; port overhead is included but not isolated.

Raw runs (timings rounded to 0.001 ms): [production-comparison.json](production-comparison.json). Separate profiler summary: [profile-summary.json](profile-summary.json). The first exploratory timing pass sampled only the outer page and was discarded as a comparison because it missed the iframe renderer’s own frame loop.

### Scope and remaining limits

- The user already confirmed natural macOS bounce. These new browser runs use headless Chrome for Testing 155 on Linux and do not reproduce physical trackpad gestures.
- The twelve packaged browser cases are focused adoption checks, not a claim that the older full production e2e suite passes unchanged.
- Scroll integration still adapts private methods in the pinned Pierre 1.5.2 dependency. The large-height and layout tests must accompany any Pierre upgrade.

## Reproduce

Every build command on this branch, including `npm run build`, produces the **IN-PAGE SPIKE** extension in `dist/`. Old `content.js`, `viewer.js`, and `viewer.html` assets are removed so this branch cannot silently build the old iframe viewer. The original `node scripts/inpage-spike/build.mjs` command also works.

After pulling and building, reload the extension in `chrome://extensions`, then reload the GitHub page. Click Glide beside Files changed, or open a PR URL ending in `#glide`.

To run the packaged-extension checks, set `PIERRE_SPIKE_PROFILE` to a signed-in Chrome profile directory and run `PIERRE_E2E_HEADLESS=1 npx playwright test tests/e2e/inpage-spike.spec.ts tests/e2e/inpage-layout.spec.ts tests/e2e/inpage-regression.spec.ts`. The tests copy that profile into a temporary directory and delete the copy afterward; they do not post comments or change viewed state.

For the synthetic harness, serve the worktree with `python3 -m http.server 8134` and open `http://localhost:8134/research/inpage-spike/index.html`. Evaluate `scripts/inpage-spike/measure.js`, then call `await __spikeMeasure()` to repeat the earlier synthetic comparison.

For the additional adoption checks, run `PIERRE_SPIKE_PROFILE=/path/to/profile npx playwright test tests/e2e/inpage-migration.spec.ts tests/e2e/inpage-navigation.spec.ts tests/e2e/inpage-height.spec.ts`. The native navigation fixture is `dangh/pierre-sandbox#1`; those checks perform no remote writes.

For real writes, first create a fresh draft PR in `dangh/pierre-sandbox` with a branch named `test/inpage-adoption-*`, based on the existing `review-me` fixture head. Run `PIERRE_WRITE_PR=<new-number> PIERRE_SPIKE_PROFILE=/path/to/profile npx playwright test tests/e2e/inpage-writes.spec.ts`. It refuses another repository/branch family, removes its comments and pending reviews, and leaves the submitted Comment review and suggestion commit as evidence. Close the disposable PR and delete its branch after the run.

For the packaged comparison, build the iframe baseline from `a9f01a5884fb1fd08a6eb70fff695cc22031bbeb` in a separate directory, build this branch, then run `PIERRE_BASELINE_DIST=/path/to/baseline/dist PIERRE_SPIKE_PROFILE=/path/to/profile node scripts/inpage-spike/compare.mjs`. It alternates five runs per build on React’s 167-file PR and VS Code’s 898-file PR. `PIERRE_COMPARE_PROFILE=1 PIERRE_COMPARE_RUNS=1` records a separate profiling pass; exclude that pass from reported timings.
