/**
 * Performance budget (Task 12), READ-ONLY, on public PRs: react/react#37778 (167 files) and microsoft/vscode#151512
 * (898 files). Run with `npm run perf` (headed on DISPLAY, like the other e2e suites; not part of `npm run e2e`).
 *
 * Per run (a fresh tab, `PIERRE_PERF_RUNS` runs per PR, default 3):
 * 1. Load: navigate to `…/pull/N#pierre`; times are measured from the GitHub document's navigation start
 *    (`performance.timeOrigin`) to (a) the first frame with a rendered diff line in the viewer, (b) the first frame in
 *    which every file has a result in the store (lazy line loads of collapsed / too-large files excluded). Watched
 *    with a requestAnimationFrame loop inside the viewer frame (frame-accurate, no poll granularity); epoch times
 *    (`timeOrigin + now()`) make the page and the iframe comparable. Breakdown: GitHub's DOMContentLoaded / load,
 *    viewer iframe navigations (remounts), the route JSON request (`/changes`) timing and size.
 * 2. Scroll: the CodeView scroller from top to bottom at 3,000 px/s (scrollTop set every animation frame), collecting
 *    `PerformanceObserver('longtask')` (and long animation frames for attribution) inside the viewer frame.
 * 3. Typing (vscode only): "Comment on file" on the first file, `page.keyboard.type` of 300 characters; per keydown,
 *    the time from the event's timeStamp to the next requestAnimationFrame callback (and, for information, to just
 *    after that frame's paint). Writes are blocked for the whole typing phase: non-GET requests to github.com /
 *    api.github.com are aborted (Playwright routes) and `fetch`/XHR writes throw in both the page and the viewer;
 *    the test fails if anything tried. The composer is then cancelled (draft discarded). Nothing is ever posted.
 *
 * Results: printed, and written to `perf-results/<pr>-<timestamp>.json` (git-ignored).
 */
import type { Frame, Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, HEADLESS, prUrl, REACT, ROOT, test, type PrId } from './fixtures';

const VSCODE: PrId = { owner: 'microsoft', repo: 'vscode', number: 151512 };
const RUNS = Number(process.env.PIERRE_PERF_RUNS || 3);
const SCROLL_PX_PER_S = 3000;
const TYPED = 'The quick brown fox jumps over the lazy dog while Pierre renders a very large pull request. '
  .repeat(4)
  .slice(0, 300);
/** Delay between keys (ms): 50 characters/s, faster than any human, without CDP batching several keys per frame. */
const KEY_DELAY_MS = 20;


const isViewerUrl = (url: string) => url.startsWith('chrome-extension://') && url.includes('/viewer.html');
const viewerFrame = (page: Page): Frame | undefined => page.frames().find((f) => isViewerUrl(f.url()));

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? NaN : s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const percentile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? NaN : s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};
const r = (n: number | undefined) => (n === undefined || Number.isNaN(n) ? undefined : Math.round(n * 10) / 10);

// ---------------------------------------------------------------------------------------------------------
// 1. Load

interface LoadResult {
  firstDiffMs: number;
  allLoadedMs: number;
  files: number;
  statuses: Record<string, number>;
  domContentLoadedMs: number;
  loadEventMs: number;
  viewerNavigations: number;
  viewerFrameStartMs: number;
  routeRequests: { startMs: number; endMs: number; bytes: number }[];
  loader?: { firstDiffMs?: number; allMs?: number; requests: number };
  /** Freshness poll source (page_data/header): its headSha equals the shown head. */
  headCheck: { matches: boolean; chars: number; ms: number };
}

async function measureLoad(page: Page, pr: PrId): Promise<LoadResult> {
  let viewerNavigations = 0;
  page.on('framenavigated', (f) => {
    if (isViewerUrl(f.url())) viewerNavigations++;
  });
  // GitHub's route JSON (`/changes`), requested by the bridge in the page's main world: epoch start/end and size.
  const routePath = `/${pr.owner}/${pr.repo}/pull/${pr.number}/changes`;
  const routeRequests: Promise<{ startEpoch: number; endEpoch: number; bytes: number }>[] = [];
  page.on('requestfinished', (req) => {
    if (new URL(req.url()).pathname !== routePath) return;
    const t = req.timing();
    routeRequests.push(req.sizes().then((s) => ({ startEpoch: t.startTime, endEpoch: t.startTime + t.responseEnd, bytes: s.responseBodySize })));
  });
  await page.goto(prUrl(pr, '#pierre'), { waitUntil: 'commit' });
  const navStart = await page.evaluate(() => performance.timeOrigin);

  const deadline = Date.now() + 120_000;
  let watched: { first: number; all: number; origin: number; statuses: Record<string, number>; files: number; stats?: Window['__pierreStats'] } | undefined;
  while (!watched) {
    if (Date.now() > deadline) throw new Error('Pierre did not load every file within 120 s');
    const frame = viewerFrame(page);
    if (!frame) {
      await page.waitForTimeout(20);
      continue;
    }
    try {
      // Resolves in the first animation frame where every file has a result; re-armed if the iframe is remounted.
      watched = await frame.evaluate(
        () =>
          new Promise<{ first: number; all: number; origin: number; statuses: Record<string, number>; files: number; stats?: Window['__pierreStats'] }>(
            (resolve) => {
              let first: number | undefined;
              const tick = () => {
                const now = performance.timeOrigin + performance.now();
                if (first === undefined) {
                  for (const c of document.querySelectorAll('diffs-container')) {
                    if (c.shadowRoot?.querySelector('[data-line]')) {
                      first = now;
                      break;
                    }
                  }
                }
                const s = window.__pierre?.store.getState();
                if (first !== undefined && s?.pr && s.order.length > 0) {
                  const statuses: Record<string, number> = {};
                  let busy = false;
                  for (const p of s.order) {
                    const st = s.load.get(p)?.status ?? 'pending';
                    statuses[st] = (statuses[st] ?? 0) + 1;
                    if (st === 'pending' || st === 'loading') busy = true;
                  }
                  if (!busy) {
                    resolve({ first, all: now, origin: performance.timeOrigin, statuses, files: s.order.length, stats: window.__pierreStats });
                    return;
                  }
                }
                requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
            },
          ),
      );
    } catch (err) {
      if (!/detached|destroyed|Target closed|navigat/i.test(String(err))) throw err;
    }
  }

  const page_ = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return { dcl: nav?.domContentLoadedEventEnd ?? NaN, load: nav?.loadEventEnd ?? NaN };
  });
  const routes = (await Promise.all(routeRequests)).map((x) => ({ startMs: x.startEpoch - navStart, endMs: x.endEpoch - navStart, bytes: x.bytes }));

  // The freshness poll's head read (page_data/header) against the head the viewer shows, and its size.
  const frame = viewerFrame(page)!;
  const headCheck = await frame.evaluate(async (p) => {
    const t0 = performance.now();
    const { data } = await window.__pierre!.session.rpc!.call('get', `/${p.owner}/${p.repo}/pull/${p.number}/page_data/header`);
    const sha = (data as { pullRequest?: { headSha?: string } } | null)?.pullRequest?.headSha;
    return { matches: sha === window.__pierre!.store.getState().pr?.headOid, chars: JSON.stringify(data).length, ms: performance.now() - t0 };
  }, pr);

  const s = watched.stats;
  return {
    headCheck,
    firstDiffMs: watched.first - navStart,
    allLoadedMs: watched.all - navStart,
    files: watched.files,
    statuses: watched.statuses,
    domContentLoadedMs: page_.dcl,
    loadEventMs: page_.load,
    viewerNavigations,
    viewerFrameStartMs: watched.origin - navStart,
    routeRequests: routes,
    ...(s
      ? {
          loader: {
            firstDiffMs: s.firstDiffAt !== undefined ? s.firstDiffAt - s.startedAt : undefined,
            allMs: s.doneAt !== undefined ? s.doneAt - s.startedAt : undefined,
            requests: s.requests,
          },
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------
// 2. Scroll

interface ScrollResult {
  heightPx: number;
  durationMs: number;
  frames: number;
  longTasks: number[];
  pageLongTasks: number[];
  frameP95Ms: number;
  frameMaxMs: number;
  /** Frames that took longer than 2 vsyncs (> 33.4 ms). */
  slowFrames: number;
  /** The longest animation frames, with the scripts that ran in them (attribution for long tasks). */
  worstFrames: { duration: number; blockingDuration: number; renderMs: number; styleAndLayoutMs: number; scripts: string[] }[];
  /** Slow frames (> 2 vsyncs) and long tasks, with the scroll position and the files on screen. */
  incidents: { kind: string; duration: number; at: number; scrollTop: number; files: string[] }[];
}

async function measureScroll(page: Page): Promise<ScrollResult> {
  const frame = viewerFrame(page)!;
  // GitHub's own page, for information (its main thread is a different process from the viewer's).
  await page.evaluate(() => {
    const w = window as unknown as { __perfLong: number[]; __perfObs?: PerformanceObserver };
    w.__perfLong = [];
    w.__perfObs = new PerformanceObserver((list) => list.getEntries().forEach((e) => w.__perfLong.push(e.duration)));
    w.__perfObs.observe({ type: 'longtask' });
  });
  const result = await frame.evaluate(async (speed) => {
    const host = document.querySelector<HTMLElement>('.pierre-diffs')!;
    const scrollable = (e: HTMLElement) => e.scrollHeight > e.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(e).overflowY);
    const scroller = scrollable(host) ? host : [...host.querySelectorAll<HTMLElement>('*')].find(scrollable);
    if (!scroller) throw new Error('CodeView scroller not found');
    const raf = () => new Promise<number>((res) => requestAnimationFrame(res));
    scroller.scrollTop = 0;
    await raf();
    await new Promise((res) => setTimeout(res, 1000));
    await raf();

    // Calibration: a 60 ms task must be reported, or the observer is not working in this frame.
    const seen: number[] = [];
    const probe = new PerformanceObserver((list) => list.getEntries().forEach((e) => seen.push(e.duration)));
    probe.observe({ type: 'longtask' });
    await new Promise<void>((res) =>
      setTimeout(() => {
        const end = performance.now() + 60;
        while (performance.now() < end);
        res();
      }, 0),
    );
    await new Promise((res) => setTimeout(res, 200));
    seen.push(...probe.takeRecords().map((e) => e.duration));
    probe.disconnect();
    const observerOk = seen.some((d) => d >= 55);
    await raf();

    // Where a slow frame or long task happened: time into the scroll, scroll position, files on screen.
    let t0 = 0;
    const viewTop = scroller.getBoundingClientRect().top;
    const where = (at: number) => ({
      at: Math.round(at - t0),
      scrollTop: Math.round(scroller.scrollTop),
      files: [...document.querySelectorAll<HTMLElement>('.fh')]
        .filter((h) => h.getBoundingClientRect().top < viewTop + scroller.clientHeight && h.getBoundingClientRect().top > viewTop - 3000)
        .map((h) => h.dataset.path ?? ''),
    });
    const incidents: { kind: string; duration: number; at: number; scrollTop: number; files: string[] }[] = [];
    const longTasks: number[] = [];
    const loafs: { duration: number; blockingDuration: number; renderMs: number; styleAndLayoutMs: number; scripts: string[] }[] = [];
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.entryType === 'longtask') {
          longTasks.push(e.duration);
          incidents.push({ kind: 'longtask', duration: Math.round(e.duration), ...where(e.startTime) });
        } else {
          const l = e as PerformanceEntry & {
            blockingDuration: number;
            renderStart: number;
            styleAndLayoutStart: number;
            scripts: { invoker: string; sourceURL: string; sourceFunctionName: string; duration: number }[];
          };
          const end = l.startTime + l.duration;
          loafs.push({
            duration: l.duration,
            blockingDuration: l.blockingDuration,
            renderMs: l.renderStart ? end - l.renderStart : 0,
            styleAndLayoutMs: l.styleAndLayoutStart ? end - l.styleAndLayoutStart : 0,
            scripts: l.scripts.map((s) => `${Math.round(s.duration)}ms ${s.invoker} ${s.sourceFunctionName}@${s.sourceURL.split('/').pop()}`),
          });
        }
      }
    });
    obs.observe({ type: 'longtask' });
    if (PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')) obs.observe({ type: 'long-animation-frame' });

    const deltas: number[] = [];
    t0 = await raf();
    let last = t0;
    let atEnd = 0;
    for (;;) {
      const t = await raf();
      deltas.push(t - last);
      if (t - last > 33.4) incidents.push({ kind: 'frame', duration: Math.round(t - last), ...where(t) });
      last = t;
      const max = scroller.scrollHeight - scroller.clientHeight;
      scroller.scrollTop = Math.min(max, ((t - t0) * speed) / 1000);
      // The total height can grow while items are measured: stop at the bottom, twice in a row.
      if (scroller.scrollTop >= max - 1) {
        if (++atEnd >= 2) break;
      } else atEnd = 0;
      if (t - t0 > 15 * 60_000) throw new Error('Scroll did not reach the bottom in 15 min');
    }
    const durationMs = last - t0;
    await new Promise((res) => setTimeout(res, 500));
    for (const e of obs.takeRecords()) if (e.entryType === 'longtask') longTasks.push(e.duration);
    obs.disconnect();
    loafs.sort((a, b) => b.duration - a.duration);
    return { heightPx: scroller.scrollHeight, durationMs, deltas, longTasks, observerOk, worstFrames: loafs.slice(0, 5), incidents };
  }, SCROLL_PX_PER_S);
  const pageLongTasks = await page.evaluate(() => {
    const w = window as unknown as { __perfLong: number[]; __perfObs?: PerformanceObserver };
    w.__perfObs?.disconnect();
    return w.__perfLong;
  });
  expect(result.observerOk, 'the longtask observer reports a calibration task').toBe(true);
  return {
    heightPx: result.heightPx,
    durationMs: result.durationMs,
    frames: result.deltas.length,
    longTasks: result.longTasks,
    pageLongTasks,
    frameP95Ms: percentile(result.deltas, 95),
    frameMaxMs: Math.max(...result.deltas),
    slowFrames: result.deltas.filter((d) => d > 33.4).length,
    worstFrames: result.worstFrames,
    incidents: result.incidents,
  };
}

// ---------------------------------------------------------------------------------------------------------
// 3. Typing

interface TypingResult {
  keys: number;
  /** keydown timeStamp → next requestAnimationFrame callback, per key. */
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  /** keydown → just after the next frame's paint (rAF + message), for information. */
  paintP95Ms: number;
  /** Event Timing entries ≥ 16 ms (duration is rounded to 8 ms by the browser). */
  slowEvents: number;
  typedOk: boolean;
}

/** Blocks writes in a frame (page main world or the viewer): non-GET fetch/XHR throw, attempts are recorded. */
function blockWrites() {
  const w = window as unknown as { __perfWrites: string[]; __perfUnblock?: () => void; XMLHttpRequest: typeof XMLHttpRequest };
  if (w.__perfUnblock) return;
  w.__perfWrites = [];
  const origFetch = window.fetch;
  const origOpen = XMLHttpRequest.prototype.open;
  window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      const url = input instanceof Request ? input.url : String(input);
      w.__perfWrites.push(`${method} ${url}`);
      return Promise.reject(new TypeError('perf test: writes are blocked'));
    }
    return origFetch.call(this, input, init);
  } as typeof fetch;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    if (!/^(GET|HEAD)$/i.test(method)) {
      w.__perfWrites.push(`${method} ${String(url)}`);
      throw new TypeError('perf test: writes are blocked');
    }
    return (origOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;
  w.__perfUnblock = () => {
    window.fetch = origFetch;
    XMLHttpRequest.prototype.open = origOpen;
    delete w.__perfUnblock;
  };
}

async function measureTyping(page: Page): Promise<TypingResult> {
  const frame = viewerFrame(page)!;
  const aborted: string[] = [];
  const routeWrites = async (route: import('@playwright/test').Route) => {
    const req = route.request();
    if (req.method() === 'GET' || req.method() === 'HEAD' || req.method() === 'OPTIONS') return route.fallback();
    aborted.push(`${req.method()} ${req.url()}`);
    return route.abort('blockedbyclient');
  };
  const pattern = /^https:\/\/(api\.)?github\.com\//;
  await page.context().route(pattern, routeWrites);
  await page.evaluate(blockWrites);
  await frame.evaluate(blockWrites);
  // GitHub's own background calls (telemetry, presence) may try too; only these would be a write of ours.
  const ours = (w: string) => /page_data|graphql|file_review|\/preview|\/comments|\/reviews|api\.github\.com\/repos/.test(w);
  let result: TypingResult;
  try {
    // Scroll to the top and open a file-level composer on the first file.
    await frame.evaluate(() => {
      const s = window.__pierre!.store.getState();
      window.__pierre!.session.scrollToFile?.(s.order[0]!);
    });
    const button = frame.locator('[data-testid="comment-on-file"]').first();
    await expect(button).toBeVisible();
    await button.click();
    const box = frame.locator('.composer textarea').first();
    await expect(box).toBeFocused();
    await page.waitForTimeout(1000);

    await frame.evaluate(() => {
      const w = window as unknown as { __perfKeys: number[]; __perfPaint: number[]; __perfEvents: number[]; __perfEvObs?: PerformanceObserver };
      w.__perfKeys = [];
      w.__perfPaint = [];
      w.__perfEvents = [];
      document.addEventListener(
        'keydown',
        (e) => {
          const t0 = e.timeStamp;
          requestAnimationFrame(() => {
            w.__perfKeys.push(performance.now() - t0);
            const ch = new MessageChannel();
            ch.port1.onmessage = () => w.__perfPaint.push(performance.now() - t0);
            ch.port2.postMessage(0);
          });
        },
        true,
      );
      w.__perfEvObs = new PerformanceObserver((list) => list.getEntries().forEach((e) => w.__perfEvents.push(e.duration)));
      w.__perfEvObs.observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit);
    });
    await page.keyboard.type(TYPED, { delay: KEY_DELAY_MS });
    await page.waitForTimeout(500);
    const data = await frame.evaluate(() => {
      const w = window as unknown as { __perfKeys: number[]; __perfPaint: number[]; __perfEvents: number[]; __perfEvObs?: PerformanceObserver };
      w.__perfEvObs?.disconnect();
      return { keys: w.__perfKeys, paint: w.__perfPaint, events: w.__perfEvents, value: document.querySelector<HTMLTextAreaElement>('.composer textarea')?.value };
    });
    result = {
      keys: data.keys.length,
      p50Ms: median(data.keys),
      p95Ms: percentile(data.keys, 95),
      maxMs: Math.max(...data.keys),
      paintP95Ms: percentile(data.paint, 95),
      slowEvents: data.events.length,
      typedOk: data.value === TYPED,
    };
    // Close the composer without posting (Cancel discards the draft).
    await frame.locator('.composer').first().getByRole('button', { name: 'Cancel' }).click();
    await expect(frame.locator('.composer')).toHaveCount(0);
  } finally {
    const attempts = [
      ...aborted,
      ...(await page.evaluate(() => (window as unknown as { __perfWrites?: string[] }).__perfWrites ?? []).catch(() => [])),
      ...(await frame.evaluate(() => (window as unknown as { __perfWrites?: string[] }).__perfWrites ?? []).catch(() => [])),
    ];
    await page.evaluate(() => (window as unknown as { __perfUnblock?: () => void }).__perfUnblock?.()).catch(() => undefined);
    await frame.evaluate(() => (window as unknown as { __perfUnblock?: () => void }).__perfUnblock?.()).catch(() => undefined);
    await page.context().unroute(pattern, routeWrites);
    expect(attempts.filter(ours), 'no write may be attempted while typing').toEqual([]);
  }
  return result;
}

// ---------------------------------------------------------------------------------------------------------

function report(name: string, runs: { load: LoadResult; scroll: ScrollResult; typing?: TypingResult }[]) {
  const stat = (xs: number[]) => ({ median: r(median(xs)), worst: r(Math.max(...xs)), runs: xs.map((x) => r(x)) });
  const summary = {
    pr: name,
    mode: HEADLESS ? 'headless' : 'headed',
    at: new Date().toISOString(),
    firstDiffMs: stat(runs.map((x) => x.load.firstDiffMs)),
    allLoadedMs: stat(runs.map((x) => x.load.allLoadedMs)),
    loaderAllMs: stat(runs.map((x) => x.load.loader?.allMs ?? NaN)),
    viewerNavigations: runs.map((x) => x.load.viewerNavigations),
    scrollMaxLongTaskMs: stat(runs.map((x) => Math.max(0, ...x.scroll.longTasks))),
    scrollLongTasks: runs.map((x) => x.scroll.longTasks.map((t) => r(t))),
    ...(runs[0]?.typing ? { typingP95Ms: stat(runs.map((x) => x.typing!.p95Ms)), typingMaxMs: stat(runs.map((x) => x.typing!.maxMs)) } : {}),
    runs,
  };
  const dir = join(ROOT, 'perf-results');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name.replace(/[^\w]+/g, '-')}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(summary, null, 2));
  const { runs: _runs, ...brief } = summary;
  console.log(JSON.stringify(brief, null, 1));
  console.log(`[perf] written to ${file}`);
  return summary;
}

async function runPr(page: Page, pr: PrId, budgetMs: number, typing: boolean) {
  const runs: { load: LoadResult; scroll: ScrollResult; typing?: TypingResult }[] = [];
  for (let i = 0; i < RUNS; i++) {
    const tab = i === 0 ? page : await page.context().newPage();
    const load = await measureLoad(tab, pr);
    console.log(`[perf] ${pr.repo}#${pr.number} run ${i + 1}: first diff ${Math.round(load.firstDiffMs)} ms, all ${Math.round(load.allLoadedMs)} ms (${load.files} files, ${load.viewerNavigations} viewer loads)`);
    await tab.waitForTimeout(1500);
    const scroll = await measureScroll(tab);
    console.log(`[perf]   scroll ${scroll.heightPx} px in ${Math.round(scroll.durationMs)} ms: long tasks ${JSON.stringify(scroll.longTasks.map(Math.round))}`);
    const typed = typing ? await measureTyping(tab) : undefined;
    if (typed) console.log(`[perf]   typing ${typed.keys} keys: p50 ${r(typed.p50Ms)} ms, p95 ${r(typed.p95Ms)} ms, max ${r(typed.maxMs)} ms`);
    runs.push({ load, scroll, ...(typed ? { typing: typed } : {}) });
    if (tab !== page) await tab.close();
  }
  const summary = report(`${pr.owner}-${pr.repo}-${pr.number}`, runs);
  // Soft checks: every run is reported even when one misses the budget.
  expect.soft(summary.allLoadedMs.worst!, 'whole PR from navigation (worst run)').toBeLessThanOrEqual(budgetMs);
  expect.soft(summary.scrollMaxLongTaskMs.worst!, 'longest long task while scrolling').toBeLessThanOrEqual(50);
  if (typing) {
    expect.soft(summary.typingP95Ms!.worst!, 'p95 keystroke → next frame').toBeLessThan(16);
    for (const run of runs) expect.soft(run.typing!.typedOk, 'typed text arrived intact').toBe(true);
  }
  for (const run of runs) expect.soft(run.load.statuses.error ?? 0, 'files that failed to load').toBe(0);
  for (const run of runs) expect.soft(run.load.headCheck.matches, 'page_data/header headSha = shown head').toBe(true);
}

test.describe('performance budget (read-only)', () => {
  test('react/react#37778: whole PR ≤ 6.5 s, smooth scroll', async ({ page }) => {
    test.setTimeout(30 * 60_000);
    await runPr(page, REACT, 6500, false);
  });

  test('microsoft/vscode#151512: whole PR ≤ 22 s, smooth scroll, fast typing', async ({ page }) => {
    test.setTimeout(60 * 60_000);
    await runPr(page, VSCODE, 22_000, true);
  });
});
