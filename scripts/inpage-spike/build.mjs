import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
await import('../../build.mjs');
await build({ entryPoints: ['src/inpage/main.tsx'], bundle: true, outfile: 'dist/inpage.js', format: 'iife', target: 'chrome120', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
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
manifest.web_accessible_resources[0].resources.push('pierre-worker.js', 'inpage.css');
await writeFile('dist/manifest.json', JSON.stringify(manifest, null, 2));
await mkdir('research/inpage-spike', { recursive: true });
await writeFile('research/inpage-spike/index.html', `<!doctype html><meta charset="utf-8"><title>Glide in-page spike harness</title>
<style>body{margin:0}header{height:250px;padding:30px;background:#eee}</style>
<header>GitHub header stand-in, scrolls away with the document</header>
<script src="probe.js"></script><script>__spikeStart({count:500,workers:true})</script>`);
await build({ entryPoints: ['scripts/inpage-spike/probe.mjs'], bundle: true, outfile: 'research/inpage-spike/probe.js', format: 'iife', target: 'chrome120', define: { 'process.env.NODE_ENV': '"production"' } });
