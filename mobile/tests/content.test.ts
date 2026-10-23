import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVtt, cueAt } from '../src/content/vtt';
import { TextResources } from '../src/content/resources';
import { ApiError, createApiClient } from '../src/api/client';
import { CaptionPreferences, CAPTION_PREFERENCES_KEY } from '../src/preferences/captionPreferences';
import { PLAYBACK_PREFERENCES_KEY } from '../src/preferences/playbackPreferences';
import { adaptViewerFeedPage } from '../src/feed/adaptFeed';

const vtt = 'WEBVTT\n\none\n00:00.000 --> 00:00.100 position:50%\nThis is a full sentence\n\n00:02.000 --> 00:02.100\nAnother complete sentence here\n\n00:03.000 --> 00:03.100\nend';
test('viewer metadata remains backward compatible and excludes full story/transcript fields', () => {
  const input = { context: { kind: 'global' }, nextCursor: null, items: [{ publicationId: 1, storyText: 'private extra', transcript: 'private extra' }] };
  const absent = adaptViewerFeedPage(input, { kind: 'global' }).items[0];
  assert.equal(absent.hasStory, false); assert.equal(absent.hasCaptions, false); assert.equal(absent.storyPreview, null);
  assert.equal(JSON.stringify(absent).includes('private'), false);
  Object.assign(input.items[0], { hasStory: true, hasCaptions: true, storyPreview: 'Preview' });
  const present = adaptViewerFeedPage(input, { kind: 'global' }).items[0];
  assert.equal(present.hasStory, true); assert.equal(present.hasCaptions, true); assert.equal(present.storyPreview, 'Preview');
});
test('VTT handles identifiers, BOM/CRLF, plain text and app linger/merging', () => {
  const cues = parseVtt('\uFEFF' + vtt.replace(/\n/g, '\r\n'));
  assert.deepEqual(cues, [
    { startMs: 0, endMs: 900, text: 'This is a full sentence' },
    { startMs: 2000, endMs: 4600, text: 'Another complete sentence here end' },
  ]);
  assert.equal(cueAt(cues, 0), cues[0].text); assert.equal(cueAt(cues, .9), null);
  assert.equal(cueAt(cues, 2), cues[1].text); assert.equal(cueAt(cues, 4.6), null);
  assert.equal(cueAt(cues, .1), cues[0].text); // loop/backward seek
  assert.equal(parseVtt(vtt, 3.5)[1].endMs, 3500);
});
test('VTT skips style/comment/region blocks, decodes entities and strips cue markup', () => {
  const cues = parseVtt('WEBVTT\n\nNOTE hidden\n00:00.000 --> 00:02.000\nnot a cue\n\nSTYLE\n::cue {color:red}\n\nREGION\nid:r\n\n00:00:01.000 --> 00:00:03.000\n<v Alice><b>Fish &amp; chips</b>\n&#x1f600; &lt;ok&gt;');
  assert.equal(cues.length, 1); assert.equal(cues[0].text, 'Fish & chips\n😀 <ok>');
});
test('VTT rejects invalid ranges/overflow and handles duplicate starts and gaps deterministically', () => {
  assert.throws(() => parseVtt('not VTT'));
  assert.throws(() => parseVtt('WEBVTT\n\n00:99.000 --> 00:00.000\nbad'));
  assert.throws(() => parseVtt('WEBVTT\n\n00:00.000 --> 00:01.000\n' + 'x'.repeat(8193)));
  assert.throws(() => parseVtt('x'.repeat(1024 * 1024 + 1)));
  assert.deepEqual(parseVtt('WEBVTT\n\nNOTE none'), []);
  const cues = parseVtt('WEBVTT\n\n00:00.000 --> 00:04.000\nfirst full sentence\n\n00:00.000 --> 00:01.000\nsecond full sentence\n\n00:02.000 --> 00:03.000\nthird full sentence');
  assert.equal(cues[0].text, 'second full sentence'); assert.equal(cueAt(cues, 1.5), null); assert.equal(cueAt(cues, -1), null);
});
test('bounded text transport uses native safety rules and typed caption absence', async () => {
  let init: RequestInit | undefined;
  const client = createApiClient('https://example.com', { getHeaders: () => ({ Authorization: 'Bearer fixture' }), fetchImpl: async (_u, options) => {
    init = options; return new Response(vtt, { headers: { 'content-type': 'text/vtt' } });
  } });
  assert.equal(await client.getText('/api/viewer/v1/feed/global/publications/1/captions.vtt'), vtt);
  assert.equal(init?.credentials, 'omit'); assert.equal(init?.redirect, 'error');
  await assert.rejects(client.getText('/api/publications/1/captions.vtt'), /Credentials/);
  const absent = createApiClient('https://example.com', { fetchImpl: async () => Response.json({ error: 'captions_not_found' }, { status: 404 }) });
  await assert.rejects(absent.getText('/api/viewer/v1/x'), { code: 'captions_not_found' });
});
test('bounded text transport rejects MIME and declared/chunked overflow, aborting readers', async () => {
  for (const response of [new Response('html'), new Response('x', { headers: { 'content-type': 'text/vtt', 'content-length': String(1024 * 1024 + 1) } }),
    new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(1024 * 1024)); c.enqueue(new Uint8Array(1)); c.close(); } }), { headers: { 'content-type': 'text/vtt' } })]) {
    const client = createApiClient('https://example.com', { fetchImpl: async () => response });
    await assert.rejects(client.getText('/api/viewer/v1/x'));
  }
  const controller = new AbortController(); let cancelled = false;
  const client = createApiClient('https://example.com', { fetchImpl: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/vtt' } }) });
  const request = client.getText('/api/viewer/v1/x', controller.signal);
  await Promise.resolve(); controller.abort();
  await assert.rejects(request, { name: 'AbortError' }); assert.equal(cancelled, true);
});
test('resource cache expires, is bounded, rejects mismatched stories and ignores late responses', async () => {
  let now = 0, calls = 0;
  const client = { getText: async () => vtt, getJson: async (path: string) => { calls++; return { context: { kind: 'global' }, publicationId: Number(path.split('/').at(-2)), storyText: 'text' }; } };
  const store = new TextResources(client, { kind: 'global' }, () => {}, () => now), signal = new AbortController().signal;
  await store.story(1, signal); await store.story(1, signal); assert.equal(calls, 1);
  now = 60_000; await store.story(1, signal); assert.equal(calls, 2);
  for (let i = 2; i < 23; i++) await store.story(i, signal);
  const before = calls; await store.story(1, signal); assert.equal(calls, before + 1);
  let resolve!: (v: any) => void;
  client.getJson = async () => new Promise(r => { resolve = r; });
  const pending = store.story(100, signal); store.clear();
  resolve({ context: { kind: 'global' }, publicationId: 100, storyText: 'old account' });
  await assert.rejects(pending, { name: 'AbortError' });
  client.getJson = async () => ({ context: { kind: 'global' }, publicationId: 3, storyText: 'wrong publication' });
  await assert.rejects(store.story(100, signal), /unexpected story/);
});
test('missing captions leave feed authority intact; actual denial clears cache and calls protection', async () => {
  let denied = 0;
  const client = { getText: async (): Promise<string> => { throw new ApiError('none', 404, 'captions_not_found'); }, getJson: async () => null };
  const store = new TextResources(client, { kind: 'global' }, () => { denied++; });
  await assert.rejects(store.captions(1, null, new AbortController().signal)); assert.equal(denied, 0);
  client.getText = async () => { throw new ApiError('gone', 404, 'publication_not_found'); };
  await assert.rejects(store.captions(1, null, new AbortController().signal)); assert.equal(denied, 1);
});
test('caption preference defaults off and serializes rapid writes without touching sound', async () => {
  const values = new Map([[PLAYBACK_PREFERENCES_KEY, 'sound data']]);
  const store = new CaptionPreferences({ getItem: async key => values.get(key) ?? null, setItem: async (key, value) => { await Promise.resolve(); values.set(key, value); } });
  await store.hydrate(); assert.equal(store.getSnapshot().enabled, false);
  await Promise.all([store.setEnabled(true), store.setEnabled(false), store.setEnabled(true)]);
  assert.equal(JSON.parse(values.get(CAPTION_PREFERENCES_KEY)!).enabled, true);
  assert.equal(values.get(PLAYBACK_PREFERENCES_KEY), 'sound data');
  const restored = new CaptionPreferences({ getItem: async key => values.get(key) ?? null, setItem: async () => {} });
  await restored.hydrate(); assert.equal(restored.getSnapshot().enabled, true);
});
test('preference failures retain the in-session choice and can retry persistence', async () => {
  let fail = true;
  const store = new CaptionPreferences({ getItem: async () => 'corrupt', setItem: async () => { if (fail) throw Error('disk'); } });
  await store.hydrate(); assert.equal(store.getSnapshot().enabled, false); assert.ok(store.getSnapshot().error);
  await store.setEnabled(true); assert.equal(store.getSnapshot().enabled, true); assert.match(store.getSnapshot().error!, /could not be saved/);
  fail = false; await store.retry(); assert.equal(store.getSnapshot().error, null);
});
test('caption/story cache hits preserve verification age and count request start, not response completion',async()=>{
 let now=1000,resolve!:(v:any)=>void;
 const client={getText:async()=>vtt,getJson:async()=>new Promise(r=>resolve=r)};
 const resources=new TextResources(client,{kind:'space',spaceId:9,name:'Test',type:'group'},()=>{},()=>now),signal=new AbortController().signal;
 const pending=resources.verifiedStory(1,signal);now=5000;resolve({context:{kind:'space',spaceId:9},publicationId:1,storyText:'protected'});
 assert.equal((await pending).verifiedAt,1000);now=55_000;assert.equal((await resources.verifiedStory(1,signal)).verifiedAt,1000);
 const captions=await resources.verifiedCaptions(1,null,signal);assert.equal(captions.verifiedAt,55_000);
 now=59_000;assert.equal((await resources.verifiedCaptions(1,null,signal)).verifiedAt,55_000);resources.clear();
});
