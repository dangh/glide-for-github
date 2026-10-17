import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { BRAND } from '../../src/shared/brand';

const root = resolve(__dirname, '../..');
const dist = join(root, 'dist');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

interface Manifest {
  name?: string;
  description?: string;
  icons?: Record<string, string>;
  options_page?: string;
  content_scripts?: { js?: string[]; css?: string[] }[];
  web_accessible_resources?: { resources: string[] }[];
}

describe('build output', () => {
  let manifest: Manifest;

  beforeAll(() => {
    execFileSync('node', ['build.mjs'], { cwd: root, stdio: 'pipe' });
    manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
  });

  it('emits every file referenced by dist/manifest.json', () => {
    const refs = new Set<string>();
    for (const cs of manifest.content_scripts ?? []) {
      for (const f of [...(cs.js ?? []), ...(cs.css ?? [])]) refs.add(f);
    }
    if (manifest.options_page) refs.add(manifest.options_page);
    for (const f of Object.values(manifest.icons ?? {})) refs.add(f);
    for (const war of manifest.web_accessible_resources ?? []) {
      // Only concrete filenames; globs such as chunks/* or *.css are skipped.
      for (const r of war.resources) if (!r.includes('*')) refs.add(r);
    }
    expect(refs.size).toBeGreaterThan(0);
    const missing = [...refs].filter((f) => !existsSync(join(dist, f)));
    expect(missing).toEqual([]);
  });

  it('emits every stylesheet and script that the HTML pages reference', () => {
    for (const page of ['options.html', 'viewer.html']) {
      const html = readFileSync(join(dist, page), 'utf8');
      const refs = [...html.matchAll(/(?:href|src)=["']([^"']+)["']/g)].map((m) => m[1]!);
      expect(refs.length, page).toBeGreaterThan(0);
      const missing = refs.filter((f) => !existsSync(join(dist, f)));
      expect(missing, page).toEqual([]);
    }
  });

  it("takes the product name and description from BRAND (one place to rename)", () => {
    expect(manifest.name).toBe(BRAND.name);
    expect(manifest.description).toBe(BRAND.description);
    expect(BRAND.description.length).toBeLessThanOrEqual(132); // Chrome Web Store limit for the manifest description
    expect(BRAND.name).toBe('Glide for GitHub');
    expect(BRAND.description).toContain('Pierre');
    for (const page of ['options.html', 'viewer.html']) {
      const html = readFileSync(join(dist, page), 'utf8');
      expect(html, page).toContain(`<title>${BRAND.name}`);
      expect(html, page).not.toContain('%BRAND');
    }
    expect(readFileSync(join(dist, 'manifest.json'), 'utf8')).not.toContain('%BRAND');
  });

  it('ships THIRD_PARTY_NOTICES.txt with the licenses of the bundled dependencies', () => {
    const notices = readFileSync(join(dist, 'THIRD_PARTY_NOTICES.txt'), 'utf8');
    expect(notices).toContain('@pierre/diffs');
    expect(notices).toContain('@pierre/trees');
    expect(notices).toContain('Apache License');
    expect(notices).toContain('react');
    // Production dependencies only: dev tooling is not in the package.
    expect(notices).not.toContain('vitest');
    expect(notices).not.toContain('esbuild');
  });

  it('emits the Pierre worker as a self-contained dist/pierre-worker.js', () => {
    const worker = readFileSync(join(dist, 'pierre-worker.js'), 'utf8');
    expect(worker.length).toBeGreaterThan(0);
    // No unresolved relative imports left over from the portable worker.
    expect(worker).not.toMatch(/\bimport\(\s*["']\.{1,2}\//);
    expect(worker).not.toMatch(/^\s*import\s.+from\s/m);
  });

  it('does not load remote scripts', () => {
    const files = walk(dist);
    const html = files.filter((f) => f.endsWith('.html'));
    const js = files.filter((f) => f.endsWith('.js'));
    expect(html.length).toBeGreaterThan(0);
    expect(js.length).toBeGreaterThan(0);
    for (const f of html) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/<script[^>]*\ssrc=["']?http/i);
    }
    const remote = /importScripts\(\s*["']http|import\(\s*["']http/;
    for (const f of js) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(remote);
    }
  });
});

describe('release workflow', () => {
  const workflow = readFileSync(join(root, '.github/workflows/build.yml'), 'utf8');

  it('uploads the zip that `npm run zip` writes', () => {
    expect(workflow).toContain(`${BRAND.slug}.zip`);
    expect(workflow).not.toMatch(/pierre-for-github/);
  });

  it('fails a v* tag that differs from the manifest version, and publishes through the pinned store CLI', () => {
    expect(workflow).toContain('require(\'./manifest.json\').version');
    expect(workflow).toContain('"v$version"');
    expect(workflow).toContain('npx --yes chrome-webstore-upload-cli@4');
    for (const secret of ['CWS_EXTENSION_ID', 'CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN']) {
      expect(workflow).toContain(`secrets.${secret}`);
    }
  });
});
