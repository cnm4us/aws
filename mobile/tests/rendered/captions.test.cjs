const assert = require('node:assert/strict');
const test = require('node:test');
const { bundle, React: R, Test } = require('./harness.cjs');

test('caption notice waits while cues, errors and retry remain immediate; stale loads cannot return', async t => {
  const { CaptionLayer, TextResources } = await bundle("export {CaptionLayer} from './src/content/CaptionLayer';export {TextResources} from './src/content/resources';");
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const requests = [];
  const resources = new TextResources({ getText: (_path, signal) => new Promise((resolve, reject) => requests.push({ resolve, reject, signal })) }, { kind: 'global' }, () => {});
  const vtt = text => `WEBVTT\n\n00:00.000 --> 00:02.000\n${text}`;
  let root, subscriptions = 0;
  const player = { subscribeClock: fn => { subscriptions++; fn(.5); return () => subscriptions--; } };
  let props = { resources, publicationId: 1, duration: 10, player, visible: true, bottom: 40, paused: false };
  const render = async patch => {
    props = { ...props, ...patch };
    await Test.act(async () => root ? root.update(R.createElement(CaptionLayer, props)) : root = Test.create(R.createElement(CaptionLayer, props)));
  };
  const tick = async ms => { await Test.act(async () => t.mock.timers.tick(ms)); };
  const loading = () => root.root.findAllByType('ActivityIndicator').length;
  const texts = () => root.root.findAllByType('Text').map(node => node.props.children);
  try {
    await render({}); assert.equal(loading(), 0);
    await tick(100);
    await Test.act(async () => requests[0].resolve(vtt('First cue')));
    assert.ok(texts().includes('First cue')); assert.equal(subscriptions, 1);
    await tick(300); assert.equal(loading(), 0);

    // A genuinely slow next publication gets feedback; the previous cue clears immediately.
    await render({ publicationId: 2 }); assert.equal(texts().includes('First cue'), false);
    await tick(299); assert.equal(loading(), 0);
    await tick(1); assert.equal(loading(), 1);
    await Test.act(async () => requests[1].reject(Error('Network unavailable')));
    assert.equal(loading(), 0); assert.ok(texts().includes('Captions are unavailable. Try again.'));
    await Test.act(async () => root.root.findByType('Pressable').props.onPress());
    assert.equal(loading(), 0); assert.equal(texts().includes('Captions are unavailable. Try again.'), false);
    await Test.act(async () => requests[2].resolve(vtt('Retried cue')));
    assert.ok(texts().includes('Retried cue'));

    // Hidden/replaced requests cannot show a late cue or start an old spinner.
    await render({ publicationId: 3 }); await tick(100);
    await render({ visible: false }); assert.equal(requests[3].signal.aborted, true);
    await tick(300); assert.equal(root.toJSON(), null); assert.equal(subscriptions, 0);
    await render({ publicationId: 4, visible: true });
    await Test.act(async () => requests[3].resolve(vtt('Stale cue')));
    assert.equal(texts().includes('Stale cue'), false); assert.equal(loading(), 0);
    await Test.act(async () => requests[4].resolve(vtt('Current cue')));
    assert.ok(texts().includes('Current cue'));

    // Periodic revalidation uses the same delay, without retaining old cues while loading.
    await tick(60_000); assert.equal(loading(), 0); assert.equal(subscriptions, 0);
    await tick(300); assert.equal(loading(), 1);
    await Test.act(async () => requests[5].resolve(vtt('Fresh cue')));
    assert.equal(loading(), 0); assert.ok(texts().includes('Fresh cue'));
    await render({ publicationId: 5 });
    await Test.act(async () => root.unmount()); root = null;
    assert.equal(requests[6].signal.aborted, true); assert.equal(subscriptions, 0);
    await tick(60_300);
  } finally {
    if (root) await Test.act(async () => root.unmount());
    resources.clear(); t.mock.timers.reset();
  }
});
