const assert=require('node:assert/strict');
const test=require('node:test');
const {bundle,React:R,Test,flatten}=require('./harness.cjs');
const ulid='01ARZ3NDEKTSV4RRFFQ69G5FAV';
const group={id:12,name:'Launch group',type:'group',slug:'group',ulid:null};
const personal={id:9,name:'Personal',type:'personal',slug:'personal',ulid:null};
const creator={id:2,displayName:'Creator',avatarUrl:'https://avatar.test/creator.png',bio:'Creator public bio'};
const destination={space:{id:12,name:group.name,type:'group',description:'A community for thoughtful conversations and clear moderation.'},publicationId:205};
async function setup(options={}){
 const {ViewerNavigator,AuthStore,PlaybackPreferences,CaptionPreferences,e}=await bundle(`export {ViewerNavigator} from './src/navigation/ViewerNavigator';export {AuthStore} from './src/auth/authStore';export {PlaybackPreferences} from './src/preferences/playbackPreferences';export {CaptionPreferences} from './src/preferences/captionPreferences';`,true,true,!!options.realAccess);
 const session={token:'test',expiresAt:'2030-01-01',viewer:{id:1,displayName:'Test'}};
 e.auth=new AuthStore('https://api.test',{login:async()=>session,validate:async()=>{e.validations=(e.validations??0)+1;return session;},revoke:async()=>{}},{load:async()=>null,save:async()=>{},clear:async()=>{}});
 await e.auth.restore();await e.auth.signIn('test@example.invalid','test');
 e.paths=[];e.targetMissing=false;e.sourceMissing=false;
 const video=(id,spaceId)=>({publicationId:id,spaceId,productionUlid:ulid,uploadId:1,playbackUrl:`https://media.test/${options.sharedMedia&&[100,205].includes(id)?'shared':id}`,posterUrl:null,creator:{id:2,displayName:'Creator',avatarUrl:null},hasStory:false,hasCaptions:!!options.captions,description:'Video',width:100,height:200,durationSeconds:10});
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
 const prefs=new PlaybackPreferences({getItem:async()=>null,setItem:async()=>{}}),captions=new CaptionPreferences({getItem:async()=>null,setItem:async()=>{}});await prefs.hydrate();await captions.hydrate();
 function App(){return R.createElement(ViewerNavigator,{preferences:prefs,sound:R.useSyncExternalStore(prefs.subscribe,prefs.getSnapshot),captionPreferences:captions,captions:R.useSyncExternalStore(captions.subscribe,captions.getSnapshot)});}
 let root;await Test.act(async()=>{root=Test.create(R.createElement(App));});
 const screen=()=>root.root.findAllByType('Screen').find(n=>n.props.focused);
 const buttons=()=>screen().findAllByType('Pressable');
 const press=async label=>{const b=buttons().find(n=>n.props.accessibilityLabel===label);assert.ok(b,`Missing ${label}`);await Test.act(async()=>b.props.onPress());};
 const layout=async(height=600)=>{await Test.act(async()=>{screen().findAllByType('View').find(n=>n.props.onLayout)?.props.onLayout({nativeEvent:{layout:{height}}});});};
 const labels=()=>buttons().map(n=>n.props.accessibilityLabel);
 const texts=()=>screen().findAllByType('Text').map(n=>n.props.children);
 const back=async()=>{await Test.act(async()=>screen().props.navigation.goBack());};
 const selected=()=>e.players.filter(p=>!p.released)[0];
 const close=async()=>{await Test.act(async()=>root.unmount());e.auth.dispose();assert.equal(e.players.some(p=>!p.released),false);};
 return {root,e,press,layout,labels,texts,back,selected,close,AuthStore,rerender:async()=>{await Test.act(async()=>root.update(R.createElement(App)));}};
}
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
  assert.ok(texts().includes('Video unavailable in this space'));assert.equal(e.players.some(p=>p.playing),false);assert.ok(labels().includes('Choose another space'));
  const resolves=e.paths.filter(p=>p.endsWith('/spaces/12')).length;e.targetMissing=false;await press('Try again');await layout();assert.ok(e.paths.filter(p=>p.endsWith('/spaces/12')).length>resolves);
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
  await layout();await press('Open spaces for this video');const fetch=e.fetch;let finish;
  e.fetch=async(url,...args)=>String(url).endsWith('/spaces/12')?new Promise(resolve=>{finish=resolve;}):fetch(url,...args);
  const b=h.root.root.findAllByType('Screen').find(n=>n.props.focused).findAllByType('Pressable').find(n=>n.props.accessibilityLabel==='Open Launch group (group)');
  await Test.act(async()=>{b.props.onPress();});assert.ok(finish);
  await Test.act(async()=>e.auth.signOut());await layout();
  await Test.act(async()=>finish(new Response(JSON.stringify({sourcePublicationId:100,productionUlid:ulid,creator,...destination}),{headers:{'Content-Type':'application/json'}})));
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
   const controls=rail.findAllByType('Pressable');assert.equal(controls.length,4);
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

test('prepared Launch and exact media handoff avoid repeated list, access-probe and selected source loads, with fresh return feed',async()=>{
 const h=await setup({sharedMedia:true,realAccess:true});
 try{
  await h.layout();const original=h.selected();original.currentTime=7;await h.press('Pause video');
  await Test.act(async()=>new Promise(resolve=>setTimeout(resolve,240)));
  const lists=()=>h.e.paths.filter(p=>p.includes('/publications/100/spaces?')).length;
  assert.equal(lists(),1);await h.press('Open spaces for this video');assert.equal(lists(),1);
  const validations=h.e.validations??0;
  await h.press('Open Launch group (group)');await h.layout();
  assert.equal(h.e.validations,validations+1);
  assert.equal(h.e.paths.filter(p=>p.startsWith('/api/viewer/v1/spaces/12/feed')).length,1);
  assert.ok(h.e.paths.includes('/api/viewer/v1/spaces/12/feed?limit=20&anchorPublicationId=205'));
  assert.equal(h.selected(),original);assert.equal(original.released,undefined);assert.equal(original.currentTime,7);assert.equal(original.playing,false);
  const globalReads=h.e.paths.filter(p=>p.startsWith('/api/viewer/v1/feed/global?')).length;
  await h.press('Back to Global');await h.layout();
  assert.equal(h.e.paths.filter(p=>p.startsWith('/api/viewer/v1/feed/global?')).length,globalReads+1);
  assert.ok(h.e.paths.includes('/api/viewer/v1/feed/global?limit=20&anchorPublicationId=100'));
  assert.equal(h.selected(),original);assert.equal(original.currentTime,7);assert.equal(original.playing,false);
  await h.press('Play video');assert.equal(original.playing,true);
  assert.ok(h.e.players.filter(p=>!p.released).length<=3);
 }finally{await h.close();}
});
test('fresh protected feed denial with a matching parked player cannot show or play that media',async()=>{
 const h=await setup({sharedMedia:true,realAccess:true});
 try{
  await h.layout();const original=h.selected();original.currentTime=5;h.e.denied=true;
  await h.press('Open spaces for this video');await h.press('Open Launch group (group)');await h.layout();
  assert.ok(h.texts().includes('Access unavailable'));assert.equal(h.e.players.some(p=>p.playing),false);
  assert.equal(h.e.auth.getSnapshot().status,'authenticated');
  await h.press('Back to Global');await h.layout();assert.equal(original.released,true);
 }finally{await h.close();}
});
test('background while initial protected feed is pending releases the parked lease and rejects stale authority',async()=>{
 const h=await setup({sharedMedia:true,realAccess:true});let finish;
 try{
  await h.layout();const original=h.selected(),fetch=h.e.fetch;
  h.e.fetch=async(url,...args)=>String(url).includes('/spaces/12/feed?limit=20')?new Promise(resolve=>{finish=()=>fetch(url,...args).then(resolve);}):fetch(url,...args);
  await h.press('Open spaces for this video');await h.press('Open Launch group (group)');assert.ok(finish);
  assert.equal(original.playing,false);assert.equal(original.muted,true);
  await Test.act(async()=>{h.e.state='background';for(const listener of h.e.listeners)listener('background');});
  assert.equal(original.released,true);
  await Test.act(async()=>finish());await h.layout();assert.equal(h.e.players.some(p=>p.playing),false);
  await Test.act(async()=>{h.e.state='active';for(const listener of h.e.listeners)listener('active');});await h.layout();
  assert.ok(h.e.paths.includes('/api/viewer/v1/spaces/12/feed?limit=1'));
  assert.ok(h.e.players.filter(p=>!p.released).length<=3);
 }finally{await h.close();}
});
test('cached chooser metadata never authorizes a removed source destination',async()=>{
 const h=await setup({sharedMedia:true,realAccess:true});
 try{
  await h.layout();await Test.act(async()=>new Promise(resolve=>setTimeout(resolve,240)));
  h.e.sourceMissing=true;await h.press('Open spaces for this video');await h.press('Open Launch group (group)');
  assert.ok(h.texts().includes('Video no longer available'));assert.equal(h.e.players.some(p=>p.playing),false);
  assert.equal(h.e.paths.some(p=>p.includes('/spaces/12/feed')),false);
 }finally{await h.close();}
});
test('playing exact-media entry resumes one player and Back restores the original Global time after a profile visit',async()=>{
 const h=await setup({sharedMedia:true,realAccess:true});
 try{
  await h.layout();const original=h.selected();original.currentTime=3;assert.equal(original.playing,true);
  await h.press('Open spaces for this video');assert.equal(original.playing,false);
  await h.press('Open Launch group (group)');await h.layout();assert.equal(h.selected(),original);assert.equal(original.currentTime,3);assert.equal(original.playing,true);
  original.currentTime=6;await h.press("View Creator's profile");assert.equal(original.playing,false);await h.back();await h.layout();assert.equal(original.currentTime,6);assert.equal(original.playing,true);
  original.currentTime=8;await h.press('Back to Global');await h.layout();assert.equal(h.selected(),original);assert.equal(original.currentTime,3);assert.equal(original.playing,true);
  assert.equal(h.e.players.filter(p=>p.playing).length,1);assert.ok(h.e.players.filter(p=>!p.released).length<=3);
 }finally{await h.close();}
});
test('fresh Global return drops a carried player when the original public source has disappeared',async()=>{
 const h=await setup({sharedMedia:true,realAccess:true});
 try{
  await h.layout();const original=h.selected();await h.press('Open spaces for this video');await h.press('Open Launch group (group)');await h.layout();
  h.e.sourceMissing=true;await h.press('Back to Global');await h.layout();
  assert.ok(h.texts().includes('The original video is no longer available. Showing the current feed.'));assert.equal(original.released,true);assert.equal(original.playing,false);
  assert.ok(h.e.players.filter(p=>p.playing).length<=1);assert.ok(h.e.players.filter(p=>!p.released).length<=3);
 }finally{await h.close();}
});
