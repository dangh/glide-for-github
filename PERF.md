# Performance

Glide for GitHub is measured against this budget (Task 12), on two public pull requests:

| Metric | Budget |
| --- | --- |
| Whole PR loaded, from navigation to `…/pull/N#glide` | ≤ 6.5 s on react/react#37778 (167 files), ≤ 22 s on microsoft/vscode#151512 (898 files) |
| Steady scroll of the diffs, top to bottom at 3,000 px/s | no long task > 50 ms in the viewer |
| Typing in a comment box (300 characters) | p95 keystroke → next animation frame < 16 ms (input-to-paint) |

Run it with `npm run perf`. That builds, then runs `tests/e2e/perf.spec.ts` headed on `DISPLAY`. Use
`PIERRE_E2E_HEADLESS=1` for headless and `PIERRE_PERF_RUNS=n` for the number of runs (default 3). It needs the
logged-in e2e profile (`scripts/e2e-profile.sh`, see `playwright.config.ts`). It is read-only: nothing is posted, and
every write request is blocked while it types. Raw results go to `perf-results/` (git-ignored).

## Results (2026-10-17, final build `0b752fe`)

These results were measured on 0.1.0, before the extension was renamed from Pierre for GitHub to Glide for GitHub
and before its tab moved from `#pierre` to `#glide`, so this section and the ones below still say "Pierre" for the
extension. Build `0b752fe` is a pre-publication copy of `8647784` in this repository's history, with the same extension
code. Later versions have not been re-measured.

Chrome for Testing 155, headed on the dev VM's VNC desktop (animation frames every ~13.3 ms, i.e. ~75 Hz), logged
in, over that VM's own connection to github.com. Three runs per PR, each in a fresh tab of the same browser profile.
Values are median / worst of 3. Load times depend heavily on GitHub's server response times, which vary between runs
and over the day.

| Metric | Before (`c75325b`) | After (`0b752fe`) | Budget | Verdict |
| --- | --- | --- | --- | --- |
| react#37778, first diff visible | 5.11 s / 5.86 s | 3.84 s / 3.93 s | – | – |
| react#37778, whole PR loaded | 6.15 s / **6.76 s** | 4.80 s / 5.36 s | ≤ 6.5 s | met |
| vscode#151512, first diff visible | 6.20 s / 7.84 s | 4.26 s / 4.28 s | – | – |
| vscode#151512, whole PR loaded | 11.66 s / 16.23 s | 10.51 s / 10.84 s | ≤ 22 s | met |
| react#37778, long tasks while scrolling (62,796 px) | none | none (longest frame 14 ms) | ≤ 50 ms | met |
| vscode#151512, long tasks while scrolling (739,316 px, ~4 min) | none | none (longest frame 27 ms) | ≤ 50 ms | met in the final build (see "Scroll" for the earlier build) |
| vscode#151512, typing p95 keystroke → next animation frame | 12.6 ms / 12.7 ms | 12.6 ms / 12.6 ms | < 16 ms | met |
| vscode#151512, typing p95 keystroke → after the next paint | 13.9 ms / 13.9 ms | 13.8 ms / 13.8 ms | < 16 ms (input-to-paint) | met headed; headless 16.4 ms / 17.0 ms, see below |

### Every measured session

All runs with the perf spec, in order. A "breach" is a viewer long task over 50 ms while scrolling vscode#151512.

| Session | Build | Mode | react whole PR (runs) | vscode whole PR (runs) | vscode scroll long tasks per run |
| --- | --- | --- | --- | --- | --- |
| baseline | `c75325b` | headed | 5.94, 6.15, **6.76** s | 16.23, 11.45, 11.66 s | none, none, none |
| after1 | prefetch + click + header (= `d9ca736` viewer) | headed | 4.85, 4.84, 5.29 s | 10.81, 10.74, 9.40 s | **58, 77, 53, 50 ms** (discarded run, see below), none, none |
| final | `d9ca736` | headed | 5.33, 4.48, 4.76 s | 8.98, 9.36, 9.81 s | none, **79 and 54 ms**, 50 ms |
| diag | `d9ca736` + incident logging | headed | – | 10.49, 10.35, 9.45 s | none, none, none |
| headless | `d9ca736` | headless | 6.04, 4.71, 4.65 s | 9.29, 9.16, 9.51 s | none, none, none |
| round1 | `6d13c63` (tree sync deferred) | headed | **6.64**, 5.46, 5.01 s | 9.13, 10.19, 10.50 s | none, none, none |
| round1b | `0b752fe` (diff requests shared) | headed | 5.29, 5.12, 4.44 s | – | – |
| round1-final | `0b752fe` | headed | 4.80, 5.36, 4.66 s | 10.51, 9.86, 10.84 s | none, none, none |
| round1-headless | `0b752fe` | headless | 4.96, 3.99, 4.41 s | 9.32, 10.60, 10.57 s | none, none, none |

The discarded run is after1's first vscode run. During its scroll I was running the unit test suite (26 vitest
workers) on the same machine, so its long tasks (58, 77, 53, 50 ms) measure CPU contention, not Pierre. It is listed
here and counted below anyway.

### Scroll

Before the tree-sync change (`d9ca736` viewer, 12 vscode scroll runs, headed and headless):

- Counting the discarded run: 2 of 12 runs breached (17%).
- Excluding it: 1 of 11 runs breached (9%).
- A task of exactly 50 ms, which is within budget, appeared in 1 more run.

The breaching frame in the official run (79 ms) had no script over 5 ms. Its time went to rendering. A Chrome trace
showed the heaviest viewer tasks at 30–49 ms: animation-frame callbacks plus style, layout and paint.

The cause was the tree following the diff. Whenever the top file changed (every ~0.3 s at 3,000 px/s on this PR),
the tree selected it, expanded its folders and scrolled. The tree's re-render and layout then landed inside scroll
frames. Traced 1-minute scrolls of vscode#151512, 2 runs each:

| Viewer main-thread tasks while scrolling | p95 | p99 | max |
| --- | --- | --- | --- |
| tree sync in every scroll frame (`d9ca736`) | 12.9–13.6 ms | 19.6–20.3 ms | 29.8–41.8 ms |
| tree sync disabled (experiment) | 8.3–8.4 ms | 11.0–11.5 ms | 22.3–29.1 ms |
| tree sync after scrolling pauses (`7da79f0`, final) | 8.2–8.4 ms | 11.1–11.2 ms | 17.6–19.2 ms |

Since `7da79f0`, the tree catches up 150 ms after scrolling stops, in an idle callback. Results with it: 9 vscode
scroll runs (6 headed, 3 headless) with no long task and no frame over 33 ms. The longest frame was 27 ms headed and
33 ms headless. The scroll budget is met for the final build. It was missed in the earlier build at the rates above.

Also tried, not adopted: a smaller render chunk (`hunkLineCount` 25 instead of 50) did not change the tail
measurably. Reading layout in our scroll handler is cheap: the visible-file math uses CodeView's cached layout, and
`loader.prioritize` takes under 0.1 ms.

### Typing (input-to-paint)

Two numbers are recorded for each keydown (`page.keyboard.type`, one key every 20 ms, i.e. 50 characters/s):

- the time to the next `requestAnimationFrame` callback (the budget metric);
- the time to just after that frame's paint (rAF, then a MessageChannel message).

Typing itself costs ~1.3–1.6 ms (p50). The rest is waiting for the next frame.

| vscode#151512, p95 of 300 keys (worst of 3) | Headed (~75 Hz) | Headless (60 Hz) |
| --- | --- | --- |
| keystroke → next animation frame | 12.6 ms | 15.9 ms |
| keystroke → after the next paint (input-to-paint) | 13.8 ms | 17.0 ms |

Headless Chrome produces a frame every 16.7 ms, so any keystroke that just misses a frame waits up to 16.7 ms. The
headless input-to-paint p95 (16.2–17.0 ms over 3 runs) is therefore over 16 ms because of the frame interval alone,
and keystroke → next frame (15.2–15.9 ms) sits just under it. On a real 60 Hz display the 16 ms input-to-paint target
is at the limit of one frame for every key, whatever the page does.

Event Timing (keydown to the next presented frame, rounded to 8 ms, which adds compositor and display latency) puts
179–294 of 300 keys at ≥ 16 ms in every build, before and after. That stricter measure is dominated by the frame
pipeline, not by Pierre.

### Where the load time goes (final, median run)

react#37778:

1. `<head>` is parsed at ~1.4 s, and the bridge starts reading GitHub's route JSON (~1.1 s of server time).
2. GitHub's page reaches DOMContentLoaded at ~2.15 s, and the viewer iframe is mounted.
3. GitHub's React app replaces its whole page layout at ~2.9 s (it does this without Pierre too), so the viewer is
   mounted a second time at ~3.0–3.7 s.
4. The second viewer gets the route and the first viewer's in-flight diff requests from the bridge, and has all 167
   diffs ~0.9–2.2 s after it starts.

Each `diff_entries` request is 0.5–1.0 s of GitHub server time.

vscode#151512 is the same up to the second viewer. The route JSON (~0.5 MB) arrives at ~3.3 s, and the 898 diffs take
46 requests, 6 at a time, in ~6–7 s.

## What changed

1. **Route prefetch** (`src/page/prefetch.ts`): the MAIN-world bridge now runs at `document_start`. On a `#pierre` PR
   URL it requests GitHub's route JSON as soon as `<head>` is parsed. Only the viewer's first load is answered from
   it (an opt-in flag). Every later read goes to GitHub: thread refreshes after a comment, reloads, "Try again".
2. **Shared diff requests during the load-time remount** (same file): identical `diff_entries` requests (range pinned
   to commit ids) share one request while in flight and for 10 s after success. The remounted viewer picks up the
   first viewer's requests instead of sending them again.
3. **Tree sync off the scroll frames** (`createSettle` in `src/viewer/state/view.ts`, `DiffPane`): see "Scroll".
4. **Lost early clicks** (`src/content/lifecycle.ts`): clicking the Pierre tab while GitHub was still loading did
   nothing, because GitHub re-rendered the tab strip between press and release. A release inside the pressed tab now
   opens Pierre.
5. **Freshness poll** (`fetchHeadOid`): it reads the head from `page_data/header` (~5 KB) instead of the route JSON
   (~0.5 MB on vscode#151512) every 60 s. Only a well-formed commit id (40 or 64 hex digits) is accepted; anything
   else falls back to the route.

## Known limits

- **Remount blink.** GitHub replaces its page layout once during load (~0.5 s after the load event), and Pierre's
  iframe with it, so the viewer boots twice on a direct `#pierre` load. The second boot reuses the prefetched route
  and the in-flight diff requests. Because the first viewer can now show the PR before the replacement, the diffs
  can blink once right after the page loads. Avoiding this means hosting the iframe outside GitHub's React tree
  (after `<react-app>`), which needs its own width and position handling. Opening Pierre from an already loaded page
  has no remount.
- **GitHub's server sets the floor.** Time to the whole PR depends on the route JSON (1–2.5 s) and `diff_entries`
  (0.5–1 s per 20 files, 6 requests at a time). One react run on `6d13c63` took 6.64 s (over budget) when GitHub was
  slow: the page's DOMContentLoaded alone took 2.45 s, and the loader 3.1 s instead of ~1.5 s.
- While scrolling, the tree no longer follows each file. It catches up 150 ms after scrolling stops.
