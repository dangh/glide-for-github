# Performance

Pierre for GitHub is measured against this budget (Task 12), on two public pull requests:

| Metric | Budget |
| --- | --- |
| Whole PR loaded, from navigation to `…/pull/N#pierre` | ≤ 6.5 s on react/react#37778 (167 files), ≤ 22 s on microsoft/vscode#151512 (898 files) |
| Steady scroll of the diffs, top to bottom at 3,000 px/s | no long task > 50 ms in the viewer |
| Typing in a comment box (300 characters) | p95 keystroke → next animation frame < 16 ms |

Run it with `npm run perf` (builds, then `tests/e2e/perf.spec.ts`, headed on `DISPLAY`; `PIERRE_E2E_HEADLESS=1` for
headless, `PIERRE_PERF_RUNS=n` for the number of runs, default 3). It needs the logged-in e2e profile
(`scripts/e2e-profile.sh`, see `playwright.config.ts`). It is read-only: nothing is posted, and every write request is
blocked while it types. Raw results go to `perf-results/` (git-ignored).

## Results (2026-10-17)

Chrome for Testing 155, headed on the dev VM's VNC desktop (animation frames every ~13.3 ms, i.e. ~75 Hz), logged
in, over that VM's own connection to github.com. Three runs per PR, each in a fresh tab of the same browser profile.
Median / worst of 3. Load times depend heavily on GitHub's server response times, which vary by run.

| Metric | Before | After | Budget | Verdict |
| --- | --- | --- | --- | --- |
| react#37778, first diff visible | 5.11 s / 5.86 s | 3.85 s / 4.19 s | – | – |
| react#37778, whole PR loaded | 6.15 s / **6.76 s** | **4.76 s / 5.33 s** | ≤ 6.5 s | met |
| vscode#151512, first diff visible | 6.20 s / 7.84 s | 3.94 s / 4.08 s | – | – |
| vscode#151512, whole PR loaded | 11.66 s / 16.23 s | **9.36 s / 9.81 s** | ≤ 22 s | met |
| react#37778, longest long task while scrolling (62,796 px) | none | none | ≤ 50 ms | met |
| vscode#151512, longest long task while scrolling (739,316 px, 4 min) | none (3 runs) | none in 6 of 8 runs; 50 ms in one; **79 ms and 54 ms in one** | ≤ 50 ms | missed once in 8 (see note) |
| vscode#151512, typing p95 keystroke → next frame | 12.6 ms / 12.7 ms | 12.7 ms / 12.7 ms | < 16 ms | met |

"After" is the final run of `npm run perf` (3 runs per PR); the scroll row adds a second 3-run vscode session and 2
earlier runs of the same viewer code (8 runs; one more run was discarded because unit tests were running on the
same machine during it).

### Where the time goes (after)

react#37778, median run: GitHub's document is parsed and `<head>` is in at ~1.4 s, when the bridge starts reading
GitHub's route JSON (~1.1 s of GitHub server time); GitHub's page reaches DOMContentLoaded at ~2.15 s; the viewer
iframe is mounted, then GitHub's React app replaces its whole page layout at ~2.9 s (it does this without Pierre
too), so the viewer is mounted a second time at ~3.0 s; it gets the route data from the bridge at once and loads the
167 diffs in 10 requests in ~1.5 s (each `diff_entries` request is 0.5–1.0 s of GitHub server time).

vscode#151512: the same up to the second viewer (~2.8 s); the route JSON (~0.5 MB) arrives at ~3.1 s; the 898 diffs
take 46 requests, 6 at a time, ~6.4 s.

### Scroll note

Over 8 clean 4-minute scrolls of vscode#151512 after the changes, one run had two long tasks (79 ms and 54 ms) and
one had a task of exactly 50 ms; the other six had none. The baseline's 3 runs had none. The long animation frame
behind the 79 ms task had no script over 5 ms: it was rendering (style, layout, paint of newly shown diff lines,
inside Pierre's CodeView). The changes in this round do not touch the viewer's rendering. Seven more scrolls under a
Chrome trace (3 full, 4 one-minute) had no task over 50 ms; the heaviest viewer tasks were 40–49 ms with tracing
overhead: Pierre's virtualizer in animation-frame callbacks (8–22 ms) plus style, layout and paint (15–30 ms); the
p99 of all viewer tasks was ~20 ms. A smaller render chunk (`hunkLineCount` 25 instead of 50)
did not change the tail measurably, so it was not adopted. We read the outliers as this VM's jitter on top of
30–49 ms frames rather than a regression, but they are real: on a slow machine the heaviest frames of a huge PR can
pass 50 ms.

### Typing note

The keystroke metric is keydown → next `requestAnimationFrame` callback (`page.keyboard.type`, one key every 20 ms,
50 characters/s). Typing itself costs ~1.5 ms (p50); the p95 of ~12.7 ms is mostly waiting for the next frame of the
~75 Hz display. Event Timing (keydown to the next frame being presented, which adds the compositor and display
latency, rounded to 8 ms) puts 239–294 of 300 keys at ≥ 16 ms after, and 246–260 before: that stricter measure is
dominated by the frame pipeline, not by Pierre.

## What changed in this round

1. **Route prefetch** (`src/page/prefetch.ts`): the MAIN-world bridge now runs at `document_start` and, on a
   `#pierre` PR URL, requests GitHub's route JSON as soon as `<head>` is parsed, in parallel with GitHub's page load.
   The viewer's request is answered from it (also after the iframe remount), so the route is requested once instead
   of twice and is ready before the viewer is.
2. **Lost early clicks** (`src/content/lifecycle.ts`): clicking the Pierre tab while GitHub is still loading did
   nothing, because GitHub re-rendered the tab strip between press and release and the browser fired no click. A
   release inside the pressed tab now opens Pierre.
3. **Freshness poll** (`fetchHeadOid`): reads the head from `page_data/header` (~5 KB) instead of the route JSON
   (~0.5 MB on vscode#151512) every 60 s.

## Headed vs headless

Headless runs (`PIERRE_E2E_HEADLESS=1`) of the same build:

| Metric (median / worst of 3) | Headed | Headless |
| --- | --- | --- |
| react#37778, first diff / whole PR | 3.85 s / 4.19 s · 4.76 s / 5.33 s | 4.01 s / 4.46 s · 4.71 s / 6.04 s |
| vscode#151512, first diff / whole PR | 3.94 s / 4.08 s · 9.36 s / 9.81 s | 3.81 s / 3.91 s · 9.29 s / 9.51 s |
| Long tasks while scrolling (react, vscode) | none, see the note for vscode | none, none |
| Typing p95 keystroke → next frame | 12.7 ms / 12.7 ms | 15.5 ms / 15.5 ms |

Load times are the same within run-to-run noise (the network and GitHub's server dominate; the headless 6.04 s was
one slow run, the other two took 4.7 s). Frame-based numbers differ in cadence: headless Chrome produces frames at 60 Hz
(16.7 ms) instead of the headed display's ~75 Hz (13.3 ms), so "keystroke → next frame" is mostly the wait for the next
frame and sits just under 16 ms headless (typing work itself is ~1.1 ms p50). The budget verdicts above use the
headed runs.

## Known limits

- GitHub replaces its page layout once during load (~0.5 s after the load event, with or without Pierre), and
  Pierre's iframe with it, so the viewer boots twice on a direct `#pierre` load. The second boot reuses the
  prefetched route, which removes most of the cost, but since the first viewer is now often fast enough to show the
  PR before that, the diffs can blink once (~0.3 s) right after the page loads. Avoiding the remount entirely means
  hosting the iframe outside GitHub's React tree (after `<react-app>`), which needs its own width/position handling;
  not done in this round. Opening Pierre from an already loaded page (clicking the tab) has no remount.
- Time to the whole PR is bound by GitHub's server: the route JSON (1–2 s) and `diff_entries` (0.5–1 s per 20 files,
  6 requests at a time).
