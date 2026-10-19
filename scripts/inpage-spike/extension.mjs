import { build } from 'esbuild';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
export async function buildInPageSpike() {
await build({ plugins: [{ name: 'isolated-custom-elements', setup(builder) {
  builder.onLoad({ filter: /components[\\/]web-components\.js$/ }, async ({ path }) => ({
    contents: (await readFile(path, 'utf8')).replace('typeof HTMLElement !== \"undefined\" && customElements.get', 'typeof HTMLElement !== \"undefined\" && customElements != null && customElements.get'),
    loader: 'js',
  }));
} }], entryPoints: ['src/inpage/main.tsx'], bundle: true, outfile: 'dist/inpage.js', format: 'iife', target: 'chrome120', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
await build({ stdin: { contents: "import './node_modules/@pierre/diffs/dist/components/web-components.js'; import './node_modules/@pierre/trees/dist/components/web-components.js';", resolveDir: process.cwd() }, bundle: true, outfile: 'dist/elements.js', format: 'iife', target: 'chrome120' });
await build({ entryPoints: ['src/inpage/workerHost.ts'], bundle: true, outfile: 'dist/worker-host.js', format: 'iife', target: 'chrome120' });
await writeFile('dist/worker-host.html', await readFile('src/inpage/worker-host.html'));
const source = await readFile('src/viewer/viewer.css', 'utf8');
const css = source.replaceAll(':root', ':host').replace(/\bhtml(?=[\s,\[.:{])/g, ':host').replace(/\bbody(?=[\s,{])/g, '#root')
  .replace(/:host((?:\[[^\]]+\]|:not\([^)]*\))+)/g, ':host($1)')
  .replace(/^(\[data-file-header=[^\]]+\])/gm, ':host($1)');
await writeFile('dist/inpage.css', css + `
:host { display: block; contain: style; --gutter: 1px; }
#root { height: auto; overflow: visible; }
.pierre-app { height: auto; }
.pierre-body { align-items: flex-start; }
.pierre-main, .pierre-diffs { height: auto; overflow: visible; overscroll-behavior: auto; }
.pierre-toolbar { position: sticky; top: 0; z-index: 50; background: var(--pierre-bg); }
.pierre-tree-pane { position: sticky; top: 60px; height: calc(100vh - 60px); }
`);
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
manifest.name += ' (IN-PAGE SPIKE)';
manifest.content_scripts[0].js = ['inpage.js'];
manifest.content_scripts[1].js = ['elements.js', 'bridge.js'];
manifest.web_accessible_resources[0].resources = ['chunks/*', '*.css', 'worker-host.html'];
await writeFile('dist/manifest.json', JSON.stringify(manifest, null, 2));
await mkdir('research/inpage-spike', { recursive: true });
await writeFile('research/inpage-spike/index.html', `<!doctype html><meta charset="utf-8"><title>Glide in-page spike harness</title>
<style>body{margin:0}header{height:250px;padding:30px;background:#eee}</style>
<header>GitHub header stand-in, scrolls away with the document</header>
<script src="probe.js"></script><script>__spikeStart({count:500,workers:true})</script>`);
await build({ entryPoints: ['scripts/inpage-spike/probe.mjs'], bundle: true, outfile: 'research/inpage-spike/probe.js', format: 'iife', target: 'chrome120', define: { 'process.env.NODE_ENV': '"production"' } });

  // An old content script must not be able to mount the iframe from this build.
  await Promise.all(['content.js', 'viewer.html', 'viewer.js'].map(file => rm(`dist/${file}`, { force: true })));
}
