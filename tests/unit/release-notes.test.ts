import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const notes = (tag: string, changelog?: string) => {
  const r = spawnSync('sh', ['scripts/release-notes.sh', tag, ...(changelog ? [changelog] : [])], { encoding: 'utf8' });
  return { status: r.status, out: r.stdout };
};

const fixture = (text: string) => {
  const file = join(mkdtempSync(join(tmpdir(), 'release-notes-')), 'CHANGELOG.md');
  writeFileSync(file, text);
  return file;
};

describe('scripts/release-notes.sh', () => {
  const changelog = fixture(
    ['# Changelog', '', '## 1.2.0 (2026-01-02)', '', '### New', '', '- B', '', '', '## 1.1.0 (2026-01-01)', '', '- A', ''].join('\n'),
  );

  it("prints a tag's section without its heading or the blank lines around it", () => {
    expect(notes('v1.2.0', changelog)).toEqual({ status: 0, out: '### New\n\n- B\n' });
    expect(notes('v1.1.0', changelog)).toEqual({ status: 0, out: '- A\n' });
  });

  it('joins wrapped list items and paragraphs into one line each, and keeps one blank line between blocks', () => {
    const wrapped = fixture(
      ['## 1.0.0 (2026-01-01)', 'The first', 'release.', '', '', '- **A.** One', '  two.', '- B', '1. C', '   three.', ''].join('\n'),
    );
    expect(notes('v1.0.0', wrapped)).toEqual({ status: 0, out: 'The first release.\n\n- **A.** One two.\n- B\n1. C three.\n' });
  });

  it('fails, printing nothing, for a missing version, a prefix of one, or an empty section', () => {
    expect(notes('v1.3.0', changelog)).toEqual({ status: 1, out: '' });
    expect(notes('v1.2', changelog)).toEqual({ status: 1, out: '' });
    expect(notes('v2.0.0', fixture('## 2.0.0 (2026-02-01)\n\n\n## 1.0.0\n\n- A\n'))).toEqual({ status: 1, out: '' });
  });

  it("has notes for the manifest's version in CHANGELOG.md", () => {
    const { version } = JSON.parse(readFileSync('manifest.json', 'utf8')) as { version: string };
    const r = notes(`v${version}`);
    expect(r.status).toBe(0);
    expect(r.out).not.toBe('');
  });
});
