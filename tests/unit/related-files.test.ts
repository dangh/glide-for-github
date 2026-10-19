import { describe, expect, it } from 'vitest';
import {
  arrange,
  DEFAULT_RELATED_RULES,
  isLockFile,
  parseRule,
  relateFiles,
  rulesProblem,
  type RelatedRule,
} from '../../src/shared/related-files';

const relate = (paths: string[], rules: readonly RelatedRule[] = DEFAULT_RELATED_RULES) => {
  const r = relateFiles(rules, paths);
  return Object.fromEntries([...r.companions].map(([main, list]) => [main, [...list]]));
};

describe('related files: the default rules', () => {
  it('nests every lock file under its manifest in the same folder', () => {
    expect(
      relate([
        'package-lock.json',
        'package.json',
        'remote/package-lock.json',
        'remote/package.json',
        'src/index.ts',
      ]),
    ).toEqual({ 'package.json': ['package-lock.json'], 'remote/package.json': ['remote/package-lock.json'] });
  });

  it.each([
    ['package.json', ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb']],
    ['Cargo.toml', ['Cargo.lock']],
    ['pyproject.toml', ['poetry.lock', 'uv.lock', 'pdm.lock']],
    ['Pipfile', ['Pipfile.lock']],
    ['Gemfile', ['Gemfile.lock']],
    ['go.mod', ['go.sum']],
    ['composer.json', ['composer.lock']],
    ['pubspec.yaml', ['pubspec.lock']],
    ['Podfile', ['Podfile.lock']],
    ['flake.nix', ['flake.lock']],
    ['mix.exs', ['mix.lock']],
    ['serverless.yml', ['serverless-resources.yml', 'serverless-functions.yaml']],
    ['serverless.yaml', ['serverless-resources.yml', 'serverless-functions.yaml']],
  ])('%s takes %j', (main, companions) => {
    expect(relate(['app/' + main, ...companions.map((c) => 'app/' + c)])).toEqual({ ['app/' + main]: companions.map((c) => 'app/' + c) });
  });

  it('relates nothing across folders', () => {
    expect(relate(['package.json', 'web/package-lock.json', 'web/yarn.lock'])).toEqual({});
  });

  it('relates nothing when the main file is not in the list: the companion stays on its own', () => {
    expect(relate(['package-lock.json', 'src/a.ts'])).toEqual({});
  });

  it('matches names case-insensitively, like the file groups', () => {
    expect(relate(['gemfile', 'GEMFILE.LOCK'])).toEqual({ gemfile: ['GEMFILE.LOCK'] });
  });
});

describe('related files: rules', () => {
  it('${basename} is the main file name without its extension', () => {
    const rules = [{ main: '*.ts', companions: ['${basename}.js', '${basename}.d.ts'] }];
    expect(relate(['src/a.ts', 'src/a.js', 'src/a.d.ts', 'src/b.js'], rules)).toEqual({ 'src/a.ts': ['src/a.js', 'src/a.d.ts'] });
  });

  it('${basename} is literal text, not a pattern', () => {
    const rules = [{ main: '*.txt', companions: ['${basename}.md'] }];
    expect(relate(['a[1].txt', 'a[1].md', 'a1.md'], rules)).toEqual({ 'a[1].txt': ['a[1].md'] });
    expect(relate(['x*.txt', 'x*.md', 'xy.md'], rules)).toEqual({ 'x*.txt': ['x*.md'] });
  });

  it('an earlier rule claims a file first, and a file is in one relation only', () => {
    const rules = [
      { main: 'a.json', companions: ['shared.lock'] },
      { main: 'b.json', companions: ['shared.lock', 'b.lock'] },
    ];
    expect(relate(['a.json', 'b.json', 'b.lock', 'shared.lock'], rules)).toEqual({ 'a.json': ['shared.lock'], 'b.json': ['b.lock'] });
  });

  it('a companion is never a main, and a main never a companion', () => {
    const rules = [
      { main: '*.ts', companions: ['${basename}.js'] },
      { main: '*.js', companions: ['${basename}.map'] },
    ];
    expect(relate(['a.ts', 'a.js', 'a.js.map', 'a.map'], rules)).toEqual({ 'a.ts': ['a.js'] });
  });

  it('a file never relates to itself', () => {
    expect(relate(['a.json'], [{ main: '*.json', companions: ['*.json'] }])).toEqual({});
    expect(relate(['a.json', 'b.json'], [{ main: '*.json', companions: ['*.json'] }])).toEqual({ 'a.json': ['b.json'] });
  });

  it('knows each companion main file', () => {
    const r = relateFiles(DEFAULT_RELATED_RULES, ['go.mod', 'go.sum', 'main.go']);
    expect(r.mainOf.get('go.sum')).toBe('go.mod');
    expect(r.mainOf.get('main.go')).toBeUndefined();
  });
});

describe('related files: arrange', () => {
  it('puts each main file companions right after it, in list order, and keeps the rest in place', () => {
    const paths = ['a.ts', 'package-lock.json', 'package.json', 'yarn.lock', 'z.ts'];
    expect(arrange(paths, relateFiles(DEFAULT_RELATED_RULES, paths))).toEqual(['a.ts', 'package.json', 'package-lock.json', 'yarn.lock', 'z.ts']);
  });

  it('returns the list itself when nothing relates', () => {
    const paths = ['a.ts', 'b.ts'];
    expect(arrange(paths, relateFiles(DEFAULT_RELATED_RULES, paths))).toBe(paths);
  });
});

describe('related files: lock files', () => {
  it.each(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'Cargo.lock', 'go.sum', 'npm-shrinkwrap.json', 'a/b/uv.lock'])(
    '%s is a lock file',
    (path) => expect(isLockFile(path)).toBe(true),
  );
  it.each(['package.json', 'serverless-resources.yml', 'locks.ts', 'lockfile.md'])('%s is not', (path) => expect(isLockFile(path)).toBe(false));
});

describe('related files: validation', () => {
  it('rejects invalid character ranges without throwing while editing or probing', () => {
    const rules = [{ main: '[z-a].json', companions: ['x.lock'] }];
    expect(rulesProblem(rules)).toMatch(/Rule 1/);
    expect(relate(['a.json', 'x.lock'], rules)).toEqual({});
    expect(relate(['a.json', 'x.lock'], [{ main: 'a.json', companions: ['[z-a].lock'] }])).toEqual({});
  });

  it('accepts the defaults', () => {
    expect(rulesProblem(DEFAULT_RELATED_RULES)).toBeNull();
  });

  it('wants a main pattern and at least one companion pattern', () => {
    expect(rulesProblem([{ main: ' ', companions: ['a'] }])).toMatch(/Rule 1/);
    expect(rulesProblem([{ main: 'a', companions: [] }])).toMatch(/Rule 1/);
  });

  it('refuses patterns with a folder: companions sit beside their main file', () => {
    expect(rulesProblem([{ main: 'src/package.json', companions: ['x'] }])).toMatch(/folder/);
    expect(rulesProblem([{ main: 'package.json', companions: ['web/yarn.lock'] }])).toMatch(/folder/);
  });

  it('refuses ${basename} in the main pattern and unknown ${…} variables', () => {
    expect(rulesProblem([{ main: '${basename}.ts', companions: ['x'] }])).toMatch(/basename/);
    expect(rulesProblem([{ main: '*.ts', companions: ['${capture}.js'] }])).toMatch(/\$\{capture\}/);
  });

  it('parses a stored rule, companions as a list or one newline-separated string, and refuses anything else', () => {
    expect(parseRule({ main: ' Gemfile ', companions: 'Gemfile.lock\n\n gems.locked ' })).toEqual({ main: 'Gemfile', companions: ['Gemfile.lock', 'gems.locked'] });
    expect(parseRule({ main: 'a', companions: ['b'] })).toEqual({ main: 'a', companions: ['b'] });
    expect(parseRule({ main: 1, companions: ['b'] })).toBeNull();
    expect(parseRule({ main: 'a', companions: [2] })).toBeNull();
    expect(parseRule(null)).toBeNull();
  });
});
