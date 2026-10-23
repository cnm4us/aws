const assert=require('node:assert/strict');
const test=require('node:test');
const {bundle,React:R,Test}=require('./harness.cjs');

for(const preview of [false,true])test(`account validation keeps public Global video/captions steady and blocks on errors (internal=${preview})`,async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});t.after(()=>t.mock.timers.reset());
 for(const context of [{kind:'global'}]){
  const {FeedScreen,FeedStore,CaptionPreferences,AuthStore,ApiError,e}=await bundle(`export {FeedScreen} from './src/feed/FeedScreen';export {FeedStore} from './src/feed/feedStore';export {CaptionPreferences} from './src/preferences/captionPreferences';export {AuthStore} from './src/auth/authStore';export {ApiError} from './src/api/client';`,preview);
  const session={token:'test',expiresAt:'2030-01-01',viewer:{id:1,displayName:'Test'}};
  let resolveValidation,rejectValidation,validationCalls=0,captionLoads=0,root;
  e.auth=new AuthStore('https://api.test',{login:async()=>session,validate:()=>{validationCalls++;return new Promise((resolve,reject)=>{resolveValidation=resolve;rejectValidation=reject;});},revoke:async()=>{}},{load:async()=>null,save:async()=>{},clear:async()=>{}});
  await e.auth.restore();await e.auth.signIn('test@example.invalid','test');
  const items=[1,2,3].map(id=>({publicationId:id,playbackUrl:`https://media.test/${id}`,posterUrl:null,creator:{id:2,displayName:'Creator',avatarUrl:null},hasStory:false,hasCaptions:true}));
  e.feed=new FeedStore(async()=>({items,nextCursor:null}));await e.feed.refresh();
  e.client={getText:async()=>{captionLoads++;return 'WEBVTT\n\n00:02.000 --> 00:04.000\nVisible caption';}};
  const captions=new CaptionPreferences({getItem:async()=>null,setItem:async()=>{}});await captions.hydrate();await captions.setEnabled(true);
  let props={context,preferences:{toggleMute:()=>{}},sound:{muted:false},captionPreferences:captions,captions:captions.getSnapshot(),focused:true,onSpaces:()=>{},onMenu:()=>{},onGlobal:()=>{}};
  const render=async patch=>{props={...props,...patch};await Test.act(async()=>{root?root.update(R.createElement(FeedScreen,props)):root=Test.create(R.createElement(FeedScreen,props));});};
  const texts=()=>root.root.findAllByType('Text').map(n=>n.props.children);
  const press=async label=>{const button=root.root.findAllByType('Pressable').find(n=>n.props.accessibilityLabel===label);assert.ok(button,label);await Test.act(async()=>button.props.onPress());};
  try{
   await render({});await Test.act(async()=>root.root.findAllByType('View').find(n=>n.props.onLayout).props.onLayout({nativeEvent:{layout:{height:600}}}));
   const player=e.players.find(p=>p.playing);assert.ok(player);
   await Test.act(async()=>{player.currentTime=2.2;player.emit('timeUpdate',{currentTime:2.2});});assert.ok(texts().includes('Visible caption'));
   for(const paused of [true,false]){
    await press(paused?'Pause video':'Play video');const beforeLoads=captionLoads;let pending;
    await Test.act(async()=>{pending=e.auth.validate();await Promise.resolve();});assert.equal(e.auth.getSnapshot().validating,true);
    if(context.kind==='global'){
     assert.ok(texts().includes('Visible caption'),'pending account check must retain Global captions');assert.ok(!texts().includes('Checking access'));
     assert.equal(player.playing,!paused);assert.equal(captionLoads,beforeLoads);assert.equal(player.currentTime,2.2);
     assert.equal(root.root.findByType('VideoView').parent.props.player,player);
     // Also cross the independent caption refresh boundary while account validation is pending.
     await Test.act(async()=>t.mock.timers.tick(60_000));assert.equal(captionLoads,beforeLoads+1);
     assert.ok(texts().includes('Visible caption'));assert.equal(e.auth.getSnapshot().validating,true);assert.equal(player.playing,!paused);
     await render({focused:false});assert.equal(player.playing,false);assert.ok(!texts().includes('Visible caption'));
     await render({focused:true});assert.equal(player.playing,!paused);assert.ok(texts().includes('Visible caption'));
    }else{
     assert.ok(texts().includes('Checking access'));assert.ok(!texts().includes('Visible caption'));assert.equal(e.players.some(p=>p.playing),false);
    }
    await Test.act(async()=>{resolveValidation(session);assert.equal(await pending,true);});
    assert.equal(player.playing,!paused);assert.equal(player.currentTime,2.2);assert.ok(texts().includes('Visible caption'));
   }
   let pending;await Test.act(async()=>{pending=e.auth.validate();await Promise.resolve();});
   await Test.act(async()=>{rejectValidation(new ApiError('Temporary connection failure',503));assert.equal(await pending,false);});
   assert.equal(e.auth.getSnapshot().status,'unavailable');assert.ok(texts().includes('Cannot verify access'));assert.ok(!texts().includes('Visible caption'));assert.equal(e.players.some(p=>p.playing),false);
   await Test.act(async()=>{pending=e.auth.validate();await Promise.resolve();});assert.equal(player.playing,false);
   await Test.act(async()=>{resolveValidation(session);assert.equal(await pending,true);});assert.equal(player.playing,true);assert.ok(texts().includes('Visible caption'));assert.equal(validationCalls,4);
  }finally{if(root)await Test.act(async()=>root.unmount());e.auth.dispose();}
  assert.equal(e.players.some(p=>!p.released),false);
 }
});
