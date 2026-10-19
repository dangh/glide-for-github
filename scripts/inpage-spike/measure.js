window.__spikeMeasure = async function () {
  const rows = [];
  for (let run = 0; run < 5; run++) {
    for (const mode of ['page', 'frame']) {
      scrollTo({ top: 0, behavior: 'instant' });
      await __spikeStart({ mode, count: 500, workers: true });
      const s = __spike;
      await new Promise(r => setTimeout(r, 200));
      const times = [];
      const renders = [];
      const render = s.view.computeRenderRangeAndEmit;
      s.view.computeRenderRangeAndEmit = function (...args) {
        const start = performance.now();
        try { return render.apply(this, args); }
        finally { renders.push(performance.now() - start); }
      };
      let previous;
      for (let frame = 0; frame < 120; frame++) {
        const now = await new Promise(requestAnimationFrame);
        if (previous !== undefined) times.push(now - previous);
        previous = now;
        const top = frame * 120;
        if (mode === 'page') scrollTo({ top, behavior: 'instant' });
        else s.list.scrollTo({ top, behavior: 'instant' });
      }
      await new Promise(r => setTimeout(r, 150));
      times.sort((a, b) => a - b);
      renders.sort((a, b) => a - b);
      const nodes = [...s.shadow.querySelectorAll('diffs-container')];
      rows.push({ run, mode, frames:times.length, p50FrameMs:times[Math.floor(times.length*.5)], p95FrameMs:times[Math.floor(times.length*.95)], worstFrameMs:times.at(-1), renderCalls:renders.length, p95RenderMs:renders[Math.floor(renders.length*.95)], first:s.view.renderState.firstIndex, last:s.view.renderState.lastIndex, mounted:nodes.length, tokens:nodes.reduce((n,e)=>n+e.shadowRoot.querySelectorAll('span[style]').length,0), workers:s.pool.getStats(), workerErrors:s.workerErrors });
    }
  }
  return rows;
};
