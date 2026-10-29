const test=require('node:test'),assert=require('node:assert/strict');
const {bundle,React:R,Test,flatten}=require('./harness.cjs');
async function setup(t){
 const {ViewerNavigator,AuthStore,PlaybackPreferences,CaptionPreferences,e}=await bundle(`export {ViewerNavigator} from './src/navigation/ViewerNavigator';export {AuthStore} from './src/auth/authStore';export {PlaybackPreferences} from './src/preferences/playbackPreferences';export {CaptionPreferences} from './src/preferences/captionPreferences';`,true,true,true);
 const session={token:'test',expiresAt:'2030-01-01',viewer:{id:1,displayName:'Viewer'}};e.auth=new AuthStore('https://api.test',{login:async()=>session,validate:async()=>session,revoke:async()=>{}},{load:async()=>null,save:async()=>{},clear:async()=>{}});await e.auth.restore();await e.auth.signIn('a@example.invalid','fixture');e.paths=[];e.checkpoints=new Map();e.posts=0;
 const card=(id,name,type)=>({id,name,type,slug:`s-${id}`,global:id===90,path:id===90?'/global':type==='personal'?'/personal':`/${type}s/s-${id}`,description:null,artworkUrl:null,saved:true,requiresSignIn:false});
 const global=card(90,'Global','channel'),group=card(12,'Community','group'),channel=card(13,'Broadcast','channel'),personal=card(9,'My Space','personal');const cards=[global,group,channel,personal];
 const source=id=>id===90?{kind:'global'}:{kind:'space',spaceId:id,name:cards.find(c=>c.id===id).name,type:cards.find(c=>c.id===id).type};
 const video=(publicationId,spaceId,creatorId=2,production=publicationId)=>({publicationId,spaceId,creator:{id:creatorId,displayName:creatorId===1?'Viewer':'Creator',avatarUrl:null},uploadId:publicationId,productionUlid:production===1?'01ARZ3NDEKTSV4RRFFQ69G5FAV':'01ARZ3NDEKTSV4RRFFQ69G5FAW',publishedAt:'2026-10-29T00:00:00Z',playbackUrl:`https://media.test/${publicationId}`,posterUrl:null,width:720,height:1280,durationSeconds:20,hasStory:false,hasCaptions:false,reportedByMe:false,sourceContext:source(spaceId)});
 const following=[video(201,12),video(202,13,3),video(203,12)],creations=[video(301,9,1,1),video(303,90,1)],globals=[video(100,90),video(302,90,1,1),video(101,90)];
 const access=items=>({version:1,identity:{viewerId:1,remainingMs:60000},publicationViews:[]});
 const normal=(ctx,items)=>({context:ctx.kind==='global'?{kind:'global'}:{kind:'space',space:{id:ctx.spaceId,name:ctx.name,type:ctx.type}},items,nextCursor:null,access:ctx.kind==='global'?{...access(items),publicView:{remainingMs:60000,publicationIds:items.map(i=>i.publicationId)}}:{...access(items),spaceView:{spaceId:ctx.spaceId,remainingMs:60000},publicationViews:items.map(i=>({publicationId:i.publicationId,spaceId:i.spaceId,uploadId:i.uploadId,productionUlid:i.productionUlid,creatorId:i.creator.id,remainingMs:60000}))}});
 const aggregate=(kind,items)=>({context:{kind},items,nextCursor:null,access:access(items),aggregateAccess:{version:1,kind,viewerId:1,remainingMs:60000,publicationIds:items.map(i=>i.publicationId)},sourcePages:[...new Set(items.map(i=>i.spaceId))].map(id=>normal(source(id),items.filter(i=>i.spaceId===id))),reviewRequired:[]});
 e.fetch=async(url,options={})=>{const u=new URL(url),p=u.pathname;e.paths.push({path:p+u.search,method:options.method||'GET'});let data,status=200;
  if(p.endsWith('/config'))data={nativeHomeEnabled:true,nativeDestinationsEnabled:true};
  else if(p.endsWith('/discovery/home'))data={global,recent:[],recentFeeds:[],genres:[{slug:'travel',name:'Travel',items:[group,channel]}]};
  else if(p.endsWith('/discovery/saved'))data={items:u.searchParams.get('type')==='group'?(u.searchParams.has('cursor')?[card(14,'Another community','group')]:[group]):[channel],nextCursor:e.paginate&&!u.searchParams.has('cursor')?'group:'+ 'a'.repeat(80):null,genre:null};
  else if(p.endsWith('/save'))data={ok:true,saved:JSON.parse(options.body).saved};
  else if(p.endsWith('/entry')){const key=p.split('/').at(-2),space=key==='global'?global:cards.find(c=>c.id===Number(key));data={schemaVersion:1,space,document:{name:space.name,welcome:`Rules for ${space.name}`,purpose:null,cultures:[],rules:[]},revision:'a'.repeat(64),canView:true,requiresSignIn:false,requiresAcknowledgment:false,acknowledgmentEnabled:false,accepted:true};}
  else if(p.includes('/feed-checkpoints/')){const kind=p.split('/').at(-1),stored=e.checkpoints.get(kind);if(options.method==='POST'){const body=JSON.parse(options.body);e.checkpoints.set(kind,{revision:(stored?.revision||0)+1,checkpoint:body.checkpoint});data={ok:true,revision:(stored?.revision||0)+1};}else data={revision:stored?.revision||0,checkpoint:e.checkpointUnavailable?null:stored?.checkpoint||null,outcome:e.checkpointUnavailable?'unavailable':stored?'restored':'new'};}
  else if(p.endsWith('/resume'))data={revision:0,checkpoint:null,outcome:'new'};
  else if(p.endsWith('/visit'))data={ok:true,revision:1};
  else if(p.endsWith('/contexts'))data={publicationId:301,items:[video(301,9,1,1),video(302,90,1,1),video(304,12,1,1)].map(i=>({publicationId:i.publicationId,spaceId:i.spaceId,productionUlid:i.productionUlid,sourceContext:i.sourceContext}))};
  else if(p.endsWith('/feed/following')||p.endsWith('/feed/creations')){const kind=p.split('/').at(-1);let items=kind==='following'?(e.unfollowed?[]:following):creations;const ids=u.searchParams.get('publicationIds')?.split(',').map(Number);if(ids)items=items.filter(i=>ids.includes(i.publicationId));data=aggregate(kind,items);}
  else if(p.endsWith('/feed/global'))data=normal({kind:'global'},globals);
  else if(p.endsWith('/spaces/12/feed'))data=normal(source(12),[video(304,12,1,1)]);
  else if(p.endsWith('/reporting/options')){const publicationId=Number(/publications\/(\d+)/.exec(p)[1]);data={context:{kind:'space',spaceId:13},publicationId,spaceId:13,reportedByMe:false,myReport:null,groups:[],initialGroupIds:[],durationSeconds:20};}
  else if(p.endsWith('/engagement')){const publicationId=Number(/publications\/(\d+)/.exec(p)[1]);data={spaceId:13,publicationId,likes:{count:0,likedByMe:false},comments:{count:0,hasCommentedByMe:false,canComment:true,disabledReason:null}};}
  else if(p.endsWith('/creator-follow')){const publicationId=Number(/publications\/(\d+)/.exec(p)[1]);data={space:{id:13,name:'Broadcast',type:'channel'},publicationId,creatorId:3,following:true,followingElsewhere:false,followersCount:1,canFollow:true};}
  else data={};
  const anchor=Number(u.searchParams.get('anchorPublicationId'));if(anchor&&data.items)data.resume={requestedPublicationId:anchor,restoredPublicationId:data.items.some(i=>i.publicationId===anchor)?anchor:null,outcome:data.items.some(i=>i.publicationId===anchor)?'restored':'unavailable'};
  if(p.endsWith('/discovery/saved')&&u.searchParams.has('cursor')&&e.holdSavedMore)return new Promise(resolve=>{e.finishSavedMore=()=>resolve(new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}}));});
  if(p.includes('/feed-checkpoints/')&&options.method!=='POST'&&e.holdCheckpoint)return new Promise(resolve=>{e.finishCheckpoint=()=>resolve(new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}}));});
  return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
 };
 const prefs=new PlaybackPreferences({getItem:async()=>null,setItem:async()=>{}}),caps=new CaptionPreferences({getItem:async()=>null,setItem:async()=>{}});await prefs.hydrate();await caps.hydrate();let root;
 function App(){return R.createElement(ViewerNavigator,{preferences:prefs,sound:R.useSyncExternalStore(prefs.subscribe,prefs.getSnapshot),captionPreferences:caps,captions:R.useSyncExternalStore(caps.subscribe,caps.getSnapshot)});}
 await Test.act(async()=>{root=Test.create(R.createElement(App));});
 const screen=()=>root.root.findAllByType('Screen').find(n=>n.props.focused),labels=()=>screen().findAllByType('Pressable').map(n=>n.props.accessibilityLabel);
 const press=async label=>{const b=screen().findAllByType('Pressable').find(n=>typeof label==='string'?n.props.accessibilityLabel===label:label.test(n.props.accessibilityLabel));assert.ok(b,String(label));assert.ok(!b.props.disabled,`${label} disabled`);await Test.act(async()=>{b.props.onPress();});};
 const layout=async()=>Test.act(async()=>screen().findAllByType('View').find(n=>n.props.testID==='feed-stage')?.props.onLayout({nativeEvent:{layout:{width:375,height:600}}}));
 const selected=()=>e.players.find(p=>!p.released&&p.playing)||e.players.find(p=>!p.released);
 const swipe=async index=>Test.act(async()=>{const list=screen().findAllByType('FlatList')[0];list.props.onScrollBeginDrag();list.props.onMomentumScrollEnd({nativeEvent:{contentOffset:{y:600*index}}});});
 t.after(async()=>{await Test.act(async()=>root.unmount());e.auth.dispose();assert.ok(e.players.every(p=>p.released));});
 return {e,root,screen,labels,press,layout,selected,swipe};
}
test('destination menu splits saved directories with source type cues and no fixed cards',async t=>{
 const h=await setup(t);await h.press('Open menu');assert.deepEqual(h.labels().slice(1,7),['Home','Following','Global','Your Creations','Your Groups','Your Channels']);assert.ok(!h.labels().includes('Your Spaces'));
 await h.press('Your Groups');assert.equal(h.screen().props.name,'YourGroups');assert.ok(h.labels().includes('Community'));assert.ok(!h.labels().includes('Global'));assert.ok(!h.labels().includes('Broadcast'));assert.ok(h.labels().includes('Save Community to Your Groups'));assert.equal(h.e.players.length,0);
 await h.press('Open menu');await h.press('Your Channels');assert.ok(h.labels().includes('Broadcast'));assert.ok(!h.labels().includes('Community'));assert.ok(!h.labels().includes('My Space'));assert.ok(h.e.paths.some(p=>p.path.endsWith('/discovery/saved?type=channel')));
});
test('Following keeps one three-player window while swiping source spaces and reports the selected publication context',async t=>{
 const h=await setup(t);await h.press('Following');assert.equal(h.screen().props.name,'Feed');await h.layout();const first=h.selected();assert.ok(first?.playing);assert.ok(h.labels().includes('Source: Community · About & Rules'));const players=h.e.players.filter(p=>!p.released);assert.equal(players.length,2);
 await h.swipe(1);assert.equal(h.e.players.filter(p=>!p.released).length,3);assert.ok(players.includes(h.selected()));assert.ok(h.labels().includes('Source: Broadcast · About & Rules'));
 const current=h.selected();current.currentTime=7;await h.press('Pause video');await h.press('Report video');assert.ok(h.e.paths.some(p=>p.path.includes('/spaces/13/publications/202/reporting/options')));assert.equal(current.playing,false);await h.press('Close report');await h.layout();assert.equal(h.selected(),current);assert.equal(current.currentTime,7);assert.equal(current.playing,false);
 await h.press('Open menu');assert.equal(h.screen().findAllByType('Pressable').find(n=>n.props.accessibilityLabel==='Following').props.accessibilityState.selected,true);await h.press('Following');assert.equal(h.selected(),current);assert.equal(current.currentTime,7);
 await h.press('Open menu');await h.press('Home');assert.ok(h.e.players.every(p=>p.released));assert.equal(h.e.checkpoints.get('following').checkpoint.publicationId,202);assert.equal(h.e.checkpoints.get('following').checkpoint.spaceId,13);
 await h.press('Following');await h.layout();assert.equal(h.selected().currentTime,7);assert.equal(h.selected().playing,false);
});
test('Your Creations exposes real publication contexts and restores its own paused position after Global',async t=>{
 const h=await setup(t);await h.press('Your Creations');await h.layout();assert.ok(h.labels().includes('Published in'));assert.ok(!h.labels().some(l=>l?.startsWith('Source:')));const player=h.selected();player.currentTime=7;await h.press('Pause video');await h.press('Published in');assert.equal(h.screen().props.name,'CreationSources');await h.press('Global');await h.layout();assert.ok(h.labels().includes('Choose space. Current space: Global'));assert.ok(player.released);
 await h.press('Open menu');await h.press('Your Creations');await h.layout();assert.equal(h.selected().currentTime,7);assert.equal(h.selected().playing,false);assert.ok(h.labels().includes('Published in'));assert.ok(!h.labels().some(l=>l?.startsWith('Source:')));
});
test('an unfollowed selected stream is masked on return and requires an explicit fresh start',async t=>{
 const h=await setup(t);await h.press('Following');await h.layout();const player=h.selected();player.currentTime=7;await h.press('Open menu');h.e.unfollowed=true;await h.press('Close menu');await h.layout();assert.equal(player.playing,false);
 const mask=h.screen().findAllByType('View').find(n=>n.props.testID==='feed-publication-mask');assert.ok(mask);const retry=mask.findAllByType('Pressable').find(n=>n.props.accessibilityLabel==='Try again');assert.ok(retry);await Test.act(async()=>retry.props.onPress());assert.ok(h.labels().includes('Start from current feed'));assert.ok(h.e.players.every(p=>!p.playing));await h.press('Start from current feed');await h.layout();assert.ok(h.screen().findAllByType('Text').some(n=>n.props.children==='No followed videos yet'));assert.ok(!h.labels().some(l=>l?.startsWith('Source:')));
});

test('late aggregate entry in the background cannot navigate; foreground requires deliberate retry',async t=>{
 const h=await setup(t);h.e.holdCheckpoint=true;await h.press('Following');assert.equal(h.screen().props.name,'AggregateEntry');
 await Test.act(async()=>{h.e.state='background';h.e.listeners.forEach(fn=>fn('background'));});assert.equal(h.screen().props.name,'AggregateEntry');assert.equal(h.e.players.length,0);
 h.e.holdCheckpoint=false;await Test.act(async()=>{h.e.state='active';h.e.listeners.forEach(fn=>fn('active'));h.e.finishCheckpoint();});assert.equal(h.screen().props.name,'AggregateEntry');assert.ok(h.labels().includes('Retry feed'));await h.press('Retry feed');await h.layout();assert.equal(h.screen().props.name,'Feed');assert.ok(h.selected()?.playing);
});

test('a newer in-memory checkpoint wins over an older unavailable durable checkpoint and is independently revalidated',async t=>{
 const h=await setup(t);await h.press('Following');await h.layout();h.selected().currentTime=7;await h.press('Pause video');await h.press('Open menu');await h.press('Home');h.e.checkpointUnavailable=true;await h.press('Following');await h.layout();assert.equal(h.screen().props.name,'Feed');assert.equal(h.selected().currentTime,7);assert.equal(h.selected().playing,false);
});

test('typed saved pagination accepts opaque cursors and cannot resurrect a card removed while More is pending',async t=>{
 const h=await setup(t);h.e.paginate=true;await h.press('Open menu');await h.press('Your Groups');assert.ok(h.labels().includes('Community'));assert.ok(h.labels().includes('More spaces'));
 h.e.holdSavedMore=true;await h.press('More spaces');await h.press('Save Community to Your Groups');assert.ok(!h.labels().includes('Community'));await Test.act(async()=>h.e.finishSavedMore());assert.ok(h.labels().includes('Another community'));assert.ok(!h.labels().includes('Community'));
});


test('a pending Groups page cannot populate Channels after switching chooser tabs',async t=>{
 const h=await setup(t);h.e.paginate=true;await h.press('Following');await h.layout();await h.press('Choose space. Current space: Following');
 assert.ok(h.labels().includes('Community'));h.e.holdSavedMore=true;await h.press('More spaces');await h.press('Channels');assert.ok(h.labels().includes('Broadcast'));
 await Test.act(async()=>h.e.finishSavedMore());assert.ok(h.labels().includes('Broadcast'));assert.ok(!h.labels().includes('Community'));assert.ok(!h.labels().includes('Another community'));assert.ok(!h.screen().findAllByType('Text').some(n=>n.props.children==='Cannot load spaces'));
});


test('Published in offers each actual space rules without entering a feed and preserves the exact video on deliberate entry',async t=>{
 const h=await setup(t);await h.press('Your Creations');await h.layout();const player=h.selected();player.currentTime=7;const allocations=h.e.players.length;
 await h.press('Published in');assert.equal(player.playing,false);
 for(const [name,key] of [['My Space','9'],['Community','12'],['Global','global']]){
  await h.press(`About & Rules: ${name}`);assert.equal(h.screen().props.name,'SpaceEntry');assert.ok(h.screen().findAllByType('Text').some(n=>n.props.children===`Rules for ${name}`));
  assert.ok(h.e.paths.some(p=>p.path.endsWith(`/spaces/${key}/entry`)));assert.equal(h.e.players.length,allocations);assert.equal(player.currentTime,7);assert.equal(player.playing,false);
  await h.press('Open menu');await h.press('Close menu');assert.equal(h.screen().props.name,'SpaceEntry');await h.press('Back');assert.equal(h.screen().props.name,'CreationSources');
 }
 await h.press('About & Rules: Global');await h.press('Enter space');await h.layout();assert.equal(h.screen().props.name,'Feed');assert.ok(h.labels().includes('Choose space. Current space: Global'));
 const list=h.screen().findAllByType('FlatList')[0];assert.equal(list.props.data[list.props.initialScrollIndex].publicationId,302);assert.equal(player.released,true);
 await h.press('Open menu');await h.press('Your Creations');await h.layout();assert.equal(h.selected().currentTime,7);assert.equal(h.selected().playing,true);assert.ok(!h.labels().some(l=>l?.startsWith('Source:')));
});
