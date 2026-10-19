import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('research/inpage-spike', { recursive: true });
await writeFile('research/inpage-spike/index.html', `<!doctype html><meta charset="utf-8"><title>Glide in-page spike harness</title>
<style>body{margin:0}header{height:250px;padding:30px;background:#eee}</style>
<header>GitHub header stand-in, scrolls away with the document</header>
<script src="probe.js"></script><script>__spikeStart({count:500,workers:true})</script>`);
await build({ entryPoints: ['scripts/inpage-spike/probe.mjs'], bundle: true, outfile: 'research/inpage-spike/probe.js', format: 'iife', target: 'chrome120', define: { 'process.env.NODE_ENV': '"production"' } });
