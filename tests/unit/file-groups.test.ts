import { describe, expect, it } from 'vitest';
import {
  classify,
  compileGroups,
  compilePattern,
  DEFAULT_FILE_GROUPS,
  groupPaths,
  groupsProblem,
  invalidPatterns,
  parseSiftImport,
  type FileGroup,
} from '../../src/shared/file-groups';

const matches = (pattern: string, path: string) => compilePattern(pattern)!.test(path);

/** The labels of the default groups that hold `path`. */
const defaultsOf = (path: string) => {
  const compiled = compileGroups(DEFAULT_FILE_GROUPS);
  return [...classify(compiled, path)].map((i) => DEFAULT_FILE_GROUPS[i]!.label);
};

describe('patterns (gitignore syntax, from Sift)', () => {
  it('a name without a slash matches a file or folder at any depth', () => {
    expect(matches('*.md', 'README.md')).toBe(true);
    expect(matches('*.md', 'docs/guide/intro.md')).toBe(true);
    expect(matches('*.md', 'docs/guide/intro.mdx')).toBe(false);
    expect(matches('dist', 'packages/a/dist/index.js')).toBe(true);
    expect(matches('package*.json', 'apps/web/package-lock.json')).toBe(true);
  });

  it('a slash at the start or middle anchors to the repository root', () => {
    expect(matches('docs/*.md', 'docs/a.md')).toBe(true);
    expect(matches('docs/*.md', 'site/docs/a.md')).toBe(false);
    expect(matches('docs/*.md', 'docs/sub/a.md')).toBe(false);
    expect(matches('/build', 'build/out.js')).toBe(true);
    expect(matches('/build', 'src/build/out.js')).toBe(false);
  });

  it('a trailing slash matches folders only', () => {
    expect(matches('test/', 'src/test/a.js')).toBe(true);
    expect(matches('test/', 'src/test')).toBe(false);
    expect(matches('test', 'src/test')).toBe(true);
  });

  it('wildcards: * stays in one segment, ? is one character, [set], ** spans folders', () => {
    expect(matches('a/*.js', 'a/b/c.js')).toBe(false);
    expect(matches('a/**/c.js', 'a/b/x/c.js')).toBe(true);
    expect(matches('a/**/c.js', 'a/c.js')).toBe(true);
    expect(matches('file?.ts', 'file1.ts')).toBe(true);
    expect(matches('file?.ts', 'file10.ts')).toBe(false);
    expect(matches('[ab].ts', 'b.ts')).toBe(true);
    expect(matches('[!ab].ts', 'b.ts')).toBe(false);
    expect(matches('[!ab].ts', 'c.ts')).toBe(true);
  });

  it('is case-insensitive and treats regex characters literally', () => {
    expect(matches('readme*', 'README.md')).toBe(true);
    expect(matches('a+b.(js)', 'a+b.(js)')).toBe(true);
    expect(matches('a.js', 'aXjs')).toBe(false);
  });

  it('comments, blanks and patterns that match nothing compile to null; \\# and \\! escape', () => {
    expect(compilePattern('')).toBeNull();
    expect(compilePattern('   ')).toBeNull();
    expect(compilePattern('# comment')).toBeNull();
    expect(compilePattern('/')).toBeNull();
    expect(matches('\\#notes', '#notes')).toBe(true);
    expect(matches('\\!important', '!important')).toBe(true);
  });
});

describe('groups', () => {
  const g = (label: string, ...patterns: string[]): FileGroup => ({ label, patterns });

  it('later rules override earlier ones', () => {
    const compiled = compileGroups([g('Docs', '*.md', '!docs/*.md', 'docs/keep.md')]);
    expect(classify(compiled, 'a.md').has(0)).toBe(true);
    expect(classify(compiled, 'docs/drop.md').has(0)).toBe(false);
    expect(classify(compiled, 'docs/keep.md').has(0)).toBe(true);
  });

  it('a group whose first rule excludes starts from every file; one with no rules holds everything', () => {
    const compiled = compileGroups([g('NotMd', '!*.md'), g('Everything')]);
    expect([...classify(compiled, 'a.ts')]).toEqual([0, 1]);
    expect([...classify(compiled, 'a.md')]).toEqual([1]);
  });

  it('"!Group" excludes what another group holds, matched case-insensitively', () => {
    const compiled = compileGroups([g('Code', '!tests'), g('Tests', '*.test.ts')]);
    expect([...classify(compiled, 'a.test.ts')]).toEqual([1]);
    expect([...classify(compiled, 'a.ts')]).toEqual([0]);
  });

  it('groups that exclude each other cannot loop: a file both would hold shows in neither', () => {
    const compiled = compileGroups([g('A', '*.ts', '!B'), g('B', 'b/', '!A')]);
    expect([...classify(compiled, 'b/x.ts')]).toEqual([]);
    expect([...classify(compiled, 'x.ts')]).toEqual([0]);
    expect([...classify(compiled, 'b/x.md')]).toEqual([1]);
  });

  it('groupPaths keeps the PR order within each group', () => {
    const groups = [g('Tests', '*.test.ts'), g('Rest', '!Tests')];
    expect(groupPaths(groups, ['b.test.ts', 'a.ts', 'a.test.ts'])).toEqual([['b.test.ts', 'a.test.ts'], ['a.ts']]);
  });
});

describe('default groups (identical to Sift)', () => {
  it('are Sift\'s six tabs, in order', () => {
    expect(DEFAULT_FILE_GROUPS.map((x) => x.label)).toEqual(['Source', 'Tests', 'Docs', 'Infra', 'Manifest', 'Artifacts']);
  });

  it.each([
    ['src/index.ts', ['Source']],
    ['packages/app/src/readmeParser.ts', ['Source']],
    ['src/__tests__/index.test.ts', ['Tests']],
    ['pkg/server_test.go', ['Tests']],
    ['tests/fixtures/sample.json', ['Tests']],
    ['src/components/__snapshots__/Button.test.tsx.snap', ['Tests']],
    ['docs/guide.md', ['Docs']],
    ['src/__tests__/fixture.md', ['Tests']],
    ['README.md', ['Manifest']],
    ['packages/a/CHANGELOG.md', ['Manifest']],
    ['package.json', ['Manifest']],
    ['yarn.lock', ['Manifest']],
    ['jest.config.js', ['Manifest']],
    ['tsconfig.build.json', ['Manifest']],
    ['.github/workflows/ci.yml', ['Infra']],
    ['Dockerfile', ['Infra']],
    ['infra/main.tf', ['Infra']],
    ['infra/test/main_test.go', ['Tests']],
    ['lib/cdk/app-stack.ts', ['Infra']],
    ['src/main/resources/application.yml', ['Source']],
    ['dist/bundle.js', ['Artifacts']],
    ['public/vendor.min.js', ['Artifacts']],
    ['api/service.pb.go', ['Artifacts']],
  ])('%s → %j', (path, labels) => {
    expect(defaultsOf(path)).toEqual(labels);
  });
});

describe('validation', () => {
  it('flags patterns that can never match, not comments or blanks', () => {
    expect(invalidPatterns(['*.md', '# note', '', '!', '/', '!/', '!Manifest'])).toEqual(['!', '/', '!/']);
  });

  it('names need to be present, unique, not "All" and short', () => {
    expect(groupsProblem(DEFAULT_FILE_GROUPS)).toBeNull();
    expect(groupsProblem([{ label: ' ', patterns: [] }])).toMatch(/needs a name/);
    expect(groupsProblem([{ label: 'Tests', patterns: [] }, { label: 'tests', patterns: [] }])).toMatch(/Two groups/);
    expect(groupsProblem([{ label: 'all', patterns: [] }])).toMatch(/"All" is taken/);
    expect(groupsProblem([{ label: 'x'.repeat(61), patterns: [] }])).toMatch(/longer than 60/);
    expect(groupsProblem([{ label: 'Docs', patterns: ['!'] }])).toMatch(/Docs: "!" matches nothing/);
  });
});

describe('import from Sift', () => {
  const tabs = [
    { label: 'Code', patterns: ['!Tests'] },
    { label: 'Tests', patterns: ['*.test.*'] },
  ];

  it('takes the JSON of Sift\'s config item, wrapped or not, or the bare tabs list', () => {
    const config = { defaultTab: 'Code', hideEmptyTabs: true, tabs, experiments: { parallelLoad: true } };
    expect(parseSiftImport(JSON.stringify({ config }))).toEqual(tabs);
    expect(parseSiftImport(JSON.stringify(config))).toEqual(tabs);
    expect(parseSiftImport(JSON.stringify(tabs))).toEqual(tabs);
  });

  it('takes plain text: a [Label] line, then that tab\'s patterns', () => {
    expect(parseSiftImport('[Code]\n!Tests\n\n[Tests]\n  *.test.*\n')).toEqual(tabs);
  });

  it('explains what is wrong', () => {
    expect(parseSiftImport('')).toEqual({ error: expect.stringMatching(/Paste/) });
    expect(parseSiftImport('{ nope')).toEqual({ error: expect.stringMatching(/not valid JSON/) });
    expect(parseSiftImport('{}')).toEqual({ error: expect.stringMatching(/No tabs found/) });
    expect(parseSiftImport('*.md')).toEqual({ error: expect.stringMatching(/\[Tests\]/) });
    expect(parseSiftImport(JSON.stringify([{ label: 'A' }]))).toEqual({ error: expect.stringMatching(/no label or patterns/) });
    expect(parseSiftImport('[A]\n*.md\n[a]\n*.ts')).toEqual({ error: expect.stringMatching(/Two groups/) });
  });
});
