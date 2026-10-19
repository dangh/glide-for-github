# In-page scroll spike, 2026-10-19

Recommendation: proceed with the one-document scrolling design as a candidate. Do not replace the production iframe yet. The scroll adapter works; extension-context workers, authenticated review flows, navigation, and macOS trackpad behavior remain adoption gates.

Everything on `spike/in-page` is throwaway. Nothing from this spike was merged or pushed to main.

## Verified behavior

The T3 collaborative browser ran a synthetic 500-file list, with 160 TypeScript lines before and after per file, inside an open shadow root on the live GitHub page at https://github.com/dangh/glide-for-github/pull/1/files. This browser was signed out. The probe was injected through browser automation, not loaded as an extension. That proves rendering and layout feasibility, not extension loading or authenticated API behavior.

At document scroll positions 1,000, 200,000, 800,000, and the bottom at 1,633,740.5 pixels, the list itself stayed at `scrollTop: 0`. Only one file was mounted at each sampled position; the bottom sample mounted file 499. The toolbar stayed at 0 pixels and the native sticky file header at 56 pixels. A programmatic jump to file 250 reached its exact logical top, 817,008 pixels. Main-thread highlighting produced styled tokens on every sampled file. Raw samples are in [evidence.json](evidence.json).

The inherited Pierre header style uses `top: 0`. The adapter adds the toolbar inset with `unsafeCSS`, preserving Pierre's prototype-backed options. Both the toolbar and file headers use browser CSS stickiness. The code does not relay wheel deltas between scrollers. Window scroll events update the virtualized range; programmatic jumps and Pierre's layout anchoring can still call `window.scrollBy`.

External rules setting textarea fonts to 90 pixels and toolbar heights to 999 pixels did not cross the shadow boundary: the probe kept its 14-pixel input and 56-pixel toolbar. Focus landed on the host in `document.activeElement`, and on the textarea in `shadowRoot.activeElement`. The shared viewer changes therefore scope focus, menu, modal, and theme handling to the viewer root. The probe did not change GitHub's root font or color-mode attribute.

## Highlighting constraints

On the real GitHub page, a page-context blob worker failed with a `worker-src` CSP violation. This does **not** prove that an isolated extension content script cannot start a worker. [Chrome documents separate CSP rules for isolated content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#content_security_policy).

The local harness successfully initialized two Pierre workers, highlighted visible content, and finished its runs with no worker failures or queued tasks. The extension prototype attempts a packaged `chrome-extension://` worker. That path has not been exercised in the collaborative browser, which does not expose an unpacked-extension loader. Do not count its main-thread fallback as worker success. If direct creation fails, an extension-origin iframe hosting the worker pool and forwarding its protocol over ports is a candidate; it was not implemented or tested here.

## Timing is inconclusive for production

The local harness alternated page scrolling and Pierre's original element scrolling five times each, 120 animation frames per run, with the same data and two workers. This comparison has **no separate iframe process**, no full GitHub application load, and no network loader or actual review composer. `frame` in the measurement output means an element scroller, not the current production iframe.

Both paths had a median per-run p95 frame interval of approximately 16.8 ms. Per-run p95 intervals ranged from 16.7 to 50.0 ms for page scrolling and 16.7 to 50.1 ms for element scrolling. The first pair overlapped the unit-test run on this six-core host, so those samples have known CPU contention. No speedup or production performance equivalence is established.

The loop advances 120 pixels per frame through the first five files of the 500-file dataset; separate jump checks cover the distant files. Each run recorded render calls, mounted items, actual highlighted tokens, and initialized worker statistics, so a fast no-op or failed highlighter cannot pass unnoticed. The warm runs hit the display's roughly 60 Hz cadence. Main-thread render work was instrumented, but no full profiler or current-build comparison was run. The results are a smoke check, not a reason to choose one architecture for performance.

## Remaining adoption gates

- Run the unpacked extension on an authenticated GitHub PR. Check direct worker initialization and explicit fallback reporting, post/reply/edit/delete review comments, viewed toggles, and suggestion actions. None of those authenticated actions were attempted by this spike.
- Exercise real keyboard shortcuts, menus, modal focus traps, Turbo navigation, and GitHub React layout replacements. The standalone prototype requires a PR URL ending in `#glide` at initial load, uses a full reload on hash changes, and does not implement the normal tab lifecycle.
- Test a physical macOS trackpad at the top, bottom, and former page/list seam. Linux programmatic scrolling cannot verify macOS rubber-band feel.
- Restore a production strategy for extremely tall lists. The adapter disables Pierre's scroll rebasing; the tested list is about 1.63 million pixels tall. Browser document-height limits still apply to larger inputs.
- Keep token entry in an extension page. An open shadow root is style isolation, not a secret DOM boundary. The prototype disables the in-page token prompt and directs missing-token actions to extension options. Stored tokens can still be used by isolated content-script code.

Compared with a full-height iframe, an in-page viewer permits native page-relative sticky headers without a cross-frame position relay. A full-height iframe retains the extension document boundary, but still needs a viewport adapter and a strategy for sticky file headers. Neither route has earned a production performance claim from this spike.

## Reproduce

From this worktree, run `node scripts/inpage-spike/build.mjs`. It creates a separately named **IN-PAGE SPIKE** extension in this worktree's `dist/`, plus the synthetic browser probe. `npm run build` restores the ordinary iframe build in the same worktree.

For the synthetic harness, serve the worktree with `python3 -m http.server 8134` and open `http://localhost:8134/research/inpage-spike/index.html`. The harness starts in page mode with workers. To compare paths, evaluate the contents of `scripts/inpage-spike/measure.js`, then call `await __spikeMeasure()`. `__spikeStart({mode:'page',count:500,workers:true})` and `__spikeStart({mode:'frame',count:500,workers:true})` select individual paths.

To try the extension prototype, load this worktree's `dist/` as unpacked, then open a PR URL ending in `#glide`. This build is a feasibility artifact with the limitations above.

Validation: spike build succeeds, TypeScript passes, and all 876 existing unit tests pass. These tests do not cover the unverified extension and platform gates above.
