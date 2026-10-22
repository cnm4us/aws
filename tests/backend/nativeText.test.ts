import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { createViewerTextService, MAX_VTT_BYTES, readBoundedVtt, textId } from '../../src/features/publications/viewerText';
import { serializeViewerVideo } from '../../src/features/feeds/viewer';

function fixture() {
  let permitted = true, objects = 0;
  const deps: any = {
    global: async (s: any) => permitted && s.publicationId === 5 ? [{ publication_id: 5, space_id: 9, production_id: 2 }] : [],
    space: async (id: number, s: any) => permitted && id === 9 && s.publicationId === 6 ? [{ publication_id: 6, space_id: 9, production_id: 2 }] : [],
    assertSpace: async (_id: number, user: number) => { if (user !== 1) throw Object.assign(Error('denied'), { status: 403 }); },
    publication: async (id: number) => ({ story_text: id === 5 ? 'Global story' : 'Personal story' }),
    pointer: async () => ({ bucket: 'private', key: 'private' }),
    object: async () => { objects++; return { Body: Readable.from(['WEBVTT\n\n00:00.000 --> 00:01.000\nHello']) }; },
  };
  return { deps, service: createViewerTextService(deps), revoke: () => { permitted = false; }, objects: () => objects };
}
test('text reads use exact publication and context, never another publication of the production', async () => {
  const f = fixture();
  assert.equal((await f.service.story({ kind: 'global' }, 5, null)).storyText, 'Global story');
  assert.equal((await f.service.story({ kind: 'space', spaceId: 9 }, 6, 1)).storyText, 'Personal story');
  await assert.rejects(f.service.story({ kind: 'global' }, 6, 1), { code: 'publication_not_found' });
  await assert.rejects(f.service.story({ kind: 'space', spaceId: 9 }, 5, 1), { code: 'publication_not_found' });
});
test('authority precedes object access and is checked again after loading', async () => {
  const f = fixture(), signal = new AbortController().signal;
  await assert.rejects(f.service.captions({ kind: 'space', spaceId: 9 }, 6, null, signal), { code: 'unauthorized' });
  await assert.rejects(f.service.captions({ kind: 'space', spaceId: 9 }, 6, 2, signal), { status: 403 });
  await assert.rejects(f.service.captions({ kind: 'global' }, 6, null, signal), { code: 'publication_not_found' });
  assert.equal(f.objects(), 0);
  f.deps.object = async () => { f.revoke(); return { Body: Readable.from(['WEBVTT']) }; };
  await assert.rejects(f.service.captions({ kind: 'global' }, 5, null, signal), { code: 'publication_not_found' });
});
test('missing production captions, resource failures and empty stories have distinct results', async () => {
  const f = fixture(), signal = new AbortController().signal;
  f.deps.publication = async () => ({ story_text: '  ' });
  assert.equal((await f.service.story({ kind: 'global' }, 5, null)).storyText, null);
  f.deps.pointer = async () => null;
  await assert.rejects(f.service.captions({ kind: 'global' }, 5, null, signal), { code: 'captions_not_found' });
  f.deps.pointer = async () => ({ bucket: 'x', key: 'y' });
  f.deps.object = async () => { throw Error('secret object URL'); };
  await assert.rejects(f.service.captions({ kind: 'global' }, 5, null, signal), { code: 'captions_unavailable' });
});
test('VTT is bounded for declared and chunked lengths, invalid UTF8 and cancellation', async () => {
  await assert.rejects(readBoundedVtt(Readable.from(['x']), MAX_VTT_BYTES + 1), { code: 'captions_unavailable' });
  await assert.rejects(readBoundedVtt(Readable.from([Buffer.alloc(MAX_VTT_BYTES), 'x'])), { code: 'captions_unavailable' });
  await assert.rejects(readBoundedVtt(Readable.from([Buffer.from([255])])), { code: 'captions_unavailable' });
  const c = new AbortController(); c.abort();
  await assert.rejects(readBoundedVtt(Readable.from(['x']), undefined, c.signal), { code: 'captions_unavailable' });
  assert.equal(await readBoundedVtt(Readable.from(['WEB', 'VTT'])), 'WEBVTT');
});
test('strict IDs and allowlisted additive feed metadata', () => {
  for (const id of ['0', '-1', '1.5', '1e2', '9007199254740992']) assert.throws(() => textId(id));
  const v = serializeViewerVideo({ publication: { id: 1, has_story: true, story_preview: 'preview', has_captions: true, story_text: 'full secret' }, upload: {} } as any);
  assert.equal(v.hasStory, true); assert.equal(v.storyPreview, 'preview'); assert.equal(v.hasCaptions, true);
  assert.equal(JSON.stringify(v).includes('full secret'), false);
});

test('object stream failure and post-read permission loss never send successful partial content', async () => {
  const stream = Readable.from((async function* () { yield 'WEBVTT'; throw Error('private upstream URL'); })());
  await assert.rejects(readBoundedVtt(stream), { code: 'captions_unavailable' });
  const f = fixture();
  f.deps.assertSpace = async () => { if (f.objects()) throw Object.assign(Error('denied'), { status: 403 }); };
  await assert.rejects(f.service.captions({ kind: 'space', spaceId: 9 }, 6, 1, new AbortController().signal), { status: 403 });
});

test('oversized stored story is a resource error, not a production fallback', async () => {
  const f = fixture(); f.deps.publication = async () => ({ story_text: 'x'.repeat(2001) });
  await assert.rejects(f.service.story({ kind: 'global' }, 5, null), { code: 'story_unavailable' });
});
