/**
 * File groups: tabs that show one kind of file at a time (Source, Tests, Docs, Infra, Manifest, Artifacts).
 *
 * Ported from Sift for GitHub (shared.js, MIT, same author: https://github.com/dangh/sift-for-github): the default
 * groups, the gitignore-style pattern engine and the classifier are Sift's, typed. Glide adds the per-PR grouping
 * (`groupPaths`), validation of stored groups and the import of Sift's settings.
 */

export interface FileGroup {
  label: string;
  /** gitignore-style lines (see `compilePattern`); `#` lines are comments shown on the options page. */
  patterns: string[];
}

/** The label of the "All" choice: every file. Group labels are never empty. */
export const ALL_GROUP = '';
export const GROUP_LABEL_MAX = 60;
export const GROUPS_MAX = 20;

/** Default tabs based on Sift, with tool-config coverage extended for Glide. */
export const DEFAULT_FILE_GROUPS: readonly FileGroup[] = Object.freeze([
  { label: 'Source', patterns: ["# Everything the other tabs don't claim.", '!Manifest', '!Tests', '!Docs', '!Infra', '!Artifacts'] },
  {
    label: 'Tests',
    patterns: [
      '# Test folders, anywhere.',
      '__tests__/', '__snapshots__/', '__mocks__/', '__fixtures__/', 'test/', 'tests/', '.test/', '.tests/',
      'spec/', 'specs/', 'e2e/', 'testdata/', 'testing/', 'mocks/', 'fixtures/',
      '# Test files by name.',
      '*.test.*', '*.spec.*', '*_test.go', '*_test.py', 'test_*.py', 'conftest.py',
      '*Test.java', '*Tests.java', '*Test.kt', '*Tests.cs', '*_spec.rb', '*.snap',
      '# Test runner config and setup live in Manifest.',
      '!Manifest',
    ],
  },
  {
    label: 'Docs',
    patterns: [
      '# Markdown and other doc markup.',
      '*.md', '*.markdown', '*.rst', '*.adoc',
      '# Except inside test folders (snapshot fixtures) and readmes/changelogs (Manifest).',
      '!__tests__/', '!__snapshots__/', '!__fixtures__/', '!test/', '!tests/', '!.test/', '!.tests/',
      '!fixture/', '!fixtures/', '!testdata/', '!mocks/',
      '!Manifest',
    ],
  },
  {
    label: 'Infra',
    patterns: [
      '# Infrastructure folders, anywhere.',
      'infra/', 'infrastructure/', 'cdk/', 'serverless/', 'terraform/', 'cloudformation/',
      'deploy/', 'deployment/', 'deployments/', 'k8s/', 'kubernetes/', 'helm/', 'charts/', '.circleci/',
      '/.github/workflows/', '/.github/actions/', 'resources/',
      '# Except Java/Kotlin app resources (src/main/resources), which are app config and assets.',
      '!**/src/main/resources/',
      '# Serverless, CDK, SAM, Pulumi, Terraform.',
      'serverless*.yml', 'serverless*.yaml', 'serverless.ts', 'serverless.js', 'serverless.json',
      'cdk.json', 'cdk.context.json', '*-stack.ts', '*-stack.js', '*.stack.ts',
      'template.yaml', 'template.yml', 'samconfig.toml',
      'Pulumi.yaml', 'Pulumi.*.yaml', '*.tf', '*.tfvars', '*.hcl',
      '# Containers and CI.',
      'Dockerfile', 'Dockerfile.*', '*.dockerfile', '.dockerignore',
      'docker-compose*.yml', 'docker-compose*.yaml', 'compose.yml', 'compose.yaml',
      'Jenkinsfile', '.gitlab-ci.yml', 'buildspec.yml', 'buildspec.yaml', 'Procfile', 'fly.toml',
      '# Tests and readmes in infra folders belong to their own tabs.',
      '!Tests', '!Manifest',
    ],
  },
  {
    label: 'Manifest',
    patterns: [
      '# Dependency manifests and lock files.',
      'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml',
      'requirements.txt', 'Pipfile', 'Pipfile.lock', 'pyproject.toml', 'poetry.lock',
      'go.mod', 'go.sum', 'Cargo.toml', 'Cargo.lock', 'Gemfile', 'Gemfile.lock',
      'composer.json', 'composer.lock', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'setup.py', 'setup.cfg',
      '# Tool config: linters, formatters, compilers, bundlers, test runners, editors, git.',
      '.eslintrc*', 'eslint.config.*', '.eslintignore', '.prettierrc*', 'prettier.config.*', '.prettierignore',
      '.stylelintrc*', 'stylelint.config.*', 'biome.json', 'biome.jsonc', '.editorconfig', '.markdownlint*',
      '.commitlintrc*', 'commitlint.config.*', '.lintstagedrc*', 'lint-staged.config.*', '.husky/',
      'tsconfig*.json', 'jsconfig*.json', '.babelrc*', 'babel.config.*', '.swcrc', '.browserslistrc',
      'webpack.config.*', 'vite.config.*', 'rollup.config.*', 'esbuild.config.*', 'tsup.config.*',
      'postcss.config.*', 'tailwind.config.*', 'next.config.*', 'nuxt.config.*', 'svelte.config.*', 'astro.config.*',
      'turbo.json', 'nx.json', 'lerna.json', 'pnpm-workspace.yaml', '.yarnrc*', '.npmrc', '.nvmrc',
      '.node-version', '.tool-versions', '.python-version', '.ruby-version',
      'jest.config.*', 'jest.*.config.*', 'jest.setup.*', 'vitest.config.*', 'vitest.workspace.*', 'vitest.setup.*',
      'playwright.config.*', 'cypress.config.*', 'karma.conf.*', '.mocharc*', '.nycrc*', 'setupTests.*',
      'pytest.ini', 'tox.ini', '.coveragerc', 'codecov.yml', '.flake8', 'mypy.ini', '.pylintrc', 'ruff.toml',
      '.rubocop.yml', '.golangci.yml', '.golangci.yaml', '.clang-format',
      '.gitignore', '.gitattributes', 'CODEOWNERS', '.github/dependabot.yml', 'renovate.json', '.vscode/', '.idea/',
      '# Readmes and changelogs (doc extensions only, so readmeParser.ts stays out).',
      'README', 'CHANGELOG', 'CHANGES',
      'README*.md', 'README*.markdown', 'README*.rst', 'README*.txt', 'README*.adoc',
      'CHANGELOG*.md', 'CHANGELOG*.markdown', 'CHANGELOG*.rst', 'CHANGELOG*.txt', 'CHANGELOG*.adoc',
      'CHANGES*.md', 'CHANGES*.markdown', 'CHANGES*.rst', 'CHANGES*.txt', 'CHANGES*.adoc',
      'HISTORY*.md', 'HISTORY*.markdown', 'HISTORY*.rst', 'HISTORY*.txt', 'HISTORY*.adoc',
      'RELEASE_NOTES*.md', 'RELEASE_NOTES*.markdown', 'RELEASE_NOTES*.rst', 'RELEASE_NOTES*.txt', 'RELEASE_NOTES*.adoc',
    ],
  },
  {
    label: 'Artifacts',
    patterns: [
      '# Build output and generated-code folders, anywhere.',
      'dist/', 'out/', 'target/', 'obj/', 'coverage/', '.next/', '__generated__/', 'generated/', 'gen/',
      '# Minified and bundled output, source maps.',
      '*.min.js', '*.min.css', '*.min.mjs', '*.bundle.js', '*.chunk.js', '*.map',
      '# Compiled binaries and bytecode.',
      '*.pyc', '*.class', '*.jar', '*.war', '*.wasm', '*.o', '*.a', '*.so', '*.dylib', '*.dll', '*.exe',
      '# Archives and packages (*.gz also covers .tar.gz, and so on).',
      '*.tar', '*.tgz', '*.gz', '*.bz2', '*.xz', '*.zst', '*.zip', '*.7z', '*.rar',
      '*.whl', '*.egg', '*.gem', '*.nupkg', '*.vsix', '*.crx', '*.deb', '*.rpm', '*.apk', '*.aab', '*.ipa', '*.dmg', '*.msi',
      '# Generated code (protobuf, Go, Dart, ...).',
      '*.pb.go', '*.pb.gw.go', '*_pb2.py', '*_pb2_grpc.py', '*_pb.js', '*_pb.d.ts', '*_grpc_pb.js',
      'zz_generated*.go', '*_generated.go', '*.generated.*', '*.g.dart', '*.freezed.dart',
    ],
  },
].map((g) => Object.freeze({ ...g, patterns: Object.freeze(g.patterns) as string[] })));

export interface Matcher {
  test(path: string): boolean;
}

const escapeRe = (c: string) => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * One pattern, in gitignore syntax, matched case-insensitively against a file's path:
 * - No slash (`*.md`, `dist`): a file or folder name at any depth.
 * - A slash at the start or middle (`/build`, `docs/*.md`): relative to the repo root.
 * - A trailing slash (`test/`): folders only, i.e. every file under such a folder.
 * - `*` is anything but "/", `?` one character, `[abc]` one of a set, `**` any folders.
 * - "\!" and "\#" escape a leading "!" or "#".
 * Null for blank and comment lines, and for a pattern that matches nothing ("/").
 */
export function compilePattern(pattern: string): Matcher | null {
  let text = pattern.trim();
  if (!text || text.startsWith('#')) return null;
  if (text.startsWith('\\#') || text.startsWith('\\!')) text = text.slice(1);
  const folderOnly = text.endsWith('/');
  text = text.replace(/\/+$/, '');
  const anchored = text.includes('/');
  text = text.replace(/^\//, '');
  if (!text) return null;
  let source = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '*' && text[i + 1] === '*') {
      // "**/" is any number of folders; "**" elsewhere is anything.
      if (text[i + 2] === '/') {
        source += '(?:.*/)?';
        i += 2;
      } else {
        source += '.*';
        i += 1;
      }
    } else if (c === '*') {
      source += '[^/]*';
    } else if (c === '?') {
      source += '[^/]';
    } else if (c === '[' && text.indexOf(']', i + 2) !== -1) {
      const close = text.indexOf(']', i + 2);
      const set = text.slice(i + 1, close).replace(/^!/, '^').replace(/\\/g, '\\\\');
      source += `[${set}]`;
      i = close;
    } else if (c === '\\' && i + 1 < text.length) {
      i += 1;
      source += escapeRe(text[i]!);
    } else {
      source += escapeRe(c);
    }
  }
  const re = new RegExp(`^${source}$`, 'i');
  return {
    // A pattern that matches a folder covers everything under it, so try every folder on the way down, then
    // (unless the pattern is folder-only) the file itself.
    test(path) {
      const parts = path.split('/');
      const last = folderOnly ? parts.length - 1 : parts.length;
      for (let n = 1; n <= last; n++) {
        if (re.test(anchored ? parts.slice(0, n).join('/') : parts[n - 1]!)) return true;
      }
      return false;
    },
  };
}

type Rule = { exclude: boolean; matcher: Matcher } | { exclude: true; group: number };

export interface CompiledGroup {
  label: string;
  rules: Rule[];
  /** A group whose first rule excludes (or that has no rules) starts from every file, otherwise from none. */
  startsWithAll: boolean;
}

/**
 * A group's rules apply top to bottom and a later rule overrides an earlier one. "!Manifest" (an exclusion naming
 * another group, case-insensitively) excludes what that group holds.
 */
export function compileGroups(groups: readonly FileGroup[]): CompiledGroup[] {
  const labels = groups.map((g) => g.label.trim().toLowerCase());
  return groups.map((group) => {
    const rules: Rule[] = [];
    for (const raw of group.patterns) {
      const text = raw.trim();
      if (!text || text.startsWith('#')) continue;
      const exclude = text.startsWith('!');
      const rest = exclude ? text.slice(1).trim() : text;
      const ref = exclude ? labels.indexOf(rest.toLowerCase()) : -1;
      if (ref !== -1) {
        rules.push({ exclude: true, group: ref });
        continue;
      }
      const matcher = compilePattern(rest);
      if (matcher) rules.push({ exclude, matcher });
    }
    return { label: group.label, rules, startsWithAll: rules.length === 0 || rules[0]!.exclude };
  });
}

/**
 * The indexes of the groups that hold `path`.
 * "!Infra" in Tests runs Infra's rules on the path and excludes it if Infra holds it. That expands recursively,
 * except that references back to a group already being checked (Infra's "!Tests" while checking Tests) are
 * ignored, so groups that exclude each other can't loop: a file both would hold then shows in neither.
 */
export function classify(compiled: readonly CompiledGroup[], path: string): Set<number> {
  const memo = new Map<string, boolean>();
  const holds = (index: number, skip: ReadonlySet<number>): boolean => {
    const key = `${index}:${[...skip].sort().join(',')}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    const group = compiled[index]!;
    const inner = new Set(skip).add(index);
    let result = group.startsWithAll;
    for (const rule of group.rules) {
      if ('matcher' in rule) {
        if (rule.matcher.test(path)) result = !rule.exclude;
      } else if (result && !inner.has(rule.group) && holds(rule.group, inner)) {
        result = false;
      }
    }
    memo.set(key, result);
    return result;
  };
  const found = new Set<number>();
  for (let i = 0; i < compiled.length; i++) if (holds(i, new Set())) found.add(i);
  return found;
}

/** Each group's files, in `paths` order (a file can be in several groups, or in none and only under All). */
export function groupPaths(groups: readonly FileGroup[], paths: readonly string[]): string[][] {
  const compiled = compileGroups(groups);
  const out = groups.map((): string[] => []);
  for (const path of paths) for (const i of classify(compiled, path)) out[i]!.push(path);
  return out;
}

/** Lines that are neither blank, comments nor a pattern that can match (a bare "!" or "/"). */
export function invalidPatterns(patterns: readonly string[]): string[] {
  return patterns.filter((p) => {
    const text = p.trim();
    return text !== '' && !text.startsWith('#') && !compilePattern(text.replace(/^!/, ''));
  });
}

/** Why a set of groups cannot be saved, or null. Labels must be non-empty, unique (case-insensitively) and short. */
export function groupsProblem(groups: readonly FileGroup[]): string | null {
  if (groups.length > GROUPS_MAX) return `At most ${GROUPS_MAX} groups.`;
  const seen = new Set<string>();
  for (const [i, g] of groups.entries()) {
    const label = g.label.trim();
    if (!label) return `Group ${i + 1} needs a name.`;
    if (label.length > GROUP_LABEL_MAX) return `"${label.slice(0, 20)}…" is longer than ${GROUP_LABEL_MAX} characters.`;
    if (label.toLowerCase() === 'all') return '"All" is taken: it always shows every file.';
    if (seen.has(label.toLowerCase())) return `Two groups are named "${label}".`;
    seen.add(label.toLowerCase());
    const bad = invalidPatterns(g.patterns)[0];
    if (bad !== undefined) return `${label}: "${bad}" matches nothing.`;
  }
  return null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A group from untrusted data (storage, an import), patterns as a list or one newline-separated string; else null. */
export function parseGroup(raw: unknown): FileGroup | null {
  if (!isRecord(raw) || typeof raw.label !== 'string') return null;
  const label = raw.label.trim();
  if (!label || label.length > GROUP_LABEL_MAX) return null;
  const lines = typeof raw.patterns === 'string' ? raw.patterns.split('\n') : Array.isArray(raw.patterns) ? raw.patterns : null;
  if (!lines || !lines.every((p): p is string => typeof p === 'string')) return null;
  return { label, patterns: lines.map((p) => p.trim()).filter(Boolean) };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** What an import from Sift brings: its tabs, and its tab to open on and hide-empty switch when its config has them. */
export interface SiftImport {
  groups: FileGroup[];
  /** Sift's `defaultTab` ('' = All) when it names one of the groups. */
  defaultGroup?: string;
  /** Sift's `hideEmptyTabs`. */
  hideEmpty?: boolean;
}

/**
 * Groups pasted from Sift for GitHub. Sift has no export, so this takes what its storage holds: the JSON of its
 * `config` item (`{ tabs: [{ label, patterns }], defaultTab, hideEmptyTabs }`, also wrapped as `{ config: … }` or as
 * the bare `tabs` list), or plain text, one block per tab: a `[Label]` line, then that tab's patterns. An old config's
 * catch-all tab (`fallbackLabel`) becomes a group excluding every other, as Sift itself reads it.
 */
export function parseSiftImport(text: string): SiftImport | { error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { error: 'Paste Sift settings first.' };
  let groups: FileGroup[];
  const extra: Omit<SiftImport, 'groups'> = {};
  // "[Tests]" starts a text block, not a JSON list.
  const json = parseJson(trimmed);
  if (trimmed.startsWith('{') && json === undefined) return { error: 'That is not valid JSON.' };
  if (json !== undefined) {
    const config = isRecord(json) && isRecord(json.config) ? json.config : json;
    const tabs = Array.isArray(config) ? config : isRecord(config) ? config.tabs : undefined;
    if (!Array.isArray(tabs)) return { error: 'No tabs found: expected Sift\'s "config" with a "tabs" list.' };
    groups = tabs.map(parseGroup).filter((g): g is FileGroup => g !== null);
    if (groups.length !== tabs.length) return { error: 'Some tabs have no label or patterns.' };
    if (isRecord(config)) {
      if (typeof config.fallbackLabel === 'string' && config.fallbackLabel.trim()) {
        groups.push({ label: config.fallbackLabel.trim(), patterns: groups.map((g) => `!${g.label}`) });
      }
      if (typeof config.defaultTab === 'string') {
        const key = config.defaultTab.trim().toLowerCase();
        const named = groups.find((g) => g.label.toLowerCase() === key);
        if (!key) extra.defaultGroup = ALL_GROUP;
        else if (named) extra.defaultGroup = named.label;
      }
      if (typeof config.hideEmptyTabs === 'boolean') extra.hideEmpty = config.hideEmptyTabs;
    }
  } else {
    groups = [];
    let current: FileGroup | null = null;
    for (const line of trimmed.split('\n')) {
      const header = /^\[(.+)\]$/.exec(line.trim());
      if (header) groups.push((current = { label: header[1]!.trim(), patterns: [] }));
      else if (current) {
        if (line.trim()) current.patterns.push(line.trim());
      } else if (line.trim()) return { error: 'Start each tab with its name in brackets, like [Tests].' };
    }
  }
  if (groups.length === 0) return { error: 'No tabs found.' };
  const problem = groupsProblem(groups);
  return problem ? { error: problem } : { groups, ...extra };
}
