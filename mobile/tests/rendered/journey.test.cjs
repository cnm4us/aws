const assert=require('node:assert/strict');
const test=require('node:test');
const {bundle,React:R,Test}=require('./harness.cjs');
test('actual navigator: Menu replacements, selector, Refresh, profile journey and expired commands retain one feed',async()=>{
 const {ViewerNavigator,AuthStore,PlaybackPreferences,CaptionPreferences,FeedStore,e}=await bundle(`export {ViewerNavigator} from './src/navigation/ViewerNavigator';export {AuthStore} from './src/auth/authStore';export {PlaybackPreferences} from './src/preferences/playbackPreferences';export {CaptionPreferences} from './src/preferences/captionPreferences';export {FeedStore} from './src/feed/feedStore';`,true);
 const session={token:'test',expiresAt:'2030-01-01',viewer:{id:1,displayName:'Test'}};
 e.auth=new AuthStore('https://api.test',{login:async()=>session,validate:async()=>session,revoke:async()=>{}},{load:async()=>null,save:async()=>{},clear:async()=>{}});
 await e.auth.restore();await e.auth.signIn('test@example.invalid','test');
 const prefs=new PlaybackPreferences({getItem:async()=>null,setItem:async()=>{}}),cap=new CaptionPreferences({getItem:async()=>null,setItem:async()=>{}});await prefs.hydrate();await cap.hydrate();
 const space={id:9,ulid:null,name:'Personal',slug:'personal',type:'personal',relationship:'owner',subscribed:false};
 e.client={getJson:async path=>path.includes('/creators/')?{creator:{id:2,displayName:'Creator',handle:null,avatarUrl:null,bio:'Bio'},personalEntry:{state:'allowed',space}}:{personal:space,groups:[],channels:[]}};
 const loads=[];
 e.feedFactory=(context,restore)=>new FeedStore(async()=>{loads.push(context.kind==='global'?'global':'space:'+context.spaceId);
  const items=[1,2,3].map(id=>({publicationId:id,spaceId:context.kind==='space'?context.spaceId:90,uploadId:null,productionUlid:null,playbackUrl:`https://media.test/${id}`,creator:{id:2,displayName:'Creator',avatarUrl:null},posterUrl:null,hasCaptions:false}));
  if(context.kind==='space'){const ticket=e.auth.access.ticket();e.auth.access.seed({...ticket,viewerId:1,identityUntil:ticket.startedAt+60000,spaceId:context.spaceId,spaceUntil:ticket.startedAt+60000,publications:items.map(item=>({item,until:ticket.startedAt+60000})),publicIds:[]});}
  if(context.kind==='global'){const ticket=e.auth.access.ticket();e.auth.access.seedPage({items,nextCursor:null,access:{...ticket,publications:[],publicIds:items.map(i=>i.publicationId),publicUntil:ticket.startedAt+60000}});}
  return {items,nextCursor:null,...(restore?{resume:{requestedPublicationId:restore.publicationId,restoredPublicationId:restore.publicationId,outcome:'restored'}}:{})};});
 function App(){return R.createElement(ViewerNavigator,{preferences:prefs,sound:R.useSyncExternalStore(prefs.subscribe,prefs.getSnapshot),captionPreferences:cap,captions:R.useSyncExternalStore(cap.subscribe,cap.getSnapshot)});}
 let root;
 const screen=()=>root.root.findAllByType('Screen').find(n=>n.props.focused);
 const routes=()=>e.navigationState.routes.map(r=>r.name);
 const buttons=()=>screen().findAllByType('Pressable');
 const press=async label=>{const found=buttons().find(n=>n.props.accessibilityLabel===label);assert.ok(found,`Missing ${label} in ${routes()}`);await Test.act(async()=>found.props.onPress());};
 const back=async()=>{await Test.act(async()=>screen().props.navigation.goBack());};
 const layout=async()=>{await Test.act(async()=>{root.root.findAllByType('Screen').find(n=>n.props.name==='Feed').findAllByType('View').find(n=>n.props.onLayout)?.props.onLayout({nativeEvent:{layout:{height:600}}});});};
 const active=()=>e.players.find(p=>p.playing);
 try{
  await Test.act(async()=>{root=Test.create(R.createElement(App));});await layout();
  const original=active();assert.ok(original);original.currentTime=7;
  await press('Pause video');
  for(const destination of ['Account','Settings']){
   await press('Open menu');assert.deepEqual(routes(),['Feed','Menu']);assert.equal(active(),undefined);
   await press(destination);assert.deepEqual(routes(),['Feed',destination]);assert.equal(active(),undefined);
   await press('Done');assert.deepEqual(routes(),['Feed']);assert.equal(original.currentTime,7);assert.equal(original.playing,false);
  }
  await press('Open menu');await press('Playback diagnostics');
  e.alert[2].find(a=>a.text==='Share report').onPress();
  const report=JSON.parse(e.shared.message);assert.equal(report.resources.livePlayers,1);
  const reset=e.alert[2].find(a=>a.text==='Reset diagnostics').onPress;
  await Test.act(async()=>reset());assert.equal(original.currentTime,7);assert.equal(original.playing,false);
  await press('Close menu');
  await press('Choose space. Current space: Global');await press('✓ Global');assert.deepEqual(routes(),['Feed']);assert.equal(loads.length,1);assert.equal(original.currentTime,7);
  await press('Choose space. Current space: Global');await press('Personal');await layout();assert.equal(original.released,true);assert.equal(loads.at(-1),'space:9');
  await press('View Creator\'s profile');assert.deepEqual(routes(),['Feed','CreatorProfile']);
  await press('Open menu');assert.equal(buttons().some(n=>n.props.accessibilityLabel==='Refresh feed'),false);await press('Settings');await press('Done');assert.deepEqual(routes(),['Feed','CreatorProfile']);
  await press('View personal space');await layout();assert.deepEqual(routes(),['Feed']);
  await press('Pause video'); // selected player survives current-context selection
  const before=loads.length;
  await press('Choose space. Current space: Personal. personal');await press('✓ Personal');assert.equal(loads.length,before);assert.ok(buttons().some(n=>n.props.accessibilityLabel==='Back to profile'));
  await press('Open menu');const refresh=buttons().find(n=>n.props.accessibilityLabel==='Refresh feed').props.onPress;
  await Test.act(async()=>{refresh();refresh();});await layout();assert.equal(loads.length,before+1);assert.ok(buttons().some(n=>n.props.accessibilityLabel==='Back to profile'));
  await press('Back to profile');await press('Open menu');await press('Account');await press('Done');assert.deepEqual(routes(),['Feed','CreatorProfile']);
  await back();assert.deepEqual(routes(),['Feed']);await layout();
  await press('Open menu');const late=buttons().find(n=>n.props.accessibilityLabel==='Refresh feed').props.onPress;
  await Test.act(async()=>e.auth.signOut());await layout();const after=loads.length;
  await Test.act(async()=>late());assert.equal(loads.length,after);assert.deepEqual(routes(),['Feed']);
  assert.ok(e.players.filter(p=>!p.released).length<=3);
 }finally{await Test.act(async()=>root?.unmount());e.auth.dispose();}
 assert.equal(e.players.some(p=>!p.released),false);assert.equal(e.players.some(p=>p.count()),false);
});
