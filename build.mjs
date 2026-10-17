import { build, transform } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dist = resolve(root, 'dist');
const r = (...p) => resolve(root, ...p);

/** BRAND (src/shared/brand.ts, TypeScript) for the static files: transpiled on the fly and imported. */
async function loadBrand() {
  const { code } = await transform(await readFile(r('src/shared/brand.ts'), 'utf8'), { loader: 'ts', format: 'esm' });
  return (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).BRAND;
}
const BRAND = await loadBrand();
const jsonString = (value) => JSON.stringify(value).slice(1, -1);
const htmlText = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Copies a static file replacing the `%BRAND_*%` placeholders (`escape` fits the file's syntax). */
async function copyBranded(from, to, escape) {
  const text = (await readFile(from, 'utf8'))
    .replaceAll('%BRAND_NAME%', () => escape(BRAND.name))
    .replaceAll('%BRAND_DESCRIPTION%', () => escape(BRAND.description));
  await writeFile(to, text);
}

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
  copyBranded(r('manifest.json'), resolve(dist, 'manifest.json'), jsonString),
  cp(r('src/content/content.css'), resolve(dist, 'content.css')),
  copyBranded(r('src/viewer/viewer.html'), resolve(dist, 'viewer.html'), htmlText),
  cp(r('src/viewer/viewer.css'), resolve(dist, 'viewer.css')),
  copyBranded(r('src/options/options.html'), resolve(dist, 'options.html'), htmlText),
  cp(r('src/options/options.css'), resolve(dist, 'options.css')),
  cp(r('icons'), resolve(dist, 'icons'), { recursive: true }),
]);
