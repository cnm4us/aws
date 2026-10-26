const assert = require('node:assert/strict');
const test = require('node:test');
const { bundle, React: R, Test } = require('./harness.cjs');
for (const preview of [false, true]) test(`actual feed: controls, captions, resize, pause and cover cleanup (internal=${preview})`, async () => {
  const { FeedScreen, FeedStore, CaptionPreferences, e } = await bundle(`export {FeedScreen} from './src/feed/FeedScreen';export {FeedStore} from './src/feed/feedStore';export {CaptionPreferences} from './src/preferences/captionPreferences';`, preview);
  e.snapshot = { status: 'authenticated', generation: 1, validating: false };
  e.auth = { getSnapshot: () => e.snapshot, subscribe: () => () => {}, invalidate: () => {} };
  let refreshes = 0;
  const items = [1,2,3].map(id => ({ publicationId: id, playbackUrl: `https://media.test/${id}`, creator: { id: 2, displayName: 'Creator' }, hasStory: true, storyPreview: 'Preview', hasCaptions: id !== 2 }));
  e.feed = new FeedStore(async () => { refreshes++; return { items, nextCursor: null }; }); await e.feed.refresh();
  e.client = { getText: async () => 'WEBVTT\n\n00:00.000 --> 00:01.000\nFirst full sentence\n\n00:02.000 --> 00:03.000\nSecond full sentence', getJson: async () => ({ context: {kind:'space',spaceId:9}, publicationId:1, storyText:'Full story' }) };
  const captions = new CaptionPreferences({ getItem: async () => null, setItem: async () => {} }); await captions.hydrate(); await captions.setEnabled(true);
  let root, mutes = 0;
  let props = { context: {kind:'space',spaceId:9,name:'Test',type:'group'}, preferences: { toggleMute: () => mutes++ }, sound:{muted:false},
    captionPreferences:captions,captions:captions.getSnapshot(),focused:true,onSpaces:()=>{},onAccount:()=>{},onSettings:()=>{},onMenu:()=>{},onGlobal:()=>{} };
  const render = async patch => { props = {...props,...patch}; await Test.act(async () => root ? root.update(R.createElement(FeedScreen,props)) : root=Test.create(R.createElement(FeedScreen,props))); };
  const press = async label => { await Test.act(async () => root.root.findAllByType('Pressable').find(n=>n.props.accessibilityLabel===label).props.onPress()); };
  const layout = height => root.root.findAllByType('View').find(n=>n.props.onLayout).props.onLayout({nativeEvent:{layout:{height}}});
  const texts = () => root.root.findAllByType('Text').map(n=>n.props.children);
  try {
    await render({}); await Test.act(async()=>layout(600));
    const first=e.players.find(p=>p.playing); assert.ok(first); assert.equal(first.timeUpdateEventInterval,.25);
    assert.ok(texts().includes('First full sentence'));
    await press('Mute'); assert.equal(mutes,1); assert.equal(first.playing,true);
    await press('Hide captions'); await render({captions:captions.getSnapshot()}); assert.equal(texts().includes('First full sentence'),false); assert.equal(first.playing,true);
    await press('Show captions'); await render({captions:captions.getSnapshot()});
    await Test.act(async()=>{first.currentTime=2.2;first.emit('timeUpdate',{currentTime:2.2});}); assert.ok(texts().includes('Second full sentence'));
    await press('Pause video'); assert.equal(first.playing,false);
    const allocated=e.players.length, beforeLoads=first.loads;
    await press('Expand story'); assert.ok(texts().includes('Full story')); assert.equal(texts().includes('Second full sentence'),false);
    const body=root.root.findAllByType('ScrollView').find(n=>n.props.testID==='publication-story-body');
    await Test.act(async()=>body.props.onTouchStart({stopPropagation(){}}));assert.equal(root.root.findByType('FlatList').props.scrollEnabled,false);
    await Test.act(async()=>body.props.onTouchEnd());assert.equal(root.root.findByType('FlatList').props.scrollEnabled,true);
    await press('Collapse story'); assert.ok(texts().includes('Second full sentence')); assert.equal(first.playing,false);
    assert.equal(first.currentTime,2.2);assert.equal(e.players.length,allocated);assert.equal(first.loads,beforeLoads);
    await Test.act(async()=>{layout(480);}); await Test.act(async()=>{await new Promise(r=>setTimeout(r,180));});
    assert.equal(first.currentTime,2.2); assert.equal(first.playing,false); assert.ok(e.scrolls.length);
    await render({focused:false}); assert.equal(e.players.some(p=>p.playing),false); assert.equal(texts().includes('Second full sentence'),false);
    await render({focused:true}); assert.equal(first.playing,false); assert.ok(texts().includes('Second full sentence'));
    await press('Play video');
    await Test.act(async()=>{e.state='background';for(const fn of e.listeners)fn(e.state);}); assert.equal(first.playing,false);
    await Test.act(async()=>{e.state='active';for(const fn of e.listeners)fn(e.state);}); assert.equal(first.playing,true);
    const list=root.root.findByType('FlatList'); await Test.act(async()=>{list.props.onScrollBeginDrag(); list.props.onMomentumScrollEnd({nativeEvent:{contentOffset:{y:480}}});});
    assert.equal(root.root.findAllByType('Pressable').some(n=>/captions/.test(n.props.accessibilityLabel||'')),false);
    assert.ok(e.players.filter(p=>!p.released).length<=3); assert.equal(refreshes,1);
  } finally { if(root) await Test.act(async()=>root.unmount()); }
  assert.equal(e.players.some(p=>!p.released),false); assert.equal(e.players.some(p=>p.count()),false);
});
