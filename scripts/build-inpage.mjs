import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';

export async function buildInPage() {
await build({ plugins: [{ name: 'isolated-custom-elements', setup(builder) {
  builder.onLoad({ filter: /components[\\/]web-components\.js$/ }, async ({ path }) => ({
    contents: (await readFile(path, 'utf8')).replace('typeof HTMLElement !== \"undefined\" && customElements.get', 'typeof HTMLElement !== \"undefined\" && customElements != null && customElements.get'),
    loader: 'js',
  }));
} }], entryPoints: ['src/inpage/main.tsx'], bundle: true, outfile: 'dist/inpage.js', format: 'iife', target: 'chrome120', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
await build({ stdin: { contents: "import './node_modules/@pierre/diffs/dist/components/web-components.js'; import './node_modules/@pierre/trees/dist/components/web-components.js';", resolveDir: process.cwd() }, bundle: true, outfile: 'dist/elements.js', format: 'iife', target: 'chrome120' });
const source = await readFile('src/viewer/viewer.css', 'utf8');
const css = source.replaceAll(':root', ':host').replace(/^html(?=[\s,\[.:{])/gm, ':host').replace(/^body(?=[\s,{])/gm, '#root')
  .replace(/:host((?:\[[^\]]+\]|:not\([^)]*\))+)/g, ':host($1)')
  .replace(/^(\[data-file-header=[^\]]+\])/gm, ':host($1)');
await writeFile('dist/inpage.css', css + '\n' + await readFile('src/inpage/layout.css', 'utf8'));
}
