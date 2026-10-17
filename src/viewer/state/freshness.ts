/**
 * Freshness: tells the user when the PR changed under them (a push), without ever reloading by itself.
 *
 * - The PR's head oid is read (`fetchHeadOid`: one `page_data/header` request, ~5 KB, no diff loading) every 60 s while the viewer's
 *   document is visible, and after a write that can move the head (`noteWrite`: apply suggestions only; viewed,
 *   reactions, resolves and comments cannot, and the route is large on big PRs). Polling pauses while the tab is
 *   hidden and checks once, immediately, when it becomes visible again.
 * - Write-triggered checks are coalesced: debounced by `WRITE_DEBOUNCE_MS`, and skipped when a check finished less
 *   than `WRITE_MIN_GAP_MS` ago (the regular poll catches up).
 * - A head different from the shown one sets `headMoved` (the "This pull request was updated. Reload" banner);
 *   Reload is the soft reload (`reloadPr`), which keeps drafts, open composers and the suggestion batch.
 * - Never two checks at once: a tick or write-triggered check during a check joins it.
 * - A failed check is silent (the next one tries again): a flaky network must not look like an error.
 */
import { fetchHeadOid, type Rpc } from '../github/private';
import { session } from './session';
import { usePr } from './store';

export const POLL_INTERVAL_MS = 60_000;
/** A write-triggered check waits this long (a burst of writes makes one check). */
export const WRITE_DEBOUNCE_MS = 3000;
/** A write-triggered check is skipped when the last check finished less than this long ago. */
export const WRITE_MIN_GAP_MS = 10_000;

export interface FreshnessOptions {
  store?: typeof usePr;
  rpc?: () => Rpc | undefined;
  doc?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  intervalMs?: number;
}

export interface Freshness {
  /** Starts the visibility-aware poll. */
  start(): void;
  stop(): void;
  /** One head check now (joins the one in flight instead of starting another). Resolves when it settles. */
  check(): Promise<void>;
  /** A head-moving write succeeded: check soon (debounced, rate-limited, only while visible). */
  noteWrite(): void;
}

export function createFreshness(options: FreshnessOptions = {}): Freshness {
  const store = options.store ?? usePr;
  const getRpc = options.rpc ?? (() => session.rpc);
  const doc = options.doc ?? document;
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  const visible = () => doc.visibilityState === 'visible';

  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let inFlight: Promise<void> | undefined;
  let writeTimer: ReturnType<typeof setTimeout> | undefined;
  let lastFinishedAt: number | undefined;

  async function checkOnce(): Promise<void> {
    const rpc = getRpc();
    const pr = store.getState().pr;
    // Nothing to compare yet, or the user was already told: no request.
    if (!rpc || !pr || store.getState().headMoved) return;
    try {
      const head = await fetchHeadOid(rpc, pr.ref);
      // Dropped when the PR was reloaded meanwhile (the result is about an older view).
      const now = store.getState();
      if (now.pr === pr && head !== pr.headOid) now.setHeadMoved(true);
    } catch {
      // transient: the next check tries again
    }
  }

  function check(): Promise<void> {
    if (inFlight) return inFlight;
    const run = checkOnce().finally(() => {
      lastFinishedAt = Date.now();
      inFlight = undefined;
    });
    inFlight = run;
    return run;
  }

  const startTimer = () => {
    if (timer === undefined) timer = setInterval(() => void check(), intervalMs);
  };
  const stopTimer = () => {
    clearInterval(timer);
    timer = undefined;
  };
  const onVisibility = () => {
    if (!running) return;
    if (visible()) {
      startTimer();
      void check();
    } else stopTimer();
  };

  return {
    start() {
      if (running) return;
      running = true;
      doc.addEventListener('visibilitychange', onVisibility);
      if (visible()) startTimer();
    },
    stop() {
      running = false;
      stopTimer();
      clearTimeout(writeTimer);
      writeTimer = undefined;
      doc.removeEventListener('visibilitychange', onVisibility);
    },
    check,
    noteWrite() {
      if (!visible()) return; // the check on becoming visible covers it
      clearTimeout(writeTimer);
      writeTimer = setTimeout(() => {
        writeTimer = undefined;
        if (!visible() || (lastFinishedAt !== undefined && Date.now() - lastFinishedAt < WRITE_MIN_GAP_MS)) return;
        void check();
      }, WRITE_DEBOUNCE_MS);
    },
  };
}

let active: Freshness | undefined;

/** Starts the viewer's freshness poll (once); returns its stop function. */
export function startFreshness(options: FreshnessOptions = {}): () => void {
  active?.stop();
  const f = createFreshness(options);
  active = f;
  f.start();
  return () => {
    f.stop();
    if (active === f) active = undefined;
  };
}

/** Call after a successful write that can move the head (apply suggestions): coalesced check; no-op when the poll is not running. */
export function noteWrite(): void {
  active?.noteWrite();
}
