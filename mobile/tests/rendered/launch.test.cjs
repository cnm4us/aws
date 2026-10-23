const assert=require('node:assert/strict');
const test=require('node:test');
const {bundle,React:R,Test,flatten}=require('./harness.cjs');
const ulid='01ARZ3NDEKTSV4RRFFQ69G5FAV';
const group={id:12,name:'Launch group',type:'group',slug:'group',ulid:null};
const personal={id:9,name:'Personal',type:'personal',slug:'personal',ulid:null};
const destination={space:{id:12,name:group.name,type:'group'},publicationId:205};
async function setup(options={}){
 const {ViewerNavigator,AuthStore,PlaybackPreferences,CaptionPreferences,e}=await bundle(`export {ViewerNavigator} from './src/navigation/ViewerNavigator';export {AuthStore} from './src/auth/authStore';export {PlaybackPreferences} from './src/preferences/playbackPreferences';export {CaptionPreferences} from './src/preferences/captionPreferences';`,true,true);
 const session={token:'test',expiresAt:'2030-01-01',viewer:{id:1,displayName:'Test'}};
 e.auth=new AuthStore('https://api.test',{login:async()=>session,validate:async()=>session,revoke:async()=>{}},{load:async()=>null,save:async()=>{},clear:async()=>{}});
 await e.auth.restore();await e.auth.signIn('test@example.invalid','test');
 e.paths=[];e.targetMissing=false;e.sourceMissing=false;
 const video=(id,spaceId)=>({publicationId:id,spaceId,productionUlid:ulid,uploadId:1,playbackUrl:`https://media.test/${id}`,posterUrl:null,creator:{id:2,displayName:'Creator',avatarUrl:null},hasStory:false,hasCaptions:!!options.captions,description:'Video',width:100,height:200,durationSeconds:10});
 e.fetch=async url=>{
  const u=new URL(url),p=u.pathname;e.paths.push(p+u.search);let data,status=200;
  if(p.endsWith('/spaces/12'))data={sourcePublicationId:100,productionUlid:ulid,...destination};
  else if(p.endsWith('/publications/100/spaces')){data=e.sourceMissing?{error:'publication_not_found'}:{sourcePublicationId:100,productionUlid:ulid,items:[destination],nextCursor:null};if(e.sourceMissing)status=404;}
  else if(p.includes('/creators/'))data={creator:{id:2,displayName:'Creator',handle:null,avatarUrl:null,bio:'Bio'},personalEntry:{state:'allowed',space:personal}};
  else if(p==='/api/viewer/v1/me/spaces')data={personal,groups:[{...group,relationship:'member',subscribed:false}],channels:[]};
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
  await press('Open spaces for this video');assert.equal(e.players.some(p=>p.playing),false);await press('Close');assert.equal(selected(),original);assert.equal(original.currentTime,7);assert.equal(original.playing,false);
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
  assert.equal(e.paths.filter(p=>p.includes('/publications/')).length,before);await press('Close');assert.ok(!labels().includes('Back to Global'));
 }finally{await h.close();}
});
test('known unavailable Global source cannot resume from the mounted cache when chooser closes',async()=>{
 const h=await setup(),{e,press,layout,texts}=h;
 try{
  await layout();const original=h.selected();original.currentTime=7;e.sourceMissing=true;
  await press('Open spaces for this video');assert.equal(e.players.some(p=>p.playing),false);assert.equal(original.released,true);
  await press('Close');await layout();assert.ok(texts().includes('The original video is no longer available. Showing the current feed.'));
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
  await Test.act(async()=>finish(new Response(JSON.stringify({sourcePublicationId:100,productionUlid:ulid,...destination}),{headers:{'Content-Type':'application/json'}})));
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
   assert.ok(chooser.findAllByType('ScrollView').some(n=>n.findAllByType('Pressable').some(b=>b.props.accessibilityLabel==='Close')));
   await h.press('Close');
  }
 }finally{await h.close();}
});
