/**
 * Viewer root: reads the PR, then renders toolbar + tree + virtualized diffs immediately from the
 * summaries while the loader fills in the diffs.
 */
import { WorkerPoolContext } from '@pierre/diffs/react';
import { getOrCreateWorkerPoolSingleton, type WorkerPoolManager } from '@pierre/diffs/worker';
import { useEffect, useMemo } from 'react';
import type { PrRef } from '../shared/pr-url';
import type { DisplaySettings } from '../shared/settings';
import { fetchPrData, fetchThreads, type Rpc } from './github/private';
import { toThreadModels } from './github/threads';
import { startLoader } from './state/controller';
import { session } from './state/session';
import { effectiveThemeType, useSettings } from './state/settings';
import { usePr } from './state/store';
import { DiffPane } from './ui/DiffPane';
import { FatalError, Notice } from './ui/Notice';
import { TokenPromptHost } from './ui/TokenPrompt';
import { Toolbar } from './ui/Toolbar';
import { TreePane } from './ui/TreePane';

const workerRenderOptions = (d: DisplaySettings['diff']) => ({
  theme: { light: d.themeLight, dark: d.themeDark },
  lineDiffType: d.lineDiffType,
  maxLineDiffLength: d.maxLineDiffLength,
  tokenizeMaxLineLength: d.tokenizeMaxLineLength,
});

/** Pierre's worker pool, or undefined (main-thread highlighting) when workers cannot be created. */
function createWorkerPool(settings: DisplaySettings): WorkerPoolManager | undefined {
  try {
    if (typeof Worker === 'undefined') return undefined;
    const url = chrome.runtime.getURL('pierre-worker.js');
    return getOrCreateWorkerPoolSingleton({
      poolOptions: {
        workerFactory: () => new Worker(url, { type: 'module' }),
        poolSize: Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)),
        // A failing pool falls back to main-thread highlighting on its own; keep the console quiet.
        onWorkerError: (event) => event.preventDefault(),
      },
      highlighterOptions: { ...workerRenderOptions(settings.diff), preferredHighlighter: 'shiki-js' },
    });
  } catch {
    return undefined;
  }
}

export function App({ prRef, rpc }: { prRef: PrRef; rpc: Rpc }) {
  const pr = usePr((s) => s.pr);
  const fatal = usePr((s) => s.fatal);
  const range = usePr((s) => s.range);
  const settingsLoaded = useSettings((s) => s.loaded);
  const hideWhitespace = useSettings((s) => s.settings.review.hideWhitespace);
  const diffSettings = useSettings((s) => s.settings.diff);
  const themeType = useSettings((s) => effectiveThemeType(s.settings.diff.themeType, s.colorMode));

  // The pool is created once settings are known (its initial render options come from them).
  const pool = useMemo(() => (settingsLoaded ? createWorkerPool(useSettings.getState().settings) : undefined), [settingsLoaded]);
  useEffect(() => {
    if (!pool) return;
    pool.setRenderOptions(workerRenderOptions(diffSettings)).catch(() => undefined);
  }, [pool, diffSettings]);

  useEffect(() => {
    let cancelled = false;
    fetchPrData(rpc, prRef)
      .then((data) => {
        if (cancelled) return;
        usePr.getState().setPr(data);
        // Threads only feed comment counts here (rendering them is Task 9); failures are not fatal.
        fetchThreads(rpc, prRef, { markers: data.threadMarkers })
          .then((raw) => {
            if (!cancelled) usePr.getState().setThreads(toThreadModels(raw));
          })
          .catch((err: unknown) => console.warn('[pierre] threads', err));
      })
      .catch((err: unknown) => {
        if (!cancelled) usePr.getState().setFatal(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [rpc, prRef]);

  useEffect(() => {
    if (!pr || !settingsLoaded) return;
    startLoader(rpc, hideWhitespace);
  }, [rpc, pr, range, hideWhitespace, settingsLoaded]);
  useEffect(() => () => session.loader?.cancel(), []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = themeType;
    root.style.colorScheme = themeType === 'system' ? 'light dark' : themeType;
  }, [themeType]);

  if (fatal) {
    const filesUrl = `https://github.com/${prRef.owner}/${prRef.repo}/pull/${prRef.number}/files`;
    return <FatalError message={fatal} filesUrl={filesUrl} />;
  }

  return (
    <WorkerPoolContext.Provider value={pool}>
      <div className="pierre-app">
        <Toolbar />
        <div className="pierre-body">
          <TreePane />
          <main className="pierre-main">{pr && settingsLoaded ? <DiffPane rpc={rpc} /> : <div className="pierre-loading">Loading pull request…</div>}</main>
        </div>
        <Notice />
        <TokenPromptHost />
      </div>
    </WorkerPoolContext.Provider>
  );
}
