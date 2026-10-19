/**
 * Viewer root: reads the PR, then renders toolbar + tree + virtualized diffs immediately from the
 * summaries while the loader fills in the diffs.
 */
import { WorkerPoolContext } from '@pierre/diffs/react';
import { getOrCreateWorkerPoolSingleton, type WorkerPoolManager } from '@pierre/diffs/worker';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { resolveDiff } from '../shared/github-defaults';
import { filesChangedUrl, type PrRef } from '../shared/pr-url';
import type { DisplaySettings } from '../shared/settings';
import { PORT_TIMEOUT_MESSAGE } from './connection';
import type { Rpc } from './github/private';
import { startLoader } from './state/controller';
import { useFileGroups } from './state/fileGroups';
import { loadPr } from './state/load';
import { useRelatedRules } from './state/relatedFiles';
import { session } from './state/session';
import { effectiveThemeType, useSettings } from './state/settings';
import { usePr } from './state/store';
import { BatchBar, CommitDialogHost } from './ui/ApplySuggestions';
import { DiffPane } from './ui/DiffPane';
import { DisplayStyle } from './ui/DisplayStyle';
import { FatalError, Notice } from './ui/Notice';
import { TokenPromptHost } from './ui/TokenPrompt';
import { Toolbar } from './ui/Toolbar';
import { TreePane } from './ui/TreePane';
import { viewerRoot } from './rootEl';

const workerRenderOptions = (diff: DisplaySettings['diff']) => {
  const d = resolveDiff(diff);
  return {
    theme: { light: d.themeLight, dark: d.themeDark },
    lineDiffType: d.lineDiffType,
    maxLineDiffLength: d.maxLineDiffLength,
    tokenizeMaxLineLength: d.tokenizeMaxLineLength,
  };
};

/** SPIKE (in-page): how highlighting runs; `'main'` is no pool (main-thread highlighting). */
export const workerSpike: { factory?: (() => Worker) | 'main'; poolSize?: number } = {};

/** Pierre's worker pool, or undefined (main-thread highlighting) when workers cannot be created. */
function createWorkerPool(settings: DisplaySettings, reportFailure?: (message: string) => void): WorkerPoolManager | undefined {
  try {
    if (typeof Worker === 'undefined' || workerSpike.factory === 'main') return undefined;
    const url = chrome.runtime.getURL('pierre-worker.js');
    return getOrCreateWorkerPoolSingleton({
      poolOptions: {
        workerFactory: workerSpike.factory ?? (() => new Worker(url, { type: 'module' })),
        poolSize: workerSpike.poolSize ?? Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)),
        // Surface in-page failures; the original frame keeps its existing fallback behavior.
        onWorkerError: (event) => {
          event.preventDefault();
          reportFailure?.(event instanceof ErrorEvent ? event.message : 'Worker failed to start');
        },
      },
      highlighterOptions: { ...workerRenderOptions(settings.diff), preferredHighlighter: 'shiki-js' },
    });
  } catch (error) {
    // Pool creation happens during render; report setup failures after it completes.
    queueMicrotask(() => reportFailure?.(error instanceof Error ? error.message : String(error)));
    return undefined;
  }
}

export function App({ prRef, rpc }: { prRef: PrRef; rpc: Rpc }) {
  const pr = usePr((s) => s.pr);
  const fatal = usePr((s) => s.fatal);
  const range = usePr((s) => s.range);
  const settingsLoaded = useSettings((s) => s.loaded);
  const fileGroupsLoaded = useFileGroups((s) => s.loaded);
  const rulesLoaded = useRelatedRules((s) => s.loaded);
  // The list and the loader wait for the related-files rules too, so companions never jump into place.
  const groupsLoaded = fileGroupsLoaded && rulesLoaded;
  const hasGroups = useFileGroups((s) => s.groups.length > 0);
  const groupsEnabled = useSettings((s) => s.settings.fileGroups.enabled);
  const fileCount = usePr((s) => s.order.length);
  const showGroupPanel = groupsEnabled && groupsLoaded && hasGroups && fileCount > 0;
  const hideWhitespace = useSettings((s) => s.settings.review.hideWhitespace);
  const diffSettings = useSettings((s) => s.settings.diff);
  const themeType = useSettings((s) => effectiveThemeType(s.settings.diff.themeType, s.colorMode));
  const treePosition = useSettings((s) => s.settings.layout.treePosition);
  const showTree = useSettings((s) => s.settings.layout.showTree);

  const [workerFailure, setWorkerFailure] = useState<string>();
  // The pool is created once settings are known (its initial render options come from them).
  const pool = useMemo(() => (settingsLoaded ? createWorkerPool(useSettings.getState().settings, typeof workerSpike.factory === 'function' ? setWorkerFailure : undefined) : undefined), [settingsLoaded]);
  useEffect(() => {
    if (!pool) return;
    pool.setRenderOptions(workerRenderOptions(diffSettings)).catch(() => undefined);
  }, [pool, diffSettings]);

  // "Try again" after a failed load: bumping `attempt` re-runs the load.
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    usePr.getState().setFatal(null);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Threads render inline (annotations) and feed the comment counts; their failure is not fatal.
    // Only the first load may use the route prefetched during page load; "Try again" reads it fresh.
    loadPr(rpc, prRef, () => !cancelled, { initial: attempt === 0 })
      .catch((err: unknown) => {
        if (!cancelled) usePr.getState().setFatal(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [rpc, prRef, attempt]);

  useEffect(() => {
    if (!pr || !settingsLoaded || !groupsLoaded) return;
    startLoader(rpc, hideWhitespace);
  }, [rpc, pr, range, hideWhitespace, settingsLoaded, groupsLoaded]);
  useEffect(() => () => session.loader?.cancel(), []);

  useEffect(() => {
    const root = viewerRoot.el;
    root.dataset.theme = themeType;
    root.style.colorScheme = themeType === 'system' ? 'light dark' : themeType;
  }, [themeType]);

  if (workerFailure) return <FatalError message={`Glide highlighting failed: ${workerFailure}`} filesUrl={filesChangedUrl(prRef)} />;

  if (fatal) {
    // No port (extension updated): only a page reload helps, so no Try again.
    return <FatalError message={fatal} filesUrl={filesChangedUrl(prRef)} onRetry={fatal === PORT_TIMEOUT_MESSAGE ? undefined : retry} />;
  }

  return (
    <WorkerPoolContext.Provider value={pool}>
      <div className="pierre-app">
        <DisplayStyle />
        <Toolbar />
        <BatchBar />
        {/* DOM order follows the visual order (tree first or last), so keyboard focus order matches the screen. */}
        {/* A hidden tree stays mounted (display: none), so its expanded folders and filter survive a collapse. */}
        <div
          className="pierre-body"
          id="file-group-panel"
          role={showGroupPanel ? 'tabpanel' : undefined}
          aria-label={showGroupPanel ? 'Changed files' : undefined}
          data-tree-position={treePosition}
          data-tree-hidden={showTree ? undefined : ''}
        >
          {treePosition === 'left' && <TreePane />}
          {/* The list waits for the file groups too, so it never shows other groups' files first (Sift's no-flash fix). */}
          <main className="pierre-main">
            {pr && settingsLoaded && groupsLoaded ? <DiffPane rpc={rpc} /> : <div className="pierre-loading">Loading pull request…</div>}
          </main>
          {treePosition === 'right' && <TreePane />}
        </div>
        <Notice />
        <CommitDialogHost />
        {viewerRoot.scope instanceof Document && <TokenPromptHost />}
      </div>
    </WorkerPoolContext.Provider>
  );
}
