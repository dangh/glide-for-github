# In-page scroll spike, 2026-10-19

The packaged extension now renders Glide in GitHub's top document and performs highlighting in native workers. It uses the existing content lifecycle to keep the tab present when GitHub replaces its layout. The user confirmed that native bounce feels good on macOS. Keep this on `spike/in-page` until authenticated review writes, persisted-state migration, and production performance have been verified.

## Current architecture

The viewer mounts in an open shadow root owned by GitHub's top document. Its diff list has no vertical scroller; the document scrolls, while the toolbar and file headers use native sticky positioning. The adapter patches Pierre's viewport reads, scroll anchoring, and programmatic jumps. It disables scroll rebasing, so browser document-height limits remain relevant to extremely tall lists.

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

All eight focused browser scenarios pass. TypeScript, the build integrity checks, and all 891 unit tests pass. This is a focused browser check, not a passing result for the full production e2e suite. The earlier main-branch suite has separate failures recorded in the conversation.

The lifecycle is reused rather than replaced with a one-time tab insertion. It handles DOM/route notifications, active-tab styling, settings, and tab presses. A GitHub layout replacement preserves the mounted React root if its worker host survives, or remounts the viewer and its workers if that host was removed.

## Regression review

The review reproduced an unsafe lifetime change: removing the iframe leaves viewer modules and pending promises alive. An approval started on PR A could wait for its pending-review lookup, then read PR B from the global store, start a review there, and clear B's summary draft. Review operations now capture their PR and connection, check each asynchronous continuation before another request, and reject stale local updates. Tests delay PendingReview, StartReview, and SubmitReview separately. Independent probes also covered delayed comment, discard, resolve, Viewed, and reaction responses. No real review was posted by these probes.

The same lifetime change left suggestion dialogs open across remounts. Dialog teardown now drops their refs, late completions cannot close a newer dialog, and suggestion responses cannot change the next PR's batch or head-moved state. Stale Viewed and Reload errors also cannot show notices on the next PR.

The sticky toolbar's z-index 50 was above the modal backdrop's 40. The backdrop is now 100. The browser check hit-tests the shipped backdrop CSS over a toolbar button; component tests exercise suggestion-dialog remount and delayed completion. This does not establish complete modal keyboard-focus coverage.

The in-page entry also omitted per-file scroll persistence. Browser pixel restoration lost the previously visible code line. The new attachment saves the file and offset, waits for that file's diff to load, and restores the same line. It explicitly requests a delayed collapsed file's full lines even if the initial viewport has replaced its loader priority. Failed loads restore the file header instead. User input cancels restoration; browser Back/Forward policy is left untouched.

`tests/e2e/inpage-regression.spec.ts` checks exact visible-line restoration, retained summary text, modal hit testing, and a 20-entry stack menu. The stack payload is supplied locally through the browser's network interception; the rest is the actual extension on a real GitHub PR. No comments, reviews, viewed changes, or suggestions are submitted. The earlier stack overflow suspicion was withdrawn: the stack button only exists once the merged toolbar is stuck, and its menu fits there.

The final independent review found no remaining important issue in these fixes. This is a regression review of the spike, not production adoption approval.

## Earlier scroll and isolation probes

The T3 collaborative browser ran a synthetic 500-file list, with 160 TypeScript lines before and after per file, inside a shadow root on https://github.com/dangh/glide-for-github/pull/1/files. It was signed out, and the synthetic probe was injected through browser automation rather than loaded as an extension.

At document scroll positions 1,000, 200,000, 800,000, and the bottom at 1,633,740.5 pixels, the list's own `scrollTop` stayed at zero. Only one file was mounted at each sampled position; the bottom sample mounted file 499. The toolbar stayed at zero pixels and the native sticky file header at 56 pixels. A jump to file 250 reached its exact logical top, 817,008 pixels. Styled tokens appeared on every sampled file. Raw samples are in [evidence.json](evidence.json).

External rules setting textarea fonts to 90 pixels and toolbar heights to 999 pixels did not cross the shadow boundary: the probe retained its 14-pixel input and 56-pixel toolbar. Focus required `shadowRoot.activeElement`, rather than `document.activeElement`, which reports the shadow host. A browser check also verified that translated `:host(...)` attribute selectors apply responsive controls and header styles.

## Timing remains inconclusive

The synthetic local harness alternated document scrolling and Pierre's original element scrolling five times each, 120 animation frames per run, with the same data and two workers. This comparison had no separate iframe process, no full GitHub application load, and no network loader or actual review composer. `frame` in its measurement output means an element scroller, not the current production iframe.

Both paths had a median per-run p95 frame interval of about 16.8 ms. Per-run p95 intervals ranged from 16.7 to 50.0 ms for document scrolling and 16.7 to 50.1 ms for element scrolling. The first pair overlapped unit tests on this six-core host and has known CPU contention. No production speedup or performance equivalence is established. These measurements also predate the port-based worker host and do not measure its overhead.

The loop advanced 120 pixels per frame through the first five files; separate jump checks covered distant files. Each run recorded render calls, mounted items, actual highlighted tokens, and initialized worker statistics. The warm runs hit the display's roughly 60 Hz cadence. No full profiler or current-build comparison was run.

## Remaining adoption gates

- The user confirmed macOS bounce. Automated Linux checks still do not reproduce physical trackpad gestures.
- Verify authenticated review comments, replies, edits, deletion, viewed toggles, and suggestion actions. The focused tests above do not perform review writes.
- Exercise full Turbo body replacement and modal keyboard focus on the real site. The focused checks cover menu dismissal, a long stack menu, switching tabs, reload, a second PR, and modal click blocking, but not every navigation or focus path.
- Migrate existing iframe-origin session storage before production adoption. The new viewer reads GitHub-origin session storage, so old drafts, suggestion batches/idempotency keys, and file-group selections are not automatically imported.
- Measure the full extension against the current iframe build on large real PRs, including comment typing and port transport overhead.
- Restore a production strategy for inputs exceeding the browser's document-height limit. The synthetic list tested here was about 1.63 million pixels tall.

An in-page viewer permits page-relative native sticky headers. A full-height iframe retains the extension document boundary, but would need its own viewport adapter and a sticky-header strategy. This spike provides evidence for in-page feasibility; it does not establish a performance winner.

## Reproduce

Every build command on this branch, including `npm run build`, produces the **IN-PAGE SPIKE** extension in `dist/`. Old `content.js`, `viewer.js`, and `viewer.html` assets are removed so this branch cannot silently build the old iframe viewer. The original `node scripts/inpage-spike/build.mjs` command also works.

After pulling and building, reload the extension in `chrome://extensions`, then reload the GitHub page. Click Glide beside Files changed, or open a PR URL ending in `#glide`.

To run the packaged-extension checks, set `PIERRE_SPIKE_PROFILE` to a signed-in Chrome profile directory and run `PIERRE_E2E_HEADLESS=1 npx playwright test tests/e2e/inpage-spike.spec.ts tests/e2e/inpage-layout.spec.ts tests/e2e/inpage-regression.spec.ts`. The tests copy that profile into a temporary directory and delete the copy afterward; they do not post comments or change viewed state.

For the synthetic harness, serve the worktree with `python3 -m http.server 8134` and open `http://localhost:8134/research/inpage-spike/index.html`. Evaluate `scripts/inpage-spike/measure.js`, then call `await __spikeMeasure()` to repeat the earlier synthetic comparison.
