import { describe, expect, it } from 'vitest';
import { glideUrl, isGlideActive, parsePrUrl, prKey } from '../../src/shared/pr-url';

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
