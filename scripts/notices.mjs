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

/**
 * License texts for packages that ship none as a file (the text is in their README). MIT requires the copyright
 * line and the permission notice to travel with the code, so the SPDX identifier alone is not enough.
 */
const MIT_TEXT = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.`;
const LICENSE_OVERRIDES = {
  // README.md of lru_map@0.4.1, section "MIT license"; package.json author "Rasmus Andersson".
  lru_map: { file: 'README.md (MIT license section)', text: `Copyright (c) 2010-2016 Rasmus Andersson <https://rsms.me/>\n\n${MIT_TEXT}` },
};

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
    const override = p.texts.length === 0 ? LICENSE_OVERRIDES[p.name] : undefined;
    if (override) parts.push('', `--- ${override.file} ---`, '', override.text);
    else if (p.texts.length === 0) parts.push('(no license file shipped in the package; see the license identifier above)');
    for (const t of p.texts) parts.push('', `--- ${t.file} ---`, '', t.text);
  }
  return parts.join('\n') + '\n';
}
