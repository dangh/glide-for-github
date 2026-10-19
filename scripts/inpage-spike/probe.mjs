/** Rerunnable synthetic probe. Run the bundle with DevTools/evaluate on a PR page or local harness. */
import '../../src/inpage/windowScroll';
import { setInsetTop } from '../../src/inpage/windowScroll';
import { CodeView, parseDiffFromFile } from '@pierre/diffs';
import { WorkerPoolManager } from '@pierre/diffs/worker';

window.__spikeStart = async ({ mode = 'page', count = 500, workers = false } = {}) => {
  window.__spike?.cleanUp();
  const host = document.createElement('div');
  host.id = 'glide-scroll-probe';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `:host { display:block; color:#1f2328; font:14px/1.5 system-ui; background:white; }
    * { box-sizing:border-box; } .bar {position:sticky;top:0;z-index:100;background:#f6f8fa;padding:12px;border:1px solid #aaa;height:56px;}
    .list { overflow:visible; display:flow-root; --glide-sticky-top:56px; } .header {position:sticky;top:0;background:#eee;height:36px;padding:6px;border:1px solid #aaa;}
    textarea { font:14px monospace; }`;
  const bar = document.createElement('div');
  bar.className = 'bar';
  bar.innerHTML = '<b>Throwaway Glide scroll probe</b> <textarea aria-label="Probe comment" rows="1" placeholder="Type a comment"></textarea>';
  const list = document.createElement('div');
  list.className = 'list';
  shadow.append(style, bar, list);
  const anchor = document.querySelector('nav[aria-label="Pull request tabs"]');
  const parent = anchor?.closest('header') ?? anchor?.closest('.tabnav');
  const hidden = [];
  if (parent) {
    for (let e = parent.nextElementSibling; e; e = e.nextElementSibling) {
      hidden.push([e, e.getAttribute('style')]);
      e.style.display = 'none';
    }
    parent.after(host);
  } else document.body.append(host);
  let pool;
  const workerErrors = [];
  if (workers) {
    pool = new WorkerPoolManager({ workerFactory: () => new Worker('/dist/pierre-worker.js'), poolSize: 2, onWorkerError: e => workerErrors.push(e.message) }, { preferredHighlighter: 'shiki-js', theme: { light: 'github-light', dark: 'github-dark' } });
    await pool.initialize();
  }
  setInsetTop(() => 56);
  const view = new CodeView({ theme: { light: 'github-light', dark: 'github-dark' }, themeType: 'light', diffStyle: 'split', stickyHeaders: true, pointerEventsOnScroll: true, layout: { paddingTop: 8, paddingBottom: 8, gap: 16 }, renderCustomHeader(item) { const el = document.createElement('div'); el.className = 'header'; el.textContent = item.name; return el; } }, pool);
  // The baseline uses the original element scroller methods, saved before installing the window adapter.
  if (mode === 'frame') Object.assign(view, window.__spikeOriginal);
  const oldLines = Array.from({length: 160}, (_, i) => `export const value${i}: number = ${i};\n`).join('');
  const newLines = oldLines.replaceAll(': number', ': string').replace(/= (\d+);/g, '= "$1";');
  const items = Array.from({length: count}, (_, i) => ({type:'diff', id:`src/file-${i}.ts`, fileDiff:parseDiffFromFile({name:`src/file-${i}.ts`,contents:oldLines,cacheKey:`old-${i}`},{name:`src/file-${i}.ts`,contents:newLines,cacheKey:`new-${i}`})}));
  if (mode === 'frame') list.style.cssText = 'height:650px;overflow:auto';
  view.setup(list);
  if (mode === 'frame') list.style.setProperty('--glide-sticky-top', '0px');
  view.setItems(items);
  window.__spike = { view, host, shadow, list, pool, workerErrors, mode, count, cleanUp() { view.cleanUp(); pool?.terminate(); host.remove(); for(const [e,s] of hidden) {if(s===null)e.removeAttribute('style');else e.setAttribute('style',s)} } };
  return { mode, count, workers: pool?.isWorkingPool() ?? false, workerErrors };
};
