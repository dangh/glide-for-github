/**
 * Freshness: tells the user when the PR changed under them (a push), without ever reloading by itself.
 *
 * - The PR's head oid is read (`fetchHeadOid`: one route request, no diff loading) every 60 s while the viewer's
 *   document is visible, and once after each successful write (`noteWrite`). Polling pauses while the tab is
 *   hidden and checks once, immediately, when it becomes visible again.
 * - A head different from the shown one sets `headMoved` (the "This pull request was updated. Reload" banner);
 *   Reload is the soft reload (`reloadPr`), which keeps drafts, open composers and the suggestion batch.
 * - Never two checks at once: a tick during a check joins it; a write during a check runs one more check after it.
 * - A failed check is silent (the next one tries again): a flaky network must not look like an error.
 */
import { fetchHeadOid, type Rpc } from '../github/private';
import { session } from './session';
import { usePr } from './store';

export const POLL_INTERVAL_MS = 60_000;

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
  /** A write succeeded: check (when visible). */
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
  let again = false;

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

  function request(queue: boolean): Promise<void> {
    if (inFlight) {
      if (queue) again = true;
      return inFlight;
    }
    const run = (async () => {
      try {
        do {
          again = false;
          await checkOnce();
        } while (again && visible());
      } finally {
        inFlight = undefined;
        again = false;
      }
    })();
    inFlight = run;
    return run;
  }

  const check = () => request(false);
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
      doc.removeEventListener('visibilitychange', onVisibility);
    },
    check,
    noteWrite() {
      if (visible()) void request(true);
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

/** Call after a successful write: checks the head once (no-op when the poll is not running). */
export function noteWrite(): void {
  active?.noteWrite();
}
