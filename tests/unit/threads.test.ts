import { describe, expect, it } from 'vitest';
import { fetchThreads, type RawThreads } from '../../src/viewer/github/private';
import { toThreadModels, type ThreadModel } from '../../src/viewer/github/threads';
import { fakeRpc, fixture, ref } from './sandbox-fixtures';

async function sandboxThreads(): Promise<ThreadModel[]> {
  return toThreadModels(await fetchThreads(fakeRpc(), ref));
}
const byPath = (models: ThreadModel[], path: string) => models.find((t) => t.path === path)!;

describe('toThreadModels on the sandbox PR', () => {
  it('maps the 3 sandbox threads to path/side/line', async () => {
    const models = await sandboxThreads();
    expect(models).toHaveLength(3);
    expect(byPath(models, 'src/util/math.ts')).toMatchObject({ id: '2910292349', side: 'additions', line: 10, subject: 'line' });
    expect(byPath(models, 'src/components/Button.ts')).toMatchObject({ id: '2910292404', side: 'additions', line: 9, subject: 'line' });
    expect(byPath(models, 'docs/with space.md')).toMatchObject({ id: '2910292428', subject: 'file' });
  });

  it('gives the multi-line thread a startLine and single-line threads none', async () => {
    const models = await sandboxThreads();
    expect(byPath(models, 'src/components/Button.ts')).toMatchObject({ startLine: 8, startSide: 'additions' });
    expect(byPath(models, 'src/util/math.ts').startLine).toBeUndefined();
    expect(byPath(models, 'src/util/math.ts').startSide).toBeUndefined();
  });

  it('flags outdated and resolved threads', async () => {
    const models = await sandboxThreads();
    expect(byPath(models, 'src/util/math.ts')).toMatchObject({ isOutdated: true, isResolved: false });
    expect(byPath(models, 'src/components/Button.ts')).toMatchObject({ isOutdated: false, isResolved: false });
    expect(byPath(models, 'docs/with space.md')).toMatchObject({ isOutdated: false, isResolved: true, subject: 'file' });
  });

  it('maps comments', async () => {
    const t = byPath(await sandboxThreads(), 'src/util/math.ts');
    expect(t.viewerCanReply).toBe(true);
    expect(t.comments).toHaveLength(1);
    const c = t.comments[0]!;
    expect(c).toMatchObject({
      databaseId: 4301727038,
      nodeId: 'PRRC_kwDOVNFBhM8AAAABAGclPg',
      author: { login: 'dangh', avatarUrl: expect.stringMatching(/^https:\/\/avatars\.githubusercontent\.com\//) },
      body: 'Single-line thread: guard clause should mention the values.',
      bodyHTML: '<p dir="auto">Single-line thread: guard clause should mention the values.</p>',
      state: 'submitted',
      viewerCanUpdate: true,
      viewerCanDelete: true,
    });
    expect(c.bodyVersion).toMatch(/^[0-9a-f]{64}$/);
    expect(c.createdAt).toBe('2026-10-17T14:26:18+08:00');
    expect(c.reactions).toHaveLength(8);
    expect(c.reactions[0]).toEqual({ content: 'THUMBS_UP', count: 0, viewerHasReacted: false });
    expect(Object.keys(c).sort()).toEqual(
      ['author', 'body', 'bodyHTML', 'bodyVersion', 'createdAt', 'databaseId', 'nodeId', 'reactions', 'state', 'url', 'viewerCanDelete', 'viewerCanUpdate'],
    );
    expect(c.url).toBe('https://github.com/dangh/pierre-sandbox/pull/1#discussion_r4301727038');
  });
});

describe('toThreadModels positions', () => {
  const threads = fixture('threads.json').pages[0].data.threads;
  const thread = (id: string, subjectType = 'LINE') => ({ ...threads[0], id, subjectType });
  const empty: RawThreads = { threads: [], markers: {}, previews: [], positioning: {} };

  it('maps LEFT markers to deletions, with a start on the other side', () => {
    const raw: RawThreads = {
      ...empty,
      threads: [thread('1')],
      markers: { 'a.ts': { L5: { threads: [{ id: 1, start: 'R3' }], annotations: [] } } },
    };
    expect(toThreadModels(raw)[0]).toMatchObject({ path: 'a.ts', side: 'deletions', line: 5, startLine: 3, startSide: 'additions', isOutdated: false });
  });

  it('falls back to thread_previews and then thread_preview_positioning', () => {
    const preview = fixture('thread-previews.json').data.find((p: { id: string }) => p.id === '2910292404');
    const raw: RawThreads = {
      ...empty,
      threads: [thread('2910292404'), thread('9')],
      previews: [{ ...preview, diffSide: 'LEFT', startDiffSide: 'LEFT', subject: { ...preview.subject, endDiffSide: 'LEFT', startDiffSide: 'LEFT' } }],
      positioning: { 9: { path: 'b.ts', endLine: 4, endDiffSide: 'LEFT', startLine: 2, startDiffSide: 'LEFT', commitOid: 'c' } },
    };
    const [a, b] = toThreadModels(raw);
    expect(a).toMatchObject({ path: 'src/components/Button.ts', side: 'deletions', line: 9, startLine: 8, startSide: 'deletions', isOutdated: false });
    expect(b).toMatchObject({ path: 'b.ts', side: 'deletions', line: 4, startLine: 2, startSide: 'deletions', isOutdated: false });
  });

  it('skips threads that cannot be placed on any file', () => {
    expect(toThreadModels({ ...empty, threads: [thread('5')] })).toEqual([]);
  });

  it('gives file-level threads line 0', () => {
    const raw: RawThreads = { ...empty, threads: [thread('6', 'FILE')], markers: { 'c.ts': { FILE: { threads: [{ id: 6 }], annotations: [] } } } };
    expect(toThreadModels(raw)[0]).toMatchObject({ path: 'c.ts', subject: 'file', line: 0, side: 'additions', isOutdated: false });
  });
});
