import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it('refuses unpatched Pierre dependencies before replacing the installed build', () => {
  const root = resolve(__dirname, '../..');
  const stale = mkdtempSync(join(tmpdir(), 'glide-unpatched-build-'));
  try {
    for (const file of ['build.mjs', 'scripts/notices.mjs', 'src/shared/brand.ts']) {
      mkdirSync(dirname(join(stale, file)), { recursive: true });
      copyFileSync(join(root, file), join(stale, file));
    }
    const components = join(stale, 'node_modules/@pierre/diffs/dist/components');
    mkdirSync(components, { recursive: true });
    writeFileSync(join(components, 'CodeView.js'), 'export class CodeView {}');
    symlinkSync(join(root, 'node_modules/esbuild'), join(stale, 'node_modules/esbuild'), 'dir');
    mkdirSync(join(stale, 'dist'));
    writeFileSync(join(stale, 'dist/installed.txt'), 'existing build');
    const result = spawnSync(process.execPath, ['build.mjs'], { cwd: stale, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('@pierre/diffs is not patched');
    expect(result.stderr).toContain('npm install');
    expect(readFileSync(join(stale, 'dist/installed.txt'), 'utf8')).toBe('existing build');
  } finally {
    rmSync(stale, { recursive: true, force: true });
  }
});
