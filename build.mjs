import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dist = resolve(root, 'dist');
const r = (...p) => resolve(root, ...p);

const common = {
  bundle: true,
  target: 'chrome120',
  logLevel: 'warning',
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
};

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await Promise.all([
  // Extension pages: ESM with code splitting into dist/chunks/.
  build({
    ...common,
    entryPoints: { viewer: r('src/viewer/main.tsx'), options: r('src/options/options.tsx') },
    outdir: dist,
    format: 'esm',
    splitting: true,
    chunkNames: 'chunks/[name]-[hash]',
    jsx: 'automatic',
  }),
  // Content script and MAIN-world bridge: self-contained IIFEs.
  build({
    ...common,
    entryPoints: { content: r('src/content/index.ts'), bridge: r('src/page/main.ts') },
    outdir: dist,
    format: 'iife',
  }),
  // Pierre's portable worker, bundled as its own entry so its dynamic
  // imports are inlined and the file is self-contained.
  build({
    ...common,
    entryPoints: { 'pierre-worker': r('node_modules/@pierre/diffs/dist/worker/worker-portable.js') },
    outdir: dist,
    format: 'iife',
  }),
]);

await Promise.all([
  cp(r('manifest.json'), resolve(dist, 'manifest.json')),
  cp(r('src/content/content.css'), resolve(dist, 'content.css')),
  cp(r('src/viewer/viewer.html'), resolve(dist, 'viewer.html')),
  cp(r('src/viewer/viewer.css'), resolve(dist, 'viewer.css')),
  cp(r('src/options/options.html'), resolve(dist, 'options.html')),
  cp(r('src/options/options.css'), resolve(dist, 'options.css')),
  cp(r('icons'), resolve(dist, 'icons'), { recursive: true }),
]);
