/**
 * THIRD_PARTY_NOTICES.txt: the license of every package reachable from the production `dependencies` (the code
 * bundled into the extension; dev tooling is not shipped). For each package: name, version, SPDX `license`, and
 * the text of its LICENSE / NOTICE / COPYING files. Run by build.mjs into dist/.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const FILE = /^(licen[cs]e|notice|copying|copyright)(\..*)?$/i;

/** Directory of `name` as Node would resolve it from `from`: the nearest enclosing node_modules/<name>. */
function locate(name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dirname(dir) === dir) return null;
  }
}

const licenseOf = ({ license, licenses }) =>
  typeof license === 'string' ? license
    : license?.type ?? (Array.isArray(licenses) ? licenses.map((l) => l.type ?? l).join(' OR ') : 'UNKNOWN');

/** Every package reachable from `root`'s production dependencies, sorted by name then version. */
export function collectPackages(root) {
  const seen = new Map();
  const visit = (dir) => {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
      const found = locate(name, dir);
      if (!found || seen.has(found)) continue; // optional dependencies may be absent on this platform
      seen.set(found, null);
      visit(found);
      const info = JSON.parse(readFileSync(join(found, 'package.json'), 'utf8'));
      const files = readdirSync(found).filter((f) => FILE.test(f)).sort();
      seen.set(found, {
        name: info.name,
        version: info.version,
        license: licenseOf(info),
        homepage: typeof info.repository === 'string' ? info.repository : info.repository?.url ?? info.homepage ?? '',
        texts: files.map((f) => ({ file: f, text: readFileSync(join(found, f), 'utf8').trim() })),
      });
    }
  };
  visit(root);
  return [...seen.values()].filter(Boolean).sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

export function renderNotices(root) {
  const packages = collectPackages(root);
  const parts = [
    'THIRD-PARTY NOTICES',
    '',
    'This extension bundles the open-source packages below (the production dependencies and everything they',
    'depend on). Their licenses are reproduced as published by each package.',
    '',
    ...packages.map((p) => `- ${p.name}@${p.version} (${p.license})`),
  ];
  for (const p of packages) {
    parts.push('', '='.repeat(78), `${p.name}@${p.version}`, `License: ${p.license}`);
    if (p.homepage) parts.push(`Source: ${p.homepage}`);
    parts.push('='.repeat(78));
    if (p.texts.length === 0) parts.push('(no license file shipped in the package; see the license identifier above)');
    for (const t of p.texts) parts.push('', `--- ${t.file} ---`, '', t.text);
  }
  return parts.join('\n') + '\n';
}
