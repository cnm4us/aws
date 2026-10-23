const assert=require('node:assert/strict'),test=require('node:test');
const {bundle,React:R,Test}=require('./harness.cjs');

async function setup(t,{paused=true}={}){
 t.mock.timers.enable({apis:['setTimeout','setInterval']});let now=0;
 t.mock.method(performance,'now',()=>now);
 const h=await bundle("export {FeedScreen} from './src/feed/FeedScreen';export {FeedStore} from './src/feed/feedStore';export {CaptionPreferences} from './src/preferences/captionPreferences';export {AuthStore} from './src/auth/authStore';export {ApiError} from './src/api/client';",true,false,true);
 const {FeedScreen,FeedStore,CaptionPreferences,AuthStore,e}=h;
 const session={token:'test',expiresAt:'2030-01-01',viewer:{id:1,displayName:'Test'}},pending=[];
 let validations=0,spaceReads=0,captionReads=0,mode='success',root;
 e.auth=new AuthStore('https://api.test',{login:async()=>session,validate:()=>{validations++;if(mode==='pending')return new Promise((resolve,reject)=>pending.push({resolve,reject}));return Promise.resolve(session);},revoke:async()=>{}},{load:async()=>null,save:async()=>{},clear:async()=>{}});
 await e.auth.restore();await e.auth.signIn('test@example.invalid','test');
 // Match AuthProvider's fallback timer. Enter the space at app age 50 seconds.
 const accountTimer=setInterval(()=>{void e.auth.validateRoutine();},60_000);now=50_000;t.mock.timers.tick(50_000);
 e.client={getJson:async()=>{spaceReads++;return{items:[]};},getText:async()=>{captionReads++;return 'WEBVTT\n\n00:02.000 --> 00:09.000\nProtected caption';}};
 e.feed=new FeedStore(async()=>({items:[{publicationId:1,playbackUrl:'https://media.test/1',posterUrl:null,creator:{id:2,displayName:'Test',avatarUrl:null},hasCaptions:true,hasStory:false}],nextCursor:null}));await e.feed.refresh();
 const captions=new CaptionPreferences({getItem:async()=>null,setItem:async()=>{}});await captions.hydrate();await captions.setEnabled(true);
 let props={context:{kind:'space',spaceId:9,name:'Test',type:'group'},preferences:{toggleMute:()=>{}},sound:{muted:false},captionPreferences:captions,captions:captions.getSnapshot(),focused:true,onSpaces:()=>{},onMenu:()=>{},onGlobal:()=>{}};
 const render=async patch=>{props={...props,...patch};await Test.act(async()=>{root?root.update(R.createElement(FeedScreen,props)):root=Test.create(R.createElement(FeedScreen,props));});};
 const texts=()=>root.root.findAllByType('Text').map(n=>n.props.children);
 const tick=async ms=>{now+=ms;await Test.act(async()=>t.mock.timers.tick(ms));};
 const app=async state=>{await Test.act(async()=>{e.state=state;for(const listener of e.listeners)listener(state);});};
 await render({});await Test.act(async()=>root.root.findAllByType('View').find(n=>n.props.onLayout).props.onLayout({nativeEvent:{layout:{height:600}}}));
 const player=e.players.find(p=>p.playing);assert.ok(player);await Test.act(async()=>{player.currentTime=5;player.emit('timeUpdate',{currentTime:5});if(paused)root.root.findAllByType('Pressable').find(n=>n.props.accessibilityLabel==='Pause video').props.onPress();});
 assert.ok(texts().includes('Protected caption'));
 t.after(async()=>{clearInterval(accountTimer);if(root)await Test.act(async()=>root.unmount());e.auth.dispose();t.mock.timers.reset();assert.equal(e.players.some(p=>!p.released),false);});
 return {...h,session,pending,player,texts,tick,app,render,getRoot:()=>root,setMode:value=>{mode=value;},counts:()=>({validations,spaceReads,captionReads})};
}
for(const paused of [true,false])test(`real protected hook renews quietly across different app/space ages, paused=${paused}`,async t=>{
 const h=await setup(t,{paused});const start=h.counts();
 // The old app timer fired at space +10/+70; space timer at +60/+120.
 for(const gap of [10_000,35_000,5_000,10_000,10_000,20_000,30_000]){
  await h.tick(gap);assert.ok(!h.texts().includes('Checking access'));assert.ok(h.texts().includes('Protected caption'));
  assert.equal(h.player.currentTime,5);assert.equal(h.player.playing,!paused);assert.equal(h.getRoot().root.findByType('VideoView').parent.props.player,h.player);
 }
 assert.equal(h.counts().validations,start.validations+2);assert.equal(h.counts().spaceReads,start.spaceReads+2);
 h.setMode('pending');await h.tick(15_000);assert.equal(h.pending.length,1);assert.equal(h.player.playing,!paused);assert.ok(h.texts().includes('Protected caption'));assert.ok(!h.texts().includes('Checking access'));
 await Test.act(async()=>h.pending.shift().resolve(h.session));assert.equal(h.player.playing,!paused);assert.ok(h.texts().includes('Protected caption'));
});
test('real protected hook expires a hanging renewal at 60 seconds and rejects late success',async t=>{
 const h=await setup(t,{paused:false});h.setMode('pending');await h.tick(45_000);assert.equal(h.player.playing,true);
 await h.tick(14_999);assert.equal(h.player.playing,true);await h.tick(1);
 assert.equal(h.player.playing,false);assert.ok(!h.texts().includes('Protected caption'));assert.ok(h.texts().includes('Cannot verify access'));
 await Test.act(async()=>h.pending.shift().resolve(h.session));assert.equal(h.player.playing,false);assert.ok(!h.texts().includes('Protected caption'));
 h.setMode('success');await Test.act(async()=>h.getRoot().root.findAllByType('Pressable').find(n=>n.props.accessibilityLabel==='Try again').props.onPress());
 assert.equal(h.player.playing,true);assert.equal(h.player.currentTime,5);assert.ok(h.texts().includes('Protected caption'));
});
for(const status of [401,503])test(`real protected hook blocks immediately on account failure ${status}`,async t=>{
 const h=await setup(t,{paused:false});h.setMode('pending');await h.tick(45_000);assert.equal(h.player.playing,true);
 await Test.act(async()=>h.pending.shift().reject(new h.ApiError('failed',status)));
 assert.equal(h.player.playing,false);assert.ok(!h.texts().includes('Protected caption'));
 assert.equal(h.e.auth.getSnapshot().status,status===401?'anonymous':'unavailable');
 if(status===503){h.setMode('success');await Test.act(async()=>{await h.e.auth.retryValidation();});assert.equal(h.player.playing,true);assert.equal(h.player.currentTime,5);assert.ok(h.texts().includes('Protected caption'));}
});
test('real protected hook requires fresh verification on covered/background return and ignores replaced-context completion',async t=>{
 const h=await setup(t);h.setMode('pending');await h.tick(45_000);const old=h.pending.shift();
 await h.render({focused:false});assert.ok(!h.texts().includes('Protected caption'));await h.render({focused:true});assert.ok(h.texts().includes('Checking access'));
 await Test.act(async()=>old.resolve(h.session));assert.ok(h.texts().includes('Protected caption'));assert.equal(h.player.playing,false);
 h.setMode('pending');await h.app('background');assert.ok(!h.texts().includes('Protected caption'));await h.app('active');assert.ok(h.texts().includes('Checking access'));
 await Test.act(async()=>h.pending.shift().resolve(h.session));assert.ok(h.texts().includes('Protected caption'));assert.equal(h.player.playing,false);
 await h.tick(45_000);const previous=h.pending.shift();await h.render({context:{kind:'space',spaceId:10,name:'Other',type:'group'}});
 await Test.act(async()=>previous.resolve(h.session));assert.ok(h.texts().includes('Protected caption'));assert.equal(h.player.playing,false);
 const before=h.counts().spaceReads;await Test.act(async()=>h.e.auth.signOut());assert.equal(h.player.playing,false);assert.ok(!h.texts().includes('Protected caption'));
 assert.ok(before>=4);
});
test('real protected hook clears the feed on space denial and cannot reuse access across identity changes',async t=>{
 const h=await setup(t,{paused:false});
 h.e.client.getJson=async()=>{throw new h.ApiError('Access unavailable',403,'forbidden');};
 await h.tick(45_000);assert.equal(h.player.playing,false);assert.ok(!h.texts().includes('Protected caption'));assert.equal(h.e.feed.getSnapshot().items.length,0);assert.ok(h.texts().includes('Access unavailable'));
 assert.equal(h.e.auth.getSnapshot().status,'authenticated');
 // Recover the feed, then replace the account while a routine verifier is pending.
 h.e.client.getJson=async()=>({items:[]});await Test.act(async()=>{await h.e.feed.refresh();});
 await h.render({focused:false});await h.render({focused:true});
 await Test.act(async()=>h.getRoot().root.findAllByType('View').find(n=>n.props.onLayout).props.onLayout({nativeEvent:{layout:{height:600}}}));
 await Test.act(async()=>{const player=h.e.players.find(p=>p.playing);assert.ok(player);player.currentTime=5;player.emit('timeUpdate',{currentTime:5});});
 assert.ok(h.texts().includes('Protected caption'));
 h.setMode('pending');await h.tick(45_000);const old=h.pending.shift();assert.ok(old);
 await Test.act(async()=>h.e.auth.signOut());assert.ok(!h.texts().includes('Protected caption'));
 await Test.act(async()=>old.resolve(h.session));assert.equal(h.e.auth.getSnapshot().status,'anonymous');assert.ok(!h.texts().includes('Protected caption'));assert.equal(h.e.players.some(p=>p.playing),false);
});
