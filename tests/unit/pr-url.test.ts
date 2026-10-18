import { describe, expect, it } from 'vitest';
import { filesChangedUrl, filesRedirect, glideUrl, isGlideActive, parsePrUrl, prKey, showsGithubFiles } from '../../src/shared/pr-url';

describe('parsePrUrl', () => {
  it('maps the base PR URL to the conversation page', () => {
    expect(parsePrUrl('https://github.com/o/r/pull/12')).toEqual({
      owner: 'o',
      repo: 'r',
      number: 12,
      page: 'conversation',
    });
  });

  it('maps changes URLs, with and without a range, to the changes page', () => {
    expect(parsePrUrl('https://github.com/o/r/pull/12/changes')?.page).toBe('changes');
    expect(parsePrUrl('https://github.com/o/r/pull/12/changes/abc..def')?.page).toBe('changes');
    expect(parsePrUrl('https://github.com/o/r/pull/12/changes/abc')?.page).toBe('changes');
  });

  it('maps /files to the files page', () => {
    expect(parsePrUrl('https://github.com/o/r/pull/12/files')?.page).toBe('files');
  });

  it('maps /commits/sha to the commits page', () => {
    expect(parsePrUrl('https://github.com/o/r/pull/12/commits/sha')?.page).toBe('commits');
  });

  it('maps /checks to the checks page', () => {
    expect(parsePrUrl('https://github.com/o/r/pull/12/checks')?.page).toBe('checks');
  });

  it('returns null for non-PR paths', () => {
    expect(parsePrUrl('https://github.com/o/r/pulls')).toBeNull();
    expect(parsePrUrl('https://github.com/o/r/issues/12')).toBeNull();
    expect(parsePrUrl('https://github.com/o/r/pull/x')).toBeNull();
  });

  it('returns null for unknown PR subpages and non-positive numbers', () => {
    expect(parsePrUrl('https://github.com/o/r/pull/12/unknown')).toBeNull();
    expect(parsePrUrl('https://github.com/o/r/pull/0')).toBeNull();
    expect(parsePrUrl('https://github.com/o/r/pull/-3')).toBeNull();
    expect(parsePrUrl('https://github.com/o/r/pull/1.5')).toBeNull();
  });

  it('ignores query strings and hashes', () => {
    expect(parsePrUrl('https://github.com/o/r/pull/12/files?w=1#diff-abc')?.page).toBe('files');
    expect(parsePrUrl('https://github.com/o/r/pull/12?tab=x#glide')).toEqual({
      owner: 'o',
      repo: 'r',
      number: 12,
      page: 'conversation',
    });
  });

  it('accepts trailing slashes', () => {
    expect(parsePrUrl('https://github.com/o/r/pull/12/')?.page).toBe('conversation');
    expect(parsePrUrl('https://github.com/o/r/pull/12/changes/')?.page).toBe('changes');
  });

  it('only accepts https on host github.com', () => {
    expect(parsePrUrl('http://github.com/o/r/pull/12')).toBeNull();
    expect(parsePrUrl('https://www.github.com/o/r/pull/12')).toBeNull();
    expect(parsePrUrl('https://gist.github.com/o/r/pull/12')).toBeNull();
    expect(parsePrUrl('https://github.com.evil.example/o/r/pull/12')).toBeNull();
    expect(parsePrUrl('https://github.com:8443/o/r/pull/12')).toBeNull();
  });

  it('returns null for strings that are not URLs', () => {
    expect(parsePrUrl('not a url')).toBeNull();
    expect(parsePrUrl('')).toBeNull();
  });
});

describe('isGlideActive', () => {
  it('is true only when the hash is exactly #glide', () => {
    expect(isGlideActive('https://github.com/o/r/pull/1#glide')).toBe(true);
    expect(isGlideActive('https://github.com/o/r/pull/1#glide-x')).toBe(false);
    expect(isGlideActive('https://github.com/o/r/pull/1#glide/')).toBe(false);
    expect(isGlideActive('https://github.com/o/r/pull/1')).toBe(false);
    expect(isGlideActive('https://github.com/o/r/pull/1#')).toBe(false);
  });

  it('still accepts #pierre, the hash of links made before the rename', () => {
    expect(isGlideActive('https://github.com/o/r/pull/1#pierre')).toBe(true);
    expect(isGlideActive('https://github.com/o/r/pull/1/files#pierre')).toBe(true);
    expect(isGlideActive('https://github.com/o/r/pull/1#pierre-x')).toBe(false);
    expect(isGlideActive('https://github.com/o/r/pull/1#pierre/')).toBe(false);
  });

  it('is false for strings that are not URLs', () => {
    expect(isGlideActive('#glide')).toBe(false);
    expect(isGlideActive('#pierre')).toBe(false);
  });
});

describe('glideUrl', () => {
  it('builds the base PR URL with the #glide hash', () => {
    expect(glideUrl({ owner: 'o', repo: 'r', number: 12, page: 'files' })).toBe('https://github.com/o/r/pull/12#glide');
  });
});

describe('prKey', () => {
  it('formats owner/repo#number', () => {
    expect(prKey({ owner: 'o', repo: 'r', number: 12, page: 'changes' })).toBe('o/r#12');
  });
});

describe('filesChangedUrl', () => {
  const r = { owner: 'o', repo: 'r', number: 7 };
  it("links to GitHub's Files changed, marked to stay on GitHub, or one file in it", () => {
    expect(filesChangedUrl(r)).toBe('https://github.com/o/r/pull/7/changes?glide=off');
    expect(filesChangedUrl(r, 'abc123')).toBe('https://github.com/o/r/pull/7/changes#diff-abc123');
  });
  it('is never replaced by Glide', () => {
    expect(filesRedirect(filesChangedUrl(r))).toBeNull();
    expect(filesRedirect(filesChangedUrl(r, 'abc123'))).toBeNull();
  });
});

describe('showsGithubFiles', () => {
  it("is true on GitHub's files pages without Glide open over them", () => {
    expect(showsGithubFiles('https://github.com/o/r/pull/7/changes')).toBe(true);
    expect(showsGithubFiles('https://github.com/o/r/pull/7/files')).toBe(true);
    expect(showsGithubFiles('https://github.com/o/r/pull/7/files/abc..def')).toBe(true);
    expect(showsGithubFiles('https://github.com/o/r/pull/7/changes#diff-abc')).toBe(true);
    expect(showsGithubFiles('https://github.com/o/r/pull/7/changes?glide=off')).toBe(true);
  });
  it('is false with Glide open and on the other PR pages', () => {
    expect(showsGithubFiles('https://github.com/o/r/pull/7/changes#glide')).toBe(false);
    expect(showsGithubFiles('https://github.com/o/r/pull/7')).toBe(false);
    expect(showsGithubFiles('https://github.com/o/r/pull/7/commits')).toBe(false);
    expect(showsGithubFiles('https://github.com/o/r/issues/7')).toBe(false);
  });
});

describe('filesRedirect', () => {
  it("opens Glide on the whole PR's Files changed page, staying on the page", () => {
    expect(filesRedirect('https://github.com/o/r/pull/7/changes')).toBe('https://github.com/o/r/pull/7/changes#glide');
    expect(filesRedirect('https://github.com/o/r/pull/7/files')).toBe('https://github.com/o/r/pull/7/files#glide');
    expect(filesRedirect('https://github.com/o/r/pull/7/files/')).toBe('https://github.com/o/r/pull/7/files/#glide');
    expect(filesRedirect('https://github.com/o/r/pull/7/changes?w=1')).toBe('https://github.com/o/r/pull/7/changes?w=1#glide');
  });
  it('is idempotent: the page with Glide open stays', () => {
    expect(filesRedirect(filesRedirect('https://github.com/o/r/pull/7/changes')!)).toBeNull();
    expect(filesRedirect('https://github.com/o/r/pull/7/changes#pierre')).toBeNull();
  });
  it("leaves what only GitHub's page shows: a commit range, a spot in the diff, an explicit choice", () => {
    expect(filesRedirect('https://github.com/o/r/pull/7/files/abc..def')).toBeNull();
    expect(filesRedirect('https://github.com/o/r/pull/7/changes/abc')).toBeNull();
    expect(filesRedirect('https://github.com/o/r/pull/7/changes#diff-abc')).toBeNull();
    expect(filesRedirect('https://github.com/o/r/pull/7/files#r123')).toBeNull();
    expect(filesRedirect('https://github.com/o/r/pull/7/changes?glide=off')).toBeNull();
  });
  it('leaves every other page', () => {
    expect(filesRedirect('https://github.com/o/r/pull/7')).toBeNull();
    expect(filesRedirect('https://github.com/o/r/pull/7/commits')).toBeNull();
    expect(filesRedirect('https://github.com/o/r/pull/7/checks')).toBeNull();
    expect(filesRedirect('https://github.com/o/r/compare/main...x')).toBeNull();
    expect(filesRedirect('https://gist.github.com/o/r/pull/7/changes')).toBeNull();
    expect(filesRedirect('not a url')).toBeNull();
  });
});
