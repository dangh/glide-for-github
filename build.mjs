import { build, transform } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderNotices } from './scripts/notices.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const dist = resolve(root, 'dist');
const r = (...p) => resolve(root, ...p);

/** BRAND (src/shared/brand.ts, TypeScript) for the static files: transpiled on the fly and imported. */
async function loadBrand() {
  const { code } = await transform(await readFile(r('src/shared/brand.ts'), 'utf8'), { loader: 'ts', format: 'esm' });
  return (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).BRAND;
}
const BRAND = await loadBrand();

// Fail before emitting a bundle if a dependency update or skipped postinstall lost the compatibility contract.
const patchContracts = [
  ['@pierre/diffs/dist/components/CodeView.js', ['gapBefore', 'windowViewport', 'refreshViewport =', 'resetScrollPage()']],
  ['@pierre/diffs/dist/components/CodeView.d.ts', ['interface CodeViewWindowViewport', 'windowViewport?: CodeViewWindowViewport']],
  ...['diffs', 'trees'].map(name => [
    `@pierre/${name}/dist/components/web-components.js`,
    ['typeof HTMLElement !== "undefined" && customElements != null && customElements.get'],
  ]),
];
for (const [file, required] of patchContracts) {
  const source = await readFile(r('node_modules', file), 'utf8');
  for (const token of required) {
    if (!source.includes(token)) throw new Error(`${file} is missing the patched contract ${token}. Run npm ci before building.`);
  }
}
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
  build({
    ...common,
    entryPoints: { inpage: r('src/inpage/main.tsx') },
    outdir: dist,
    format: 'iife',
    jsx: 'automatic',
  }),
  build({
    ...common,
    stdin: {
      contents: "import './node_modules/@pierre/diffs/dist/components/web-components.js'; import './node_modules/@pierre/trees/dist/components/web-components.js';",
      resolveDir: root,
    },
    outfile: resolve(dist, 'elements.js'),
    format: 'iife',
  }),
  // Extension pages: ESM with code splitting into dist/chunks/.
  build({
    ...common,
    entryPoints: { options: r('src/options/options.tsx') },
    outdir: dist,
    format: 'esm',
    splitting: true,
    chunkNames: 'chunks/[name]-[hash]',
    jsx: 'automatic',
  }),
  // Content script and MAIN-world bridge: self-contained IIFEs.
  build({
    ...common,
    entryPoints: { bridge: r('src/page/main.ts'), 'worker-host': r('src/inpage/workerHost.ts') },
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
  cp(r('src/inpage/worker-host.html'), resolve(dist, 'worker-host.html')),
  cp(r('src/viewer/viewer.css'), resolve(dist, 'viewer.css')),
  copyBranded(r('src/options/options.html'), resolve(dist, 'options.html'), htmlText),
  cp(r('src/options/options.css'), resolve(dist, 'options.css')),
  cp(r('icons'), resolve(dist, 'icons'), { recursive: true }),
  // Licenses of the bundled production dependencies (Pierre's packages are Apache-2.0 and must travel with the zip).
  writeFile(resolve(dist, 'THIRD_PARTY_NOTICES.txt'), renderNotices(root)),
]);

const source = await readFile(r('src/viewer/viewer.css'), 'utf8');
const css = source.replaceAll(':root', ':host').replace(/^html(?=[\s,\[.:{])/gm, ':host').replace(/^body(?=[\s,{])/gm, '#root')
  .replace(/:host((?:\[[^\]]+\]|:not\([^)]*\))+)/g, ':host($1)')
  .replace(/^(\[data-file-header=[^\]]+\])/gm, ':host($1)');
await writeFile(resolve(dist, 'inpage.css'), css + '\n' + await readFile(r('src/inpage/layout.css'), 'utf8'));
