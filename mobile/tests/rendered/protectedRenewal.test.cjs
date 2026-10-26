const assert=require('node:assert/strict'),test=require('node:test');
const {bundle,React:R,Test}=require('./harness.cjs');
async function setup(t,{paused=true}={}){
 t.mock.timers.enable({apis:['setTimeout','setInterval']});let now=0;t.mock.method(performance,'now',()=>now);
 const h=await bundle("export {FeedScreen} from './src/feed/FeedScreen';export {CaptionPreferences} from './src/preferences/captionPreferences';export {AuthStore} from './src/auth/authStore';",true,true,true);
 const {FeedScreen,CaptionPreferences,AuthStore,e}=h,session={token:'test',expiresAt:'2030-01-01',viewer:{id:1,displayName:'Test'}};
 e.auth=new AuthStore('https://api.test',{login:async()=>session,validate:async()=>{e.validations++;if(e.sessionUnavailable)throw Error('offline');return session;},revoke:async()=>{}},{load:async()=>null,save:async()=>{},clear:async()=>{}});e.validations=0;await e.auth.restore();await e.auth.signIn('a','b');e.serverAccess=true;
 let mode='success',reads=0,pending=[],root;
 const space={id:9,name:'Test',type:'group'},items=[1,2,3].map(publicationId=>({publicationId,spaceId:9,uploadId:1,productionUlid:null,playbackUrl:`https://media.test/${publicationId}`,posterUrl:null,creator:{id:2,displayName:'Test',avatarUrl:null},hasCaptions:true,hasStory:false}));
 const liveItems=()=>items.map(i=>e.mediaSuffix?{...i,playbackUrl:i.playbackUrl+'?revision='+e.mediaSuffix}:i);
 e.methods=[];e.fetch=async(url,options={})=>{e.methods.push(options.method||'GET');
  const u=new URL(url);if(u.pathname.endsWith('captions.vtt')&&e.captionsMissing)return new Response(JSON.stringify({error:'captions_not_found'}),{status:404,headers:{'Content-Type':'application/json'}});
  if(u.pathname.endsWith('captions.vtt'))return new Response('WEBVTT\n\n00:02.000 --> 00:09.000\nProtected caption',{headers:{'Content-Type':'text/vtt'}});
  if(u.pathname.endsWith('playback-access')){reads++;
   if(mode==='pending')return new Promise(resolve=>pending.push(()=>resolve(new Response(JSON.stringify({context:{kind:'space',space},items:liveItems(),nextCursor:null}),{headers:{'Content-Type':'application/json'}}))));
   if(mode!=='success')return new Response(JSON.stringify({error:mode===401?'unauthorized':mode===403?'forbidden':'service_unavailable'}),{status:mode,headers:{'Content-Type':'application/json'}});
  }
  return new Response(JSON.stringify({context:{kind:'space',space},items:liveItems(),nextCursor:null}),{headers:{'Content-Type':'application/json'}});
 };
 const captions=new CaptionPreferences({getItem:async()=>null,setItem:async()=>{}});await captions.hydrate();await captions.setEnabled(true);
 let props={context:{kind:'space',spaceId:9,name:'Test',type:'group'},preferences:{toggleMute:()=>{}},sound:{muted:false},captionPreferences:captions,captions:captions.getSnapshot(),focused:true,onSpaces:()=>{},onMenu:()=>{},onGlobal:()=>{}};
 const render=async patch=>{props={...props,...patch};await Test.act(async()=>{root?root.update(R.createElement(FeedScreen,props)):root=Test.create(R.createElement(FeedScreen,props));});};
 const texts=()=>root.root.findAllByType('Text').map(n=>n.props.children),labels=()=>root.root.findAllByType('Pressable').map(n=>n.props.accessibilityLabel);
 const tick=async ms=>{now+=ms;await Test.act(async()=>t.mock.timers.tick(ms));};
 const app=async state=>{await Test.act(async()=>{e.state=state;for(const listener of e.listeners)listener(state);});};
 await render({});await Test.act(async()=>root.root.findAllByType('View').find(n=>n.props.onLayout).props.onLayout({nativeEvent:{layout:{height:600}}}));
 const player=e.players.find(p=>p.playing);assert.ok(player);await Test.act(async()=>{player.currentTime=5;player.emit('timeUpdate',{currentTime:5});if(paused)root.root.findAllByType('Pressable').find(n=>n.props.accessibilityLabel==='Pause video').props.onPress();});assert.ok(texts().includes('Protected caption'));
 t.after(async()=>{await Test.act(async()=>root.unmount());e.auth.dispose();t.mock.timers.reset();assert.equal(e.players.some(p=>!p.released),false);});
 return {...h,player,texts,labels,tick,app,render,root,setMode:v=>mode=v,counts:()=>({reads,validations:e.validations}),finish:async()=>{await Test.act(async()=>pending.shift()());},pending:()=>pending.length};
}
for(const paused of [true,false])test(`shared protected confirmation renews without session preflight or pause change, paused=${paused}`,async t=>{
 const h=await setup(t,{paused});const before=h.counts();await h.tick(45000);
 assert.equal(h.counts().reads,before.reads+1);assert.equal(h.counts().validations,before.validations);assert.equal(h.player.playing,!paused);assert.equal(h.player.currentTime,5);assert.ok(h.texts().includes('Protected caption'));
 await h.render({focused:false});assert.equal(h.player.playing,false);await h.render({focused:true});assert.equal(h.player.playing,!paused);assert.equal(h.counts().reads,before.reads+1);assert.ok(!h.texts().includes('Checking access'));
});
test('shared confirmation expires hanging renewal at60s; Retry recovers without logout',async t=>{
 const h=await setup(t,{paused:false});h.setMode('pending');await h.tick(45000);assert.equal(h.pending(),1);assert.equal(h.player.playing,true);
 await h.tick(14999);assert.equal(h.player.playing,true);await h.tick(1);assert.equal(h.player.playing,false);assert.ok(!h.texts().includes('Protected caption'));
 // Expiry cancels a hung request so a late response cannot defeat Retry.
 await h.finish();assert.equal(h.player.playing,false);assert.equal(h.player.currentTime,5);
 h.setMode('success');await Test.act(async()=>h.e.auth.access.check(9));assert.equal(h.player.playing,true);
 h.setMode(503);await h.tick(60000);assert.equal(h.player.playing,false);assert.ok(!h.texts().includes('Protected caption'));
 h.setMode('success');await Test.act(async()=>h.e.auth.access.check(9));assert.equal(h.player.playing,true);assert.equal(h.e.auth.getSnapshot().status,'authenticated');
});
test('transient renewal failure retains only its remaining lease; explicit denial stops immediately',async t=>{
 const h=await setup(t,{paused:false});h.setMode(503);await h.tick(45000);assert.equal(h.player.playing,true);assert.equal(h.e.auth.getSnapshot().status,'authenticated');
 await h.tick(15000);assert.equal(h.player.playing,false);h.setMode('success');await Test.act(async()=>h.e.auth.access.check(9));assert.equal(h.player.playing,true);
 h.setMode(403);await h.tick(45000);assert.equal(h.player.playing,false);assert.ok(h.texts().includes('Access unavailable'));assert.equal(h.e.auth.getSnapshot().status,'authenticated');
});
test('background masks and stops immediately; short return reuses proof but long return checks afresh',async t=>{
 const h=await setup(t,{paused:false}),before=h.counts().reads;await h.app('background');assert.equal(h.player.playing,false);assert.ok(!h.texts().includes('Protected caption'));
 await h.tick(10000);await h.app('active');assert.equal(h.player.playing,true);assert.equal(h.counts().reads,before);
 await h.app('background');await h.tick(60000);h.setMode('pending');await h.app('active');assert.equal(h.player.playing,false);assert.equal(h.pending(),1);
 await h.finish();assert.equal(h.player.playing,true);assert.equal(h.player.currentTime,5);
});
test('current401 ends sign-in, and old in-flight success cannot restore it',async t=>{
 const h=await setup(t,{paused:false});h.setMode(401);await h.tick(45000);assert.equal(h.player.playing,false);assert.equal(h.e.auth.getSnapshot().status,'anonymous');assert.equal(h.e.auth.access.spaceValid(9),false);
});

for(const paused of [false,true])test(`saved-session Retry repairs an actual failed native source without logout or write replay, paused=${paused}`,async t=>{
 const h=await setup(t,{paused}),generation=h.e.auth.getSnapshot().generation;
 await Test.act(async()=>h.player.emit('statusChange',{status:'error',error:new Error('injected native source failure')}));
 h.setMode(503);await h.tick(60000);h.e.sessionUnavailable=true;
 await Test.act(async()=>h.e.auth.validate());assert.equal(h.e.auth.getSnapshot().status,'unavailable');
 h.e.sessionUnavailable=false;h.setMode('success');await Test.act(async()=>h.e.auth.retryValidation());
 const active=h.e.players.find(p=>!p.released&&p.currentTime===5);
 assert.ok(active);assert.notEqual(active,h.player);assert.equal(h.player.released,true);
 assert.equal(active.playing,!paused);assert.equal(h.e.auth.getSnapshot().generation,generation);
 assert.equal(h.e.auth.getSnapshot().status,'authenticated');assert.equal(h.e.methods.some(m=>m!=='GET'),false);
});

test('an unconfirmed selected neighbor is masked and does not load until its check succeeds',async t=>{
 const h=await setup(t,{paused:false});h.setMode('pending');
 await Test.act(async()=>h.e.auth.access.invalidate(9,2));
 const before=h.e.players.length,list=h.root.root.findByType('FlatList');
 await Test.act(async()=>{list.props.onScrollBeginDrag();list.props.onMomentumScrollEnd({nativeEvent:{contentOffset:{y:600}}});});
 assert.equal(h.e.players.some(p=>p.playing),false);assert.ok(h.texts().includes('Cannot verify video access'));assert.equal(h.e.players.length,before);
 assert.equal(h.pending(),1);await h.finish();assert.ok(h.e.players.some(p=>p.playing));assert.equal(h.texts().includes('Cannot verify video access'),false);
});

test('missing optional captions do not invalidate otherwise authorized playback',async t=>{
 const h=await setup(t,{paused:false});h.e.captionsMissing=true;await h.tick(45000);
 assert.equal(h.player.playing,true);assert.equal(h.e.auth.access.spaceValid(9),true);assert.equal(h.e.auth.getSnapshot().status,'authenticated');
 assert.equal(h.texts().includes('Access unavailable'),false);
});

for(const paused of [true,false])test(`quiet source replacement preserves current time and pause intent, paused=${paused}`,async t=>{
 const h=await setup(t,{paused});h.e.mediaSuffix='updated';await h.tick(45000);
 const selected=h.e.players.find(p=>!p.released&&p.currentTime===5);assert.ok(selected);assert.notEqual(selected,h.player);
 assert.equal(h.player.released,true);assert.equal(selected.playing,!paused);assert.ok(h.e.players.filter(p=>!p.released).length<=3);
});
