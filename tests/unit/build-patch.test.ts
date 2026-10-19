import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect, it } from 'vitest';

const components = [
  '@pierre/diffs/dist/components/CodeView.js',
  '@pierre/diffs/dist/components/CodeView.d.ts',
  '@pierre/diffs/dist/components/web-components.js',
  '@pierre/trees/dist/components/web-components.js',
];

it.each([
  [components[0]!, 'gapBefore'],
  [components[0]!, 'windowViewport'],
  [components[1]!, 'interface CodeViewWindowViewport'],
  [components[2]!, 'customElements != null'],
  [components[3]!, 'customElements != null'],
])('refuses missing %s / %s before replacing the installed build', (unpatched, missing) => {
  const root = resolve(__dirname, '../..');
  const stale = mkdtempSync(join(tmpdir(), 'glide-unpatched-build-'));
  try {
    for (const file of ['build.mjs', 'scripts/notices.mjs', 'src/shared/brand.ts']) {
      mkdirSync(dirname(join(stale, file)), { recursive: true });
      copyFileSync(join(root, file), join(stale, file));
    }
    for (const file of components) {
      const destination = join(stale, 'node_modules', file);
      mkdirSync(dirname(destination), { recursive: true });
      const source = readFileSync(join(root, 'node_modules', file), 'utf8');
      writeFileSync(destination, file === unpatched ? source.replaceAll(missing, 'unpatched') : source);
    }
    symlinkSync(join(root, 'node_modules/esbuild'), join(stale, 'node_modules/esbuild'), 'dir');
    mkdirSync(join(stale, 'dist'));
    writeFileSync(join(stale, 'dist/installed.txt'), 'existing build');
    const result = spawnSync(process.execPath, ['build.mjs'], { cwd: stale, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`${unpatched} is missing the patched contract`);
    expect(result.stderr).toContain('npm ci');
    expect(readFileSync(join(stale, 'dist/installed.txt'), 'utf8')).toBe('existing build');
  } finally {
    rmSync(stale, { recursive: true, force: true });
  }
});
