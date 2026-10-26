const assert=require('node:assert/strict');
const test=require('node:test');
const {bundle,React:R,Test,flatten,visible}=require('./harness.cjs');
const ulid='01ARZ3NDEKTSV4RRFFQ69G5FAV';
const group={id:12,name:'Launch group',type:'group',slug:'group',ulid:null};
const personal={id:9,name:'Personal',type:'personal',slug:'personal',ulid:null};
const creator={id:2,displayName:'Creator',avatarUrl:'https://avatar.test/creator.png',bio:'Creator public bio'};
const destination={space:{id:12,name:group.name,type:'group',description:'A community for thoughtful conversations and clear moderation.'},publicationId:205};
function decoded(player,attempt,seconds){player.currentTime=seconds;return {attempt,kind:'target_decoded',targetSeconds:seconds,timelineSeconds:seconds,decodedFrameSeconds:seconds,seekCompletedMs:1,decodedFrameMs:2,width:720,height:1280,muted:player.muted,rate:player.playing?1:0};}
async function setup(options={}){
 const {ViewerNavigator,AuthStore,PlaybackPreferences,CaptionPreferences,e}=await bundle(`export {ViewerNavigator} from './src/navigation/ViewerNavigator';export {AuthStore} from './src/auth/authStore';export {PlaybackPreferences} from './src/preferences/playbackPreferences';export {CaptionPreferences} from './src/preferences/captionPreferences';`,options.preview!==false,true,!!options.realAccess,{readiness:options.readiness,manualFrames:options.manualFrames,entryReadiness:options.entryReadiness});
 const session={token:'test',expiresAt:'2030-01-01',viewer:{id:1,displayName:'Test'}};
 e.auth=new AuthStore('https://api.test',{login:async()=>session,validate:async()=>{e.validations=(e.validations??0)+1;return session;},revoke:async()=>{}},{load:async()=>null,save:async()=>{},clear:async()=>{}});
 await e.auth.restore();await e.auth.signIn('test@example.invalid','test');
 e.paths=[];e.targetMissing=false;e.sourceMissing=false;
 const video=(id,spaceId)=>({publicationId:id,spaceId,productionUlid:ulid,uploadId:1,playbackUrl:`https://media.test/${options.sharedMedia&&[100,205].includes(id)?'shared':id}`,posterUrl:null,creator:{id:2,displayName:'Creator',avatarUrl:null},hasStory:false,hasCaptions:!!options.captions,description:'Video',width:100,height:200,durationSeconds:10});
 e.makeEntry=(space,pub)=>({context:{kind:'space',space:{...group,...space}},items:[pub,pub+1,pub+2].map(id=>video(id,space.id)),nextCursor:null,resume:{requestedPublicationId:pub,restoredPublicationId:pub,outcome:'restored'}});
 e.serverAccess=true;
 e.fetch=async url=>{
  const u=new URL(url),p=u.pathname;e.paths.push(p+u.search);let data,status=200;
  if(p.endsWith('/spaces/12')){data=e.sourceMissing?{error:'publication_not_found'}:{sourcePublicationId:100,productionUlid:ulid,creator,...destination};if(e.sourceMissing)status=404;}
  else if(p.endsWith('/publications/100/spaces')){data=e.sourceMissing?{error:'publication_not_found'}:{sourcePublicationId:100,productionUlid:ulid,creator,items:[destination],nextCursor:null};if(e.sourceMissing)status=404;}
  else if(p.includes('/creators/'))data={creator:{id:2,displayName:'Creator',handle:null,avatarUrl:null,bio:'Bio'},personalEntry:{state:'allowed',space:personal}};
  else if(p==='/api/viewer/v1/me/spaces')data={personal,groups:[{...group,relationship:'member',subscribed:false}],channels:[]};
  else if(e.denied&&p.includes('/spaces/12/feed')){status=403;data={error:'forbidden'};}
  else {
   const global=p.includes('/feed/global'),spaceId=global?90:p.includes('/spaces/12/')?12:9;
   const anchor=Number(u.searchParams.get('anchorPublicationId'))||null;
   const unavailable=anchor && (global?e.sourceMissing:e.targetMissing);
   const ids=global?(unavailable?[101,102]:[100,101,102]):spaceId===12?(unavailable?[206,207]:[205,206,207]):[305,306,307];
   data={context:global?{kind:'global'}:{kind:'space',space:spaceId===12?group:personal},items:ids.map(id=>video(id,spaceId)),nextCursor:null,
     ...(anchor?{resume:{requestedPublicationId:anchor,restoredPublicationId:unavailable?null:anchor,outcome:unavailable?'unavailable':'restored'}}:{})};
  }
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 };
 const prefs=new PlaybackPreferences({getItem:async()=>null,setItem:async()=>{}}),captions=new CaptionPreferences({getItem:async()=>null,setItem:async()=>{}});await prefs.hydrate();await captions.hydrate();if(options.soundOn&&prefs.getSnapshot().muted)prefs.toggleMute();
 function App(){return R.createElement(ViewerNavigator,{preferences:prefs,sound:R.useSyncExternalStore(prefs.subscribe,prefs.getSnapshot),captionPreferences:captions,captions:R.useSyncExternalStore(captions.subscribe,captions.getSnapshot)});}
 let root;await Test.act(async()=>{root=Test.create(R.createElement(App));});
 const screen=()=>root.root.findAllByType('Screen').find(n=>n.props.focused);
 const buttons=()=>screen().findAllByType('Pressable').filter(visible);
 const press=async label=>{const b=buttons().find(n=>n.props.accessibilityLabel===label);assert.ok(b,`Missing ${label}`);await Test.act(async()=>b.props.onPress());};
 const layout=async(height=600)=>{await Test.act(async()=>{screen().findAllByType('View').filter(visible).find(n=>n.props.onLayout)?.props.onLayout({nativeEvent:{layout:{height}}});});};
 const labels=()=>buttons().map(n=>n.props.accessibilityLabel);
 const texts=()=>screen().findAllByType('Text').map(n=>n.props.children);
 const back=async()=>{await Test.act(async()=>screen().props.navigation.goBack());};
 const selected=()=>screen().findAllByType('VideoView').filter(visible).find(n=>!n.props.player.released)?.props.player??e.players.find(p=>!p.released);
 const close=async()=>{await Test.act(async()=>root.unmount());assert.equal(e.auth.access.hasActiveJobs(),false);assert.equal(e.listeners.size,0);assert.equal(e.memoryListeners?.size??0,0);e.auth.dispose();assert.equal(e.players.some(p=>!p.released),false);assert.equal(e.players.some(p=>p.count()>0),false);};
 return {root,e,press,layout,labels,texts,back,selected,close,AuthStore,rerender:async()=>{await Test.act(async()=>root.update(R.createElement(App)));}};
}
test('readiness check through actual navigator holds a silent candidate behind the native modal and reuses its view at reveal',async()=>{
 let resolveNative,attempt,target,nativePlayer;
 const readiness={prepareAsync:(player,id,seconds)=>{nativePlayer=player;attempt=id;target=seconds;return new Promise(resolve=>{resolveNative=resolve;});},cancelAsync:async()=>{}};
 const h=await setup({realAccess:true,soundOn:true,readiness,manualFrames:true});
 try{
  await h.layout();const original=h.selected();await Test.act(async()=>h.e.frames.get(original)());original.currentTime=3;
  await h.press('Open menu');await h.press('Feed readiness check');await h.press('Check playing at 7s');
  assert.equal(h.e.navigationState.routes.at(-1).name,'ReadinessCover');assert.ok(h.texts().includes('Loading new Feed'));
  assert.equal(h.e.players.some(p=>p.playing),false);assert.equal(nativePlayer.muted,true);
  const view=h.root.root.findAllByType('VideoView').find(n=>n.props.player===nativePlayer);assert.ok(view);assert.equal(h.labels().includes('Reveal check video'),false);
  // A pre-seek view callback cannot dismiss the preparation cover.
  await Test.act(async()=>h.e.frames.get(nativePlayer)());assert.equal(h.labels().includes('Reveal check video'),false);
  await Test.act(async()=>{nativePlayer.currentTime=target;resolveNative({attempt,kind:'target_decoded',targetSeconds:target,timelineSeconds:target,decodedFrameSeconds:target,
   seekCompletedMs:10,decodedFrameMs:20,width:720,height:1280,muted:true,rate:0});});
  assert.ok(h.labels().includes('Reveal check video'));assert.equal(nativePlayer.playing,false);
  await h.press('Reveal check video');assert.equal(h.e.navigationState.routes.at(-1).name,'ReadinessCheck');
  assert.equal(h.root.root.findAllByType('VideoView').find(n=>n.props.player===nativePlayer),view);assert.equal(nativePlayer.playing,true);assert.equal(nativePlayer.muted,false);assert.equal(original.playing,false);
  await h.press('Frame and playback correct');assert.equal(nativePlayer.released,true);await h.press('Share readiness report');
  const report=JSON.parse(h.e.shared.message);assert.equal(report.history.length,1);assert.equal(report.history[0].userConfirmed,true);assert.equal(report.history[0].native.kind,'target_decoded');
  assert.equal(h.e.shared.message.includes('https://'),false);assert.equal(h.e.paths.filter(p=>!p.includes('/feed/')&&!p.includes('/creator-recognition')).length,0);
  await h.press('Close readiness check');await h.press('Close menu');assert.equal(h.selected(),original);assert.equal(original.currentTime,3);assert.equal(original.playing,true);
 }finally{await h.close();}
});
test('cancelling readiness native work behind the modal releases its candidate and late completion cannot reveal',async()=>{
 let resolveNative,attempt;
 const readiness={prepareAsync:(_player,id)=>{attempt=id;return new Promise(resolve=>{resolveNative=resolve;});},cancelAsync:async()=>{}};
 const h=await setup({realAccess:true,readiness});
 try{
  await h.layout();await h.press('Open menu');await h.press('Feed readiness check');await h.press('Check paused at 0s');
  const candidate=h.e.players.find(p=>!p.released&&p!==h.selected());assert.ok(candidate);
  await h.press('Cancel readiness preparation');assert.equal(candidate.released,true);
  await Test.act(async()=>resolveNative({attempt,kind:'target_decoded',targetSeconds:0,timelineSeconds:0,decodedFrameSeconds:0,seekCompletedMs:10,decodedFrameMs:20,width:720,height:1280,muted:true,rate:0}));
  assert.equal(h.e.navigationState.routes.at(-1).name,'ReadinessCheck');assert.equal(h.e.players.some(p=>p.playing),false);assert.ok(h.labels().includes('Check paused at 0s'));
 }finally{await h.close();}
});
test('automatic full-height readiness reveals only after independent frame and native evidence, preserving paused intent',async()=>{
 let finish,attempt;
 const readiness={prepareAsync:(_player,id)=>{attempt=id;return new Promise(resolve=>{finish=resolve;});},cancelAsync:async()=>{}};
 const h=await setup({realAccess:true,readiness,manualFrames:true,soundOn:true});
 try{
  await h.layout();await h.press('Open menu');await h.press('Feed readiness check');await h.press('Automatic full-height paused at 7s');
  assert.equal(h.e.navigationState.routes.at(-1).name,'ReadinessCover');
  const candidate=h.e.players.find(p=>!p.released&&p!==h.selected());assert.ok(candidate);
  const view=h.root.root.findAllByType('VideoView').find(n=>n.props.player===candidate);
  await Test.act(async()=>{candidate.currentTime=7;finish({attempt,kind:'target_decoded',targetSeconds:7,timelineSeconds:7,decodedFrameSeconds:7,seekCompletedMs:10,decodedFrameMs:20,width:720,height:1280,muted:true,rate:0});});
  assert.equal(h.e.navigationState.routes.at(-1).name,'ReadinessCover');assert.equal(candidate.playing,false);
  await Test.act(async()=>h.e.frames.get(candidate)());
  assert.equal(h.e.navigationState.routes.at(-1).name,'ReadinessCheck');assert.equal(candidate.playing,false);assert.equal(candidate.muted,false);
  assert.equal(h.root.root.findAllByType('VideoView').find(n=>n.props.player===candidate),view);
  await h.press('Frame and playback correct');await h.press('Share readiness report');
  const record=JSON.parse(h.e.shared.message).history[0];assert.equal(record.options.automatic,true);assert.ok(record.stages.revealed>=record.stages.target_decoded);
 }finally{await h.close();}
});
test('actual Launch router/loader: cancel, exact target/pause, nested Creator, Refresh and Global root retain one Feed',async()=>{
 const h=await setup(),{e,press,layout,labels,selected}=h;
 try{
  await layout();const original=selected();original.currentTime=7;await press('Pause video');
  await press('Open spaces for this video');assert.equal(e.players.some(p=>p.playing),false);await press('Close spaces');assert.equal(selected(),original);assert.equal(original.currentTime,7);assert.equal(original.playing,false);
  await press('Open spaces for this video');await press('Open Launch group (group)');await layout();assert.ok(labels().includes('Back to Global'));assert.ok(!labels().includes('Open spaces for this video'));
  assert.equal(original.released,true);assert.equal(selected().currentTime,7);assert.equal(selected().playing,false);
  await press('Open menu');await press('Settings');await press('Done');assert.equal(selected().currentTime,7);assert.equal(selected().playing,false);
  await press("View Creator's profile");await press('View personal space');await layout();assert.ok(labels().includes('Back to profile'));await press('Back to profile');await h.back();await layout();
  assert.equal(selected().currentTime,7);assert.equal(selected().playing,false);assert.ok(labels().includes('Back to Global'));
  await press('Open menu');await press('Refresh feed');await layout();assert.ok(e.paths.filter(p=>p.startsWith('/api/viewer/v1/spaces/12/feed')).at(-1).endsWith('limit=20'));
  await press('Back to Global');await layout();assert.equal(selected().currentTime,7);assert.equal(selected().playing,false);assert.equal(e.navigationState.routes.filter(r=>r.name==='Feed').length,1);
  assert.ok(e.players.filter(p=>!p.released).length<=3);assert.ok(!labels().some(l=>['Like','Comments'].includes(l)));
 }finally{await h.close();}
});
test('actual strict entry blocks fallback, Retry re-resolves, sign-out removes protected returns and anonymous Launch fetches no destinations',async()=>{
 const h=await setup(),{e,press,layout,labels,texts}=h;
 try{
  await layout();e.targetMissing=true;await press('Open spaces for this video');await press('Open Launch group (group)');await layout();
  assert.ok(texts().includes('Cannot open space'));assert.equal(e.players.some(p=>p.playing),false);assert.ok(labels().includes('Close spaces'));
  const resolves=e.paths.filter(p=>p.includes('/spaces/12?include=entry')).length;e.targetMissing=false;await press('Try again');await press('Open Launch group (group)');await layout();assert.ok(e.paths.filter(p=>p.includes('/spaces/12?include=entry')).length>resolves);
  assert.ok(labels().includes('Back to Global'));
  await press('Open menu');await press('Sign out');await layout();assert.equal(labels().includes('Back to Global'),false);
  const before=e.paths.filter(p=>p.includes('/publications/')).length;await press('Open spaces for this video');assert.ok(labels().includes('Sign in'));
  assert.equal(e.paths.filter(p=>p.includes('/publications/')).length,before);await press('Close spaces');assert.ok(!labels().includes('Back to Global'));
 }finally{await h.close();}
});
test('known unavailable Global source cannot resume from the mounted cache when chooser closes',async()=>{
 const h=await setup(),{e,press,layout,texts}=h;
 try{
  await layout();const original=h.selected();original.currentTime=7;e.sourceMissing=true;
  await press('Open spaces for this video');assert.equal(e.players.some(p=>p.playing),false);assert.equal(original.released,true);
  await press('Close spaces');await layout();assert.ok(texts().includes('The original video is no longer available. Showing the current feed.'));
  assert.equal(e.auth.getSnapshot().status,'authenticated');assert.equal(e.players.some(p=>p===original && p.playing),false);
 }finally{await h.close();}
});
test('late chooser resolution after identity reset cannot reopen the old protected destination',async()=>{
 const h=await setup(),{e,press,layout,labels}=h;
 try{
  await layout();const fetch=e.fetch;let finish;
  e.fetch=async(url,...args)=>String(url).includes('/spaces/12?include=entry')?new Promise(resolve=>{finish=()=>fetch(url,...args).then(resolve);}):fetch(url,...args);
  await press('Open spaces for this video');
  const b=h.root.root.findAllByType('Screen').find(n=>n.props.focused).findAllByType('Pressable').find(n=>n.props.accessibilityLabel==='Open Launch group (group)');
  await Test.act(async()=>{b.props.onPress();});assert.ok(finish);
  await Test.act(async()=>e.auth.signOut());await layout();
  await Test.act(async()=>finish());
  assert.equal(e.navigationState.routes.some(r=>r.name==='LaunchSpaces'),false);assert.equal(labels().includes('Back to Global'),false);assert.ok(labels().includes('Open spaces for this video'));
 }finally{await h.close();}
});

test('API-origin replacement at the same auth generation clears a launched feed and both roots',async()=>{
 const h=await setup(),{e,press,layout,labels}=h;const old=e.auth;
 try{
  await layout();await press('Open spaces for this video');await press('Open Launch group (group)');await layout();assert.ok(labels().includes('Back to Global'));
  const session={token:'other',expiresAt:'2030-01-01',viewer:{id:1,displayName:'Other server'}};
  const next=new h.AuthStore('https://other.test',{login:async()=>session,validate:async()=>session,revoke:async()=>{}},{load:async()=>null,save:async()=>{},clear:async()=>{}});
  await next.restore();await next.signIn('other@example.invalid','test');assert.equal(next.getSnapshot().generation,old.getSnapshot().generation);
  e.auth=next;e.baseUrl='https://other.test';await h.rerender();await layout();
  assert.ok(labels().includes('Choose space. Current space: Global'));assert.equal(labels().includes('Back to Global'),false);assert.equal(e.navigationState.routes.length,1);
 }finally{old.dispose();await h.close();}
});

test('actual four-action Global rail stays bounded and scrollable with short video height and large text',async()=>{
 const h=await setup({captions:true});
 try{
  for(const width of [320,375])for(const fontScale of [1,1.5,3.1]){
   h.e.dimensions={width,height:480,fontScale};await h.rerender();await h.layout(140);
   const feed=h.root.root.findAllByType('Screen').find(n=>n.props.focused);
   const rail=feed.findAllByType('ScrollView').find(n=>flatten(n.props.style).position==='absolute');assert.ok(rail);
   const style=flatten(rail.props.style);assert.equal(style.height,92);assert.equal(style.width,44);assert.equal(style.bottom,24);
   const controls=rail.findAllByType('Pressable').filter(visible);assert.equal(controls.length,4);
   assert.deepEqual(controls.map(n=>n.props.accessibilityLabel),["View Creator's profile",'Open spaces for this video','Show captions','Mute']);
   for(const control of controls){const target=flatten(typeof control.props.style==='function'?control.props.style({pressed:false}):control.props.style);assert.equal(target.height,44);assert.equal(target.width,44);}
   await h.press('Open spaces for this video');
   const chooser=h.root.root.findAllByType('Screen').find(n=>n.props.focused);
   assert.ok(chooser.findAllByType('View').some(n=>flatten(n.props.style).alignItems==='flex-end'&&n.findAllByType('Pressable').some(b=>b.props.accessibilityLabel==='Close spaces')));
   await h.press('Close spaces');
  }
 }finally{await h.close();}
});

test('Launch has one80% scrim, a shared creator and described destinations; Close stays outside scrolling content',async()=>{
 const h=await setup();
 try{
  await h.layout();const original=h.selected();original.currentTime=3;
  await h.press('Open spaces for this video');
  const chooser=h.root.root.findAllByType('Screen').find(n=>n.props.focused),feed=h.root.root.findAllByType('Screen').find(n=>n.props.name==='Feed');
  assert.equal(chooser.props.options.presentation,'transparentModal');assert.equal(chooser.props.options.headerShown,false);assert.equal(chooser.props.options.contentStyle.backgroundColor,'transparent');
  assert.equal(chooser.findAllByType('View').filter(n=>flatten(n.props.style).backgroundColor==='rgba(0,0,0,0.8)').length,1);
  assert.ok(h.texts().includes('Creator public bio'));assert.ok(h.texts().includes(destination.space.description));assert.ok(h.texts().includes('Launch group'));
  assert.equal(chooser.findAllByType('Text').filter(n=>n.props.children==='Creator').length,1);
  assert.equal(chooser.findByType('ScrollView').findAllByType('Pressable').some(n=>n.props.accessibilityLabel==='Close spaces'),false);
  assert.ok(feed.findAllByType('View').some(n=>n.props.pointerEvents==='none'&&n.props.accessibilityElementsHidden===true));
  assert.equal(h.e.players.some(p=>p.playing),false);assert.equal(h.selected(),original);assert.equal(original.released,undefined);
  assert.equal(chooser.findAllByType('Pressable').some(n=>/Follow|personal space/.test(n.props.accessibilityLabel)),false);
  await h.press('Close spaces');assert.equal(h.selected(),original);assert.equal(original.currentTime,3);assert.equal(original.playing,true);
  await h.press('Open spaces for this video');assert.equal(original.playing,false);await h.press('Close spaces');assert.equal(original.playing,true);
 }finally{await h.close();}
});
test('Launch backdrop becomes opaque when its source is known unavailable, with Close still reachable',async()=>{
 const h=await setup();
 try{
  await h.layout();h.e.sourceMissing=true;await h.press('Open spaces for this video');
  const chooser=h.root.root.findAllByType('Screen').find(n=>n.props.focused);
  assert.ok(chooser.findAllByType('View').some(n=>n.props.accessibilityViewIsModal&&flatten(n.props.style).backgroundColor==='#000'));
  assert.ok(h.labels().includes('Close spaces'));assert.equal(h.texts().includes('Creator public bio'),false);
  assert.equal(h.e.players.some(p=>p.playing),false);
 }finally{await h.close();}
});

test("prepared Launch reuses authorized JSON and replaces every cross-feed native pool",async()=>{
 const h=await setup({sharedMedia:true,realAccess:true});
 try{
  await h.layout();const original=h.selected();original.currentTime=7;await h.press('Pause video');
  await Test.act(async()=>new Promise(resolve=>setTimeout(resolve,240)));
  const lists=()=>h.e.paths.filter(p=>p.includes('/publications/100/spaces?')).length;
  assert.equal(lists(),1);await h.press('Open spaces for this video');assert.equal(lists(),1);
  const validations=h.e.validations??0;
  await h.press('Open Launch group (group)');await h.layout();
  assert.equal(h.e.validations??0,validations);
  assert.equal(h.e.paths.filter(p=>p.startsWith('/api/viewer/v1/spaces/12/feed')).length,0);
  assert.equal(h.e.paths.filter(p=>p.includes('/spaces/12?include=entry')).length,1);
  const destination=h.selected();assert.notEqual(destination,original);assert.equal(original.released,true);assert.equal(original.muted,true);assert.equal(destination.currentTime,7);assert.equal(destination.playing,false);
  const globalReads=h.e.paths.filter(p=>p.startsWith('/api/viewer/v1/feed/global?')).length;
  await h.press('Back to Global');await h.layout();
  assert.equal(h.e.paths.filter(p=>p.startsWith('/api/viewer/v1/feed/global?')).length,globalReads+1);
  assert.ok(h.e.paths.includes('/api/viewer/v1/feed/global?limit=20&anchorPublicationId=100'));
  const returned=h.selected();assert.notEqual(returned,destination);assert.notEqual(returned,original);assert.equal(destination.released,true);assert.equal(returned.currentTime,7);assert.equal(returned.playing,false);
  await h.press('Play video');assert.equal(returned.playing,true);assert.equal(original.playing,false);assert.equal(destination.playing,false);
  assert.ok(h.e.players.filter(p=>!p.released).length<=3);
 }finally{await h.close();}
});
test('fresh protected feed denial cannot replace or play the paused origin player',async()=>{
 const h=await setup({sharedMedia:true,realAccess:true});
 try{
  await h.layout();const original=h.selected();original.currentTime=5;h.e.denied=true;
  await h.press('Open spaces for this video');await h.press('Open Launch group (group)');await h.layout();
  assert.ok(h.texts().includes('Cannot open space'));assert.equal(h.e.players.some(p=>p.playing),false);
  assert.equal(h.e.auth.getSnapshot().status,'authenticated');
  await h.press('Close spaces');await h.layout();assert.equal(h.e.players.some(p=>p.playing),true);
 }finally{await h.close();}
});
test('background while initial protected feed is pending pauses origin and rejects stale authority',async()=>{
 const h=await setup({sharedMedia:true,realAccess:true});let finish;
 try{
  await h.layout();const original=h.selected(),fetch=h.e.fetch;
  h.e.fetch=async(url,...args)=>String(url).includes('/spaces/12?include=entry')?new Promise(resolve=>{finish=()=>fetch(url,...args).then(resolve);}):fetch(url,...args);
  await h.press('Open spaces for this video');await h.press('Open Launch group (group)');assert.ok(finish);
  assert.equal(original.playing,false);
  await Test.act(async()=>{h.e.state='background';for(const listener of h.e.listeners)listener('background');});
  assert.equal(h.e.players.some(p=>p.playing),false);
  await Test.act(async()=>finish());await h.layout();assert.equal(h.e.players.some(p=>p.playing),false);
  await Test.act(async()=>{h.e.state='active';for(const listener of h.e.listeners)listener('active');});await h.layout();
  assert.equal(h.e.paths.includes('/api/viewer/v1/spaces/12/feed?limit=1'),false);
  assert.equal(h.e.navigationState.routes.some(r=>r.name==='Feed'&&r.params?.spaceId===12),false);
  assert.ok(h.e.players.filter(p=>!p.released).length<=3);
 }finally{await h.close();}
});
test('cached chooser metadata never authorizes a removed source destination',async()=>{
 const h=await setup({sharedMedia:true,realAccess:true});
 try{
  await h.layout();await Test.act(async()=>new Promise(resolve=>setTimeout(resolve,240)));
  h.e.sourceMissing=true;await h.press('Open spaces for this video');
  assert.ok(h.texts().includes('Video no longer available'));assert.equal(h.e.players.some(p=>p.playing),false);
  assert.equal(h.e.paths.some(p=>p.includes('/spaces/12/feed')),false);
 }finally{await h.close();}
});
test("sound-on exact-media entry and Global return use fresh native owners at the saved time",async()=>{
 const h=await setup({sharedMedia:true,realAccess:true,soundOn:true});
 try{
  await h.layout();const original=h.selected();original.currentTime=3;assert.equal(original.playing,true);
  assert.equal(original.muted,false);
  await h.press('Open spaces for this video');assert.equal(original.playing,false);
  await h.press('Open Launch group (group)');await h.layout();const destination=h.selected();assert.notEqual(destination,original);assert.equal(original.released,true);assert.equal(original.muted,true);assert.equal(destination.currentTime,3);assert.equal(destination.playing,true);assert.equal(destination.muted,false);
  destination.currentTime=6;await h.press("View Creator's profile");assert.equal(destination.playing,false);await h.back();await h.layout();assert.equal(destination.currentTime,6);assert.equal(destination.playing,true);
  destination.currentTime=8;await h.press('Back to Global');await h.layout();const returned=h.selected();assert.notEqual(returned,destination);assert.notEqual(returned,original);assert.equal(destination.released,true);assert.equal(returned.currentTime,3);assert.equal(returned.playing,true);assert.equal(returned.muted,false);
  assert.equal(h.e.players.filter(p=>p.playing).length,1);assert.ok(h.e.players.filter(p=>!p.released).length<=3);
 }finally{await h.close();}
});
test('fresh Global return cannot restore a removed original public source',async()=>{
 const h=await setup({sharedMedia:true,realAccess:true});
 try{
  await h.layout();const original=h.selected();await h.press('Open spaces for this video');await h.press('Open Launch group (group)');await h.layout();
  h.e.sourceMissing=true;await Test.act(async()=>h.e.auth.access.invalidatePublic(100));await h.press('Back to Global');await h.layout();
  assert.ok(h.texts().includes('The original video is no longer available. Showing the current feed.'));assert.equal(original.released,true);assert.equal(original.playing,false);
  assert.ok(h.e.players.filter(p=>p.playing).length<=1);assert.ok(h.e.players.filter(p=>!p.released).length<=3);
 }finally{await h.close();}
});

test('warm Global return restores from the public page before a delayed revalidation response',async()=>{
 const h=await setup({sharedMedia:true,realAccess:true});let finish;
 try{
  await h.layout();const original=h.selected();original.currentTime=4;await h.press('Pause video');
  await h.press('Open spaces for this video');await h.press('Open Launch group (group)');await h.layout();
  const fetch=h.e.fetch;h.e.fetch=async(url,...args)=>String(url).includes('/feed/global?')?new Promise(resolve=>{finish=()=>fetch(url,...args).then(resolve);}):fetch(url,...args);
  await h.press('Back to Global');await h.layout();assert.ok(finish);const returned=h.selected();assert.notEqual(returned,original);assert.equal(original.released,true);
  assert.equal(returned.currentTime,4);assert.equal(returned.playing,false);assert.equal(h.texts().includes('Loading videos'),false);
  await Test.act(async()=>finish());assert.equal(h.selected(),returned);assert.equal(returned.playing,false);
 }finally{await h.close();}
});
test('feed replacement releases the complete origin pool before destination allocation and preserves its full swipe window',async()=>{
 const h=await setup({realAccess:true,sharedMedia:true,soundOn:true});
 try{
  await h.layout();const origin=h.selected();origin.currentTime=5;
  const allocations=h.e.players.length;
  await h.press('Open spaces for this video');await h.press('Open Launch group (group)');await h.layout();
  assert.equal(origin.released,true);assert.equal(origin.count(),0);assert.equal(origin.muted,true);
  assert.ok(h.e.players.slice(0,allocations).every(p=>p.released));
  const list=h.root.root.findAllByType('FlatList').find(visible);assert.ok(list);
  await Test.act(async()=>{list.props.onScrollBeginDrag();list.props.onMomentumScrollEnd({nativeEvent:{contentOffset:{y:600}}});});
  assert.equal(h.e.players.filter(p=>!p.released).length,3);assert.equal(h.e.players.filter(p=>p.playing).length,1);
  assert.equal(h.texts().includes('Loading Launch group…'),false);
  await h.press('Back to Global');await h.layout();const returned=h.selected();
  assert.notEqual(returned,origin);assert.equal(returned.currentTime,5);assert.equal(returned.loads,1);assert.equal(returned.playing,true);
 }finally{await h.close();}
});
test('opening and closing Launch preserves the mounted player; committing a feed releases it',async()=>{
 const h=await setup({realAccess:true,soundOn:true});
 try{
  await h.layout();const origin=h.selected();origin.currentTime=4;
  const view=h.root.root.findAllByType('VideoView').find(n=>n.props.player===origin);
  await h.press('Open spaces for this video');await h.press('Close spaces');
  assert.equal(h.selected(),origin);assert.equal(origin.loads,1);assert.equal(h.root.root.findAllByType('VideoView').find(n=>n.props.player===origin),view);
  await h.press('Open spaces for this video');await h.press('Open Launch group (group)');await h.layout();
  assert.equal(origin.released,true);
  await h.press('Back to Global');await h.layout();assert.notEqual(h.selected(),origin);assert.equal(h.selected().currentTime,4);
 }finally{await h.close();}
});
test('queued controls from the released Global cannot change pause, sound or navigation',async()=>{
 const h=await setup({realAccess:true,soundOn:true});
 try{
  await h.layout();const original=h.selected();
  const buttons=h.root.root.findAllByType('Pressable').filter(visible);
  const pause=buttons.find(n=>n.props.accessibilityLabel==='Pause video').props.onPress;
  const mute=buttons.find(n=>n.props.accessibilityLabel==='Mute').props.onPress;
  const launch=buttons.find(n=>n.props.accessibilityLabel==='Open spaces for this video').props.onPress;
  await h.press('Open spaces for this video');await h.press('Open Launch group (group)');await h.layout();
  const reads=h.e.paths.length;await Test.act(async()=>{pause();mute();launch();});
  assert.equal(h.e.navigationState.routes.at(-1).name,'Feed');assert.equal(h.e.paths.length,reads);assert.equal(original.playing,false);assert.equal(original.muted,true);
  await h.press('Back to Global');await h.layout();assert.notEqual(h.selected(),original);assert.equal(h.selected().playing,true);assert.equal(h.selected().muted,false);
 }finally{await h.close();}
});

for(const paused of [false,true])test(`repeated sound-on Launch round trips isolate native pools with ${paused?'paused':'playing'} Global`,async()=>{
 const h=await setup({sharedMedia:true,realAccess:true,soundOn:true});
 try{
  await h.layout();if(paused)await h.press('Pause video');
  for(let trip=0;trip<3;trip++){
   const origin=h.selected();origin.currentTime=2+trip;
   // Merely opening/closing the overlay retains the originating view/player.
   await h.press('Open spaces for this video');assert.equal(origin.playing,false);
   await h.press('Close spaces');assert.equal(h.selected(),origin);assert.equal(origin.released,undefined);assert.equal(origin.playing,!paused);assert.equal(origin.muted,paused);
   await h.press('Open spaces for this video');await h.press('Open Launch group (group)');await h.layout();
   const destination=h.selected();assert.notEqual(destination,origin);assert.equal(origin.released,true);assert.equal(origin.count(),0);assert.equal(origin.playing,false);assert.equal(origin.muted,true);
   assert.equal(destination.currentTime,2+trip);assert.equal(destination.playing,!paused);assert.equal(destination.muted,paused);
   destination.currentTime=7;
   await h.press('Back to Global');await h.layout();const returned=h.selected();
   assert.notEqual(returned,origin);assert.notEqual(returned,destination);assert.equal(destination.released,true);assert.equal(destination.count(),0);assert.equal(destination.playing,false);
   assert.equal(returned.currentTime,2+trip);assert.equal(returned.playing,!paused);assert.equal(returned.muted,paused);
   assert.equal(h.e.players.filter(p=>p.playing).length,paused?0:1);assert.ok(h.e.players.filter(p=>!p.released).length<=3);
  }
 }finally{await h.close();}
});

for(const preview of [false,true])test(`new-feed splash holds pixels/actions/audio through a pre-seek frame and reveals the same fresh view (diagnostics=${preview})`,async()=>{
 let calls=0,complete,candidate;
 const entryReadiness={prepareAsync:(player,attempt,seconds)=>{if(++calls===1)return Promise.resolve(decoded(player,attempt,seconds));candidate=player;return new Promise(resolve=>{complete=()=>resolve(decoded(player,attempt,seconds));});},cancelAsync:async()=>{}};
 const h=await setup({preview,realAccess:true,soundOn:true,entryReadiness});
 try{
  await h.layout();const origin=h.selected();origin.currentTime=7;
  await h.press('Open spaces for this video');await h.press('Open Launch group (group)');await h.layout();
  assert.equal(origin.released,true);assert.ok(complete);assert.ok(h.texts().includes('Loading Launch group…'));
  assert.equal(h.labels().some(label=>['Like','Comments',"View Creator's profile",'Pause video'].includes(label)),false);
  assert.equal(h.e.players.some(p=>p.playing),false);assert.ok(h.e.players.filter(p=>!p.released).every(p=>p.muted));
  const view=h.root.root.findAllByType('VideoView').find(n=>n.props.player===candidate);assert.ok(view);
  const reads=h.e.paths.length;await Test.act(async()=>complete());
  assert.equal(h.texts().includes('Loading Launch group…'),false);assert.equal(candidate.playing,true);assert.equal(candidate.muted,false);assert.equal(candidate.currentTime,7);
  assert.equal(h.root.root.findAllByType('VideoView').find(n=>n.props.player===candidate),view);
  assert.equal(h.e.paths.filter(p=>p.includes('/spaces/12/feed')).length,0);assert.ok(h.e.paths.length>=reads);
  assert.equal(h.root.root.findAllByType('ActivityIndicator').length,0);
 }finally{await h.close();}
});
test('leaving a preparing feed cancels its native attempt; a late result cannot reveal it or revive audio',async()=>{
 let calls=0,complete,candidate;const cancelled=[];
 const entryReadiness={prepareAsync:(player,attempt,seconds)=>{if(++calls!==2)return Promise.resolve(decoded(player,attempt,seconds));candidate=player;return new Promise(resolve=>{complete=()=>resolve(decoded(player,attempt,seconds));});},cancelAsync:async id=>{cancelled.push(id);}};
 const h=await setup({realAccess:true,entryReadiness,soundOn:true});
 try{
  await h.layout();await h.press('Open spaces for this video');await h.press('Open Launch group (group)');await h.layout();assert.ok(h.texts().includes('Loading Launch group…'));
  await h.press('Back to Global');await h.layout();const current=h.selected();assert.equal(candidate.released,true);assert.ok(cancelled.length);
  await Test.act(async()=>complete());assert.equal(h.selected(),current);assert.equal(current.playing,true);assert.equal(candidate.playing,false);assert.equal(h.e.players.filter(p=>p.playing).length,1);
 }finally{await h.close();}
});
test('native-entry failure keeps the exact Launch target required on Retry',async()=>{
 let calls=0;const entryReadiness={prepareAsync:(player,attempt,seconds)=>++calls===2?Promise.reject(Error('failed native seek')):Promise.resolve(decoded(player,attempt,seconds)),cancelAsync:async()=>{}};
 const h=await setup({realAccess:true,entryReadiness});
 try{
  await h.layout();await h.press('Open spaces for this video');await h.press('Open Launch group (group)');await h.layout();
  assert.ok(h.texts().includes('Cannot load Launch group'));assert.equal(h.e.players.some(p=>p.playing),false);
  h.e.targetMissing=true;await h.press('Try again');await h.layout();
  assert.ok(h.texts().includes('Video unavailable in this space'));assert.equal(h.e.players.some(p=>p.playing),false);assert.ok(h.labels().includes('Choose another space'));
 }finally{await h.close();}
});
