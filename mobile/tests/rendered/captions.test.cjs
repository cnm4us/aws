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
  const loading = () => root.root.findAllByType('Text').filter(node => node.props.children === 'Loading captions').length;
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

    // Hidden/replaced requests cannot show a late cue or an old loading notice.
    await render({ publicationId: 3 }); await tick(100);
    await render({ visible: false }); assert.equal(requests[3].signal.aborted, true);
    await tick(300); assert.equal(root.toJSON(), null); assert.equal(subscriptions, 0);
    await render({ publicationId: 4, visible: true });
    await Test.act(async () => requests[3].resolve(vtt('Stale cue')));
    assert.equal(texts().includes('Stale cue'), false); assert.equal(loading(), 0);
    await Test.act(async () => requests[4].resolve(vtt('Current cue')));
    assert.ok(texts().includes('Current cue'));

    // Public Global keeps its current cue and clock while the periodic fetch is pending.
    await tick(60_000); assert.equal(loading(), 0); assert.equal(subscriptions, 1);
    assert.ok(texts().includes('Current cue'));
    await tick(300); assert.equal(loading(), 0); assert.ok(texts().includes('Current cue'));
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

for(const kind of ['global','space'])test(`periodic captions (${kind}): paused/playing refresh, failure/denial and stale completion`,async t=>{
 const {CaptionLayer,TextResources,ApiError}=await bundle("export {CaptionLayer} from './src/content/CaptionLayer';export {TextResources} from './src/content/resources';export {ApiError} from './src/api/client';");
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const requests=[],denied=[];let root,subscriptions=0,sample,now=0;
 const resources=new TextResources({getText:(_path,signal)=>new Promise((resolve,reject)=>requests.push({resolve,reject,signal}))},kind==='global'?{kind}:{kind,spaceId:9},error=>denied.push(error),()=>now);
 const vtt=text=>`WEBVTT\n\n00:00.000 --> 00:02.000\n${text}`;
 const player={subscribeClock:fn=>{subscriptions++;sample=fn;fn(.5);return()=>subscriptions--;}};
 let props={resources,publicationId:1,duration:10,player,visible:true,bottom:40,paused:true};
 const render=async patch=>{props={...props,...patch};await Test.act(async()=>root?root.update(R.createElement(CaptionLayer,props)):root=Test.create(R.createElement(CaptionLayer,props)));};
 const tick=async ms=>{now+=ms;await Test.act(async()=>t.mock.timers.tick(ms));};
 const texts=()=>root.root.findAllByType('Text').map(n=>n.props.children);
 const loading=()=>root.root.findAllByType('ActivityIndicator').length;
 try{
  await render({});await Test.act(async()=>requests[0].resolve(vtt('Original cue')));
  for(const paused of [true,false]){
   await render({paused});const original=paused?'Original cue':'Updated paused cue';
   await tick(kind==='space'?45_000:60_000);const pending=requests.at(-1);
   assert.ok(texts().includes(original));assert.equal(subscriptions,1);
   await tick(500);assert.equal(loading(),0);
   if(paused && kind==='global'){const count=requests.length;await tick(60_000);assert.equal(requests.length,count,'overlapping refresh requests must be bounded');}
   const updated=paused?'Updated paused cue':'Updated playing cue';await Test.act(async()=>pending.resolve(vtt(updated)));
   assert.ok(texts().includes(updated));assert.equal(loading(),0);assert.equal(subscriptions,1);
   if(!paused){await Test.act(async()=>sample(3));assert.ok(!texts().includes(updated));await Test.act(async()=>sample(.5));assert.ok(texts().includes(updated));}
  }
  // A failed recheck clears public cues too; explicit Retry must not restore stale text.
  await tick(kind==='space'?45_000:60_000);await Test.act(async()=>requests.at(-1).reject(Error('Offline')));
  assert.ok(!texts().includes('Updated playing cue'));assert.ok(texts().includes('Captions are unavailable. Try again.'));assert.equal(subscriptions,0);
  await Test.act(async()=>root.root.findByType('Pressable').props.onPress());await Test.act(async()=>requests.at(-1).resolve(vtt('Recovered cue')));
  assert.ok(texts().includes('Recovered cue'));
  await tick(kind==='space'?45_000:60_000);await Test.act(async()=>requests.at(-1).reject(new ApiError('Access unavailable',403,'forbidden')));
  assert.equal(denied.length,1);assert.ok(!texts().includes('Recovered cue'));assert.equal(subscriptions,0);
  await Test.act(async()=>root.root.findByType('Pressable').props.onPress());await Test.act(async()=>requests.at(-1).resolve(vtt('Before hiding')));
  await tick(kind==='space'?45_000:60_000);const hidden=requests.at(-1);await render({visible:false});assert.equal(hidden.signal.aborted,true);assert.equal(root.toJSON(),null);
  await render({publicationId:2,visible:true});const current=requests.at(-1);
  await Test.act(async()=>hidden.resolve(vtt('Stale cue')));assert.ok(!texts().includes('Stale cue'));
  await Test.act(async()=>current.resolve(vtt('Current publication cue')));assert.ok(texts().includes('Current publication cue'));
 }finally{if(root)await Test.act(async()=>root.unmount());resources.clear();t.mock.timers.reset();}
 assert.equal(subscriptions,0);
});

test('paused seek resamples captions immediately without a clock tick or resource refetch',async t=>{
 const {CaptionLayer,TextResources}=await bundle("export {CaptionLayer} from './src/content/CaptionLayer';export {TextResources} from './src/content/resources';");
 let reads=0,time=1,root;
 const resources=new TextResources({getText:async()=>{reads++;return 'WEBVTT\n\n00:00.000 --> 00:02.000\nFirst caption contains several words\n\n00:04.000 --> 00:08.000\nSecond caption contains several words';}},{kind:'global'},()=>{});
 const player={subscribeClock:fn=>{fn(time);return()=>{};}};
 let props={resources,publicationId:1,duration:10,player,visible:true,bottom:40,paused:true,seekRevision:0,seeking:false};
 const render=async patch=>{props={...props,...patch};await Test.act(async()=>root?root.update(R.createElement(CaptionLayer,props)):root=Test.create(R.createElement(CaptionLayer,props)));};
 const texts=()=>root.root.findAllByType('Text').map(n=>n.props.children);
 try{await render({});assert.ok(texts().includes('First caption contains several words'));await render({seeking:true});assert.equal(texts().includes('First caption contains several words'),false);time=5;await render({seeking:false,seekRevision:1});assert.ok(texts().includes('Second caption contains several words'));assert.equal(reads,1);}finally{await Test.act(async()=>root?.unmount());resources.clear();}
});
