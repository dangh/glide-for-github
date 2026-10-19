/** Read-only packaged-build comparison. Both builds use identical copied settings and real GitHub PRs. */
import { chromium } from '@playwright/test';
import { cp, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir, homedir, loadavg, cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { readdirSync } from 'node:fs';

const source = process.env.PIERRE_SPIKE_PROFILE;
const baseline = process.env.PIERRE_BASELINE_DIST;
if (!source || !baseline) throw new Error('Set PIERRE_SPIKE_PROFILE and PIERRE_BASELINE_DIST');
const chrome = process.env.PIERRE_E2E_CHROME ?? join(homedir(), '.agent-browser/browsers', readdirSync(join(homedir(), '.agent-browser/browsers')).filter(n => n.startsWith('chrome-')).sort().at(-1), 'chrome');
const id = path => [...createHash('sha256').update(path).digest('hex').slice(0, 32)].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
const temp = await mkdtemp(join(tmpdir(), 'glide-compare-'));
const output = process.env.PIERRE_COMPARE_OUTPUT ?? '/tmp/glide-production-comparison.json';
const sides = [{ name: 'iframe', dist: resolve(baseline) }, { name: 'inpage', dist: resolve('dist') }];
const runs = Number(process.env.PIERRE_COMPARE_RUNS ?? 5);
const profiling = process.env.PIERRE_COMPARE_PROFILE === '1';
for (const side of sides) side.digest = createHash('sha256').update(await readFile(join(side.dist, side.name === 'inpage' ? 'inpage.js' : 'viewer.js'))).digest('hex');
const records = [];
const meta = { profiling, chrome, cores: cpus().length, load: loadavg(), runs, viewport: [1280, 800], scrollFrames: 180, pixelsPerFrame: 160, typedCharacters: 100, keyDelayMs: 20, builds: sides.map(({ name, digest }) => ({ name, digest })) };
const percentile = (xs, p) => [...xs].sort((a,b) => a-b)[Math.min(xs.length-1, Math.ceil(xs.length*p)-1)];
try {
  for (const side of sides) {
    side.profile = join(temp, side.name);
    await cp(source, side.profile, { recursive: true, filter: path => !/Singleton|\/(Cache|Code Cache|GPUCache|Service Worker)(\/|$)/.test(path) });
    const local = join(side.profile, 'Default', 'Local Extension Settings');
    const old = join(local, id(join(dirname(source), 'dist')));
    const target = join(local, id(side.dist));
    if (old !== target) { await rm(target, { recursive: true, force: true }); await cp(old, target, { recursive: true }); }
  }
  for (let run = 0; run < runs; run++) for (const side of sides) {
    const context = await chromium.launchPersistentContext(side.profile, { executablePath: chrome, headless: true, viewport: { width: 1280, height: 800 }, args: [`--disable-extensions-except=${side.dist}`, `--load-extension=${side.dist}`] });
    try {
      const settings = await context.newPage();
      await settings.goto(`chrome-extension://${id(side.dist)}/options.html`);
      await settings.evaluate(async () => {
        const old = (await chrome.storage.sync.get('pierre.settings'))['pierre.settings'];
        await chrome.storage.sync.set({ 'pierre.settings': { ...old, diff: { ...old?.diff, diffStyle: 'split' }, experiments: { pageScroll: true, mergedBar: true } } });
      });
      await settings.close();
      for (const pr of ['react/react/pull/37778', 'microsoft/vscode/pull/151512']) {
        const page = await context.newPage();
        const errors = []; const httpErrors = []; let loader;
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (/\[pierre\] \d+ files:/.test(m.text())) loader = m.text(); });
        page.on('response', r => { if (r.status() >= 400 && /\/changes|\/diff|api\.github\.com/.test(r.url())) httpErrors.push({ status: r.status(), url: r.url() }); });
        const started = Date.now();
        await page.goto(`https://github.com/${pr}#glide`, { waitUntil: 'commit' });
        const root = side.name === 'inpage' ? page.locator('#glide-inpage-spike') : page.frameLocator('iframe[data-pierre-viewer]');
        await root.locator('[data-line]').first().waitFor({ state: 'visible', timeout: 120000 });
        const firstLineMs = Date.now() - started;
        const deadline = Date.now() + 120000;
        while (!loader && Date.now() < deadline) await page.waitForTimeout(50);
        if (!loader) throw new Error(`${side.name} ${pr}: loader did not finish`);
        const allLoadedMs = Date.now() - started;
        const frame = side.name === 'inpage' ? page.mainFrame() : page.frames().find(f => f.url().includes('/viewer.html'));
        if (!frame) throw new Error('Missing viewer frame');
        const profiler = profiling ? await context.newCDPSession(frame) : null;
        if (profiler) { await profiler.send('Profiler.enable'); await profiler.send('Profiler.start'); }
        const work = await frame.evaluate(() => {
          const scope = document.querySelector('#glide-inpage-spike')?.shadowRoot ?? document;
          return { files: scope.querySelector('[data-testid="viewed-counter"]')?.textContent, text: scope.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-line]')?.textContent };
        });
        await page.evaluate(() => scrollTo(0, 500));
        await page.waitForTimeout(300);
        // The iframe renders in another process; sample the renderer as well as the outer page.
        await frame.evaluate(() => {
          const sample = window.__scrollSample = { intervals: [], tasks: [], last: null, raf: 0 };
          const tick = now => {
            if (sample.last !== null) sample.intervals.push(now - sample.last);
            sample.last = now;
            sample.raf = requestAnimationFrame(tick);
          };
          sample.observer = new PerformanceObserver(list => sample.tasks.push(...list.getEntries().map(e => e.duration)));
          sample.observer.observe({ type: 'longtask' });
          sample.raf = requestAnimationFrame(tick);
        });
        const scroll = await page.evaluate(async ({ frames, increment }) => {
          const intervals = [], tasks = [];
          const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(e => e.duration)));
          observer.observe({ type: 'longtask' });
          let last = await new Promise(requestAnimationFrame);
          const initial = scrollY;
          for (let i = 0; i < frames; i++) {
            scrollBy(0, increment);
            const now = await new Promise(requestAnimationFrame);
            intervals.push(now-last); last=now;
          }
          tasks.push(...observer.takeRecords().map(e=>e.duration)); observer.disconnect();
          return { intervals, tasks, initial, final: scrollY, height: document.documentElement.scrollHeight };
        }, { frames: 180, increment: 160 });
        scroll.pageIntervals = scroll.intervals;
        scroll.pageTasks = scroll.tasks;
        Object.assign(scroll, await frame.evaluate(() => {
          const sample = window.__scrollSample;
          cancelAnimationFrame(sample.raf);
          sample.tasks.push(...sample.observer.takeRecords().map(e => e.duration));
          sample.observer.disconnect();
          return { intervals: sample.intervals, tasks: sample.tasks };
        }));
        if (scroll.intervals.length < 150) throw new Error('Renderer failed to produce enough frames during scrolling');
        const after = await frame.evaluate(() => {
          const scope = document.querySelector('#glide-inpage-spike')?.shadowRoot ?? document;
          const files = [...scope.querySelectorAll('.fh')].map(el=>el.getAttribute('data-path'));
          const diffs = [...scope.querySelectorAll('diffs-container')];
          return { files, lines: diffs.reduce((n,el)=>n+(el.shadowRoot?.querySelectorAll('[data-line]').length ?? 0),0), highlighted: diffs.reduce((n,el)=>n+(el.shadowRoot?.querySelectorAll('[data-line] span[style]').length ?? 0),0) };
        });
        if (scroll.final <= scroll.initial || after.lines === 0 || after.highlighted === 0) throw new Error('Scroll produced no highlighted code');
        await page.evaluate(() => scrollTo(0,0));
        const comment = root.getByRole('button', { name: 'Comment on file', exact: true }).first();
        await comment.click();
        const editor = root.locator('.composer textarea');
        await editor.waitFor({state:'visible'});
        await editor.focus();
        await frame.evaluate(() => {
          window.__typingTimes = [];
          const scope = document.querySelector('#glide-inpage-spike')?.shadowRoot ?? document;
          scope.querySelector('.composer textarea').addEventListener('keydown', e => requestAnimationFrame(() => window.__typingTimes.push(performance.now()-e.timeStamp)));
        });
        const typed = 'Review typing performance sample. '.repeat(4).slice(0,100);
        await page.keyboard.type(typed, { delay:20 });
        if (await editor.inputValue() !== typed) throw new Error('Typed text was lost');
        const typing = await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(window.__typingTimes))));
        await root.locator('.composer').getByRole('button', {name:'Cancel',exact:true}).click();
        if (profiler) {
          const { profile } = await profiler.send('Profiler.stop');
          await writeFile(`${output}.${side.name}.${pr.split('/')[1]}.cpuprofile`, JSON.stringify(profile));
          await profiler.detach();
        }
        const workers = side.name === 'inpage' ? await page.frames().find(f=>f.url().includes('/worker-host.html'))?.evaluate(()=>window.__glideWorkerHost) : undefined;
        if (workers && (!workers.renders || workers.errors)) throw new Error('Native highlighting workers did not complete cleanly');
        const record = { run:run+1, side:side.name, pr, firstLineMs, allLoadedMs, loader, work, after, scroll:{ ...scroll, p95Ms:percentile(scroll.intervals,.95) }, typing:{ count:typing.length, p95Ms:percentile(typing,.95), maxMs:Math.max(...typing) }, errors,httpErrors,workers };
        records.push(record);
        await writeFile(output, JSON.stringify({meta,records},null,2));
        console.log(JSON.stringify({run:record.run,side:record.side,pr,firstLineMs,allLoadedMs,scrollP95:record.scroll.p95Ms,typingP95:record.typing.p95Ms,errors:errors.length,httpErrors:httpErrors.length,lines:after.lines}));
        await page.close();
      }
    } finally { await context.close(); }
  }
} finally { await rm(temp,{recursive:true,force:true}); }
