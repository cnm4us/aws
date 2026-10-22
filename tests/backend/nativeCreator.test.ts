import assert from 'node:assert/strict';
import test from 'node:test';
import { projectCreator } from '../../src/features/profiles/viewer';
import { parseViewerQuery } from '../../src/features/feeds/viewer';
import { aroundPublication } from '../../src/features/feeds/resume';

test('nominal identity never uses hidden profile fields or email as fallback', () => {
  assert.deepEqual(projectCreator({ id: 5, account_name: 'Public name', slug: 'creator',
    is_public: 0, display_name: 'Private name', avatar_url: 'https://example.com/private', bio: 'Private bio', show_bio: 1 }),
  { id: 5, displayName: 'Public name', handle: 'creator', avatarUrl: null, bio: null });
  assert.equal(projectCreator({ id: 5, email: 'hidden@example.com' })?.displayName, 'Creator');
  assert.equal(projectCreator({ id: 5, deleted_at: '2026-01-01' }), null);
});
test('public optional fields obey visibility and URL constraints', () => {
  const row = { id: 5, account_name: 'Account', is_public: 1, display_name: 'Profile',
    avatar_url: 'https://media.example.com/avatar.jpg', bio: 'Visible', show_bio: 1 };
  assert.equal(projectCreator(row)?.bio, 'Visible');
  assert.equal(projectCreator({ ...row, show_bio: 0 })?.bio, null);
  assert.equal(projectCreator({ ...row, avatar_url: 'https://user:pass@example.com/avatar' })?.avatarUrl, null);
});
test('anchor queries are strict and cannot combine a cursor with an anchor', () => {
  assert.equal(parseViewerQuery({ anchorPublicationId: '5', limit: '60' }).anchorPublicationId, 5);
  for (const anchorPublicationId of ['0', '-1', '1.2', '2e3', ['5'], '9007199254740992']) {
    assert.throws(() => parseViewerQuery({ anchorPublicationId }));
  }
  assert.throws(() => parseViewerQuery({ anchorPublicationId: '5', cursor: '2026-10-18 00:00:00|6' }));
});
test('return window keeps exact publication identity and bounded pagination', async () => {
  const publication = (id: number) => ({ publication: { id, published_at: '2026-10-18 00:00:00' } } as any);
  const requests: any[] = [];
  const load = async (selection: any) => {
    requests.push(selection);
    if (selection.publicationId) return { items: [publication(9)], nextCursor: null };
    if (selection.newerThan) return { items: [publication(10)], nextCursor: 'ignored' };
    return { items: [publication(8), publication(7), publication(6), publication(5)], nextCursor: 'older' };
  };
  const result = await aroundPublication(load, 9, 6);
  assert.deepEqual(result.items.map(x => x.publication.id), [10, 9, 8, 7, 6, 5]);
  assert.equal(result.nextCursor, 'older');
  assert.equal(requests[2].limit, 4);
  assert.equal(result.resume.restoredPublicationId, 9);
  const unavailable = await aroundPublication(async selection => ({ items: selection.publicationId ? [] : [publication(3)], nextCursor: null }), 9, 6);
  assert.equal(unavailable.resume.outcome, 'unavailable');
  assert.equal(unavailable.resume.restoredPublicationId, null);
});
