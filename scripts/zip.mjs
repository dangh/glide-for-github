#!/usr/bin/env node
/** Builds dist/ and zips it as `<BRAND.slug>.zip` in the project root (`npm run zip`). Needs the `zip` command. */
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { code } = await transform(readFileSync(resolve(root, 'src/shared/brand.ts'), 'utf8'), { loader: 'ts', format: 'esm' });
const { BRAND } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

execFileSync('node', ['build.mjs'], { cwd: root, stdio: 'inherit' });
const zip = resolve(root, `${BRAND.slug}.zip`);
rmSync(zip, { force: true });
execFileSync('zip', ['-qr', zip, '.'], { cwd: resolve(root, 'dist'), stdio: 'inherit' });
console.log(`wrote ${zip}`);
