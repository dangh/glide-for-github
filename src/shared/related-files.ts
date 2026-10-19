/**
 * Related files: companion files (lock files, serverless parts) shown with their main file, like VS Code's
 * `explorer.fileNesting.patterns`.
 *
 * A rule is a main-file pattern and companion patterns. Patterns are file names in the file groups' glob syntax
 * (`compilePattern`: `*`, `?`, `[set]`, case-insensitive) and never name a folder: a companion sits beside its main
 * file. `${basename}` in a companion pattern is the main file's name without its extension.
 */
import { compilePattern, type Matcher } from './file-groups';

export interface RelatedRule {
  main: string;
  companions: string[];
}

export const RULES_MAX = 60;
export const BASENAME = '${basename}';

const rule = (main: string, ...companions: string[]): RelatedRule => Object.freeze({ main, companions: Object.freeze(companions) as string[] });

export const DEFAULT_RELATED_RULES: readonly RelatedRule[] = Object.freeze([
  rule('package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb'),
  rule('deno.json', 'deno.lock'),
  rule('deno.jsonc', 'deno.lock'),
  rule('Cargo.toml', 'Cargo.lock'),
  rule('pyproject.toml', 'poetry.lock', 'uv.lock', 'pdm.lock'),
  rule('Pipfile', 'Pipfile.lock'),
  rule('requirements.in', 'requirements.txt'),
  rule('pixi.toml', 'pixi.lock'),
  rule('Gemfile', 'Gemfile.lock'),
  rule('go.mod', 'go.sum'),
  rule('go.work', 'go.work.sum'),
  rule('composer.json', 'composer.lock'),
  rule('pubspec.yaml', 'pubspec.lock'),
  rule('Podfile', 'Podfile.lock'),
  rule('Package.swift', 'Package.resolved'),
  rule('flake.nix', 'flake.lock'),
  rule('mix.exs', 'mix.lock'),
  rule('Chart.yaml', 'Chart.lock'),
  rule('build.gradle', 'gradle.lockfile'),
  rule('build.gradle.kts', 'gradle.lockfile'),
  rule('*.csproj', 'packages.lock.json'),
  rule('serverless.yml', 'serverless-*.yml', 'serverless-*.yaml'),
  rule('serverless.yaml', 'serverless-*.yml', 'serverless-*.yaml'),
]);

const LOCK_PATTERNS = [
  '*.lock', '*.lockb', '*-lock.json', '*-lock.yaml', '*.lockfile', 'npm-shrinkwrap.json', 'go.sum', 'go.work.sum',
  'Package.resolved', 'packages.lock.json',
].map((p) => compilePattern(p)!);

/** Whether a file is a lock file (the "lock file" tag on a companion). */
export const isLockFile = (path: string): boolean => {
  const name = nameOf(path);
  return LOCK_PATTERNS.some((m) => m.test(name));
};

const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const folderOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);
/** The name without its last extension: `package.json` → `package`, `Gemfile` → `Gemfile`, `.eslintrc.json` → `.eslintrc`. */
const basenameOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
};
/** `text` as a pattern that matches only itself. */
const literal = (text: string) => text.replace(/[*?[\]\\]/g, '\\$&');

export interface Relations {
  /** Each main file's companions, in list order. */
  companions: ReadonlyMap<string, readonly string[]>;
  /** Each companion's main file. */
  mainOf: ReadonlyMap<string, string>;
}

export const NO_RELATIONS: Relations = Object.freeze({ companions: new Map(), mainOf: new Map() });

interface CompiledRule {
  main: Matcher;
  /** Companion patterns without `${basename}`, compiled once. */
  fixed: Matcher[];
  /** Companion patterns with `${basename}`, compiled per main file. */
  templates: string[];
}

function compileRules(rules: readonly RelatedRule[]): CompiledRule[] {
  const out: CompiledRule[] = [];
  for (const r of rules) {
    const main = compilePattern(r.main);
    if (!main) continue;
    const fixed: Matcher[] = [];
    const templates: string[] = [];
    for (const c of r.companions) {
      if (c.includes(BASENAME)) templates.push(c);
      else {
        const m = compilePattern(c);
        if (m) fixed.push(m);
      }
    }
    out.push({ main, fixed, templates });
  }
  return out;
}

/**
 * Which files of `paths` are companions of which. Per folder, rules apply in order and files in list order: the first
 * rule whose main pattern matches a file gives it every sibling, not yet taken, that a companion pattern matches. A file
 * is in one relation at most, a companion is never a main file, and a main file with no companion in `paths` relates
 * nothing.
 */
export function relateFiles(rules: readonly RelatedRule[], paths: readonly string[]): Relations {
  const compiled = compileRules(rules);
  const folders = new Map<string, string[]>();
  for (const path of paths) {
    const folder = folderOf(path);
    const list = folders.get(folder);
    if (list) list.push(path);
    else folders.set(folder, [path]);
  }
  const companions = new Map<string, string[]>();
  const mainOf = new Map<string, string>();
  for (const files of folders.values()) {
    if (files.length < 2) continue;
    const taken = new Set<string>();
    for (const r of compiled) {
      for (const main of files) {
        const name = nameOf(main);
        if (taken.has(main) || !r.main.test(name)) continue;
        const matchers = [...r.fixed, ...r.templates.map((t) => compilePattern(t.replaceAll(BASENAME, literal(basenameOf(name))))).filter((m): m is Matcher => m !== null)];
        const found = files.filter((f) => f !== main && !taken.has(f) && matchers.some((m) => m.test(nameOf(f))));
        if (found.length === 0) continue;
        taken.add(main);
        for (const f of found) {
          taken.add(f);
          mainOf.set(f, main);
        }
        companions.set(main, found);
      }
    }
  }
  return { companions, mainOf };
}

/** `paths` with each main file's companions moved right after it; `paths` itself when nothing relates. */
export function arrange(paths: readonly string[], relations: Relations): readonly string[] {
  if (relations.mainOf.size === 0) return paths;
  const out: string[] = [];
  for (const path of paths) {
    if (relations.mainOf.has(path)) continue;
    out.push(path);
    const list = relations.companions.get(path);
    if (list) out.push(...list);
  }
  return out;
}

/** Why a set of rules cannot be saved, or null. */
export function rulesProblem(rules: readonly RelatedRule[]): string | null {
  if (rules.length > RULES_MAX) return `At most ${RULES_MAX} rules.`;
  for (const [i, r] of rules.entries()) {
    const name = `Rule ${i + 1}`;
    const main = r.main.trim();
    if (!main) return `${name} needs a main file pattern.`;
    if (r.companions.length === 0) return `${name} needs at least one related file pattern.`;
    for (const p of [main, ...r.companions]) {
      if (p.includes('/')) return `${name}: "${p}" names a folder; related files sit beside their main file.`;
      const unknown = /\$\{(?!basename\})[^}]*\}/.exec(p);
      if (unknown) return `${name}: "${unknown[0]}" is not known; only ${BASENAME} is.`;
    }
    if (main.includes(BASENAME)) return `${name}: ${BASENAME} goes in the related file patterns, not the main one.`;
    const bad = [main, ...r.companions].find((p) => !compilePattern(p.replaceAll(BASENAME, 'x')) || p.trim().startsWith('#') || p.trim().startsWith('!'));
    if (bad !== undefined) return `${name}: "${bad}" matches nothing.`;
  }
  return null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A rule from untrusted data (storage), companions as a list or one newline-separated string; else null. */
export function parseRule(raw: unknown): RelatedRule | null {
  if (!isRecord(raw) || typeof raw.main !== 'string') return null;
  const lines = typeof raw.companions === 'string' ? raw.companions.split('\n') : Array.isArray(raw.companions) ? raw.companions : null;
  if (!lines || !lines.every((p): p is string => typeof p === 'string')) return null;
  return { main: raw.main.trim(), companions: lines.map((p) => p.trim()).filter(Boolean) };
}
