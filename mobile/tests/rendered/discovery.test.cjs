const test=require('node:test'),assert=require('node:assert/strict');
const {bundle,React:R,Test}=require('./harness.cjs');
test('Home owns no feed player; acknowledgment precedes entry, and Home return restores manual pause and exact position',async()=>{
 const {ViewerNavigator,AuthStore,PlaybackPreferences,CaptionPreferences,FeedStore,e}=await bundle(`export {ViewerNavigator} from './src/navigation/ViewerNavigator';export {AuthStore} from './src/auth/authStore';export {PlaybackPreferences} from './src/preferences/playbackPreferences';export {CaptionPreferences} from './src/preferences/captionPreferences';export {FeedStore} from './src/feed/feedStore';`,true);
 const session={token:'fixture',expiresAt:'2030-01-01',viewer:{id:1,displayName:'Test'}};
 e.auth=new AuthStore('https://api.test',{login:async()=>session,validate:async()=>session,revoke:async()=>{}},{load:async()=>null,save:async()=>{},clear:async()=>{}});await e.auth.restore();await e.auth.signIn('a@example.invalid','fixture');
 const prefs=new PlaybackPreferences({getItem:async()=>null,setItem:async()=>{}}),cap=new CaptionPreferences({getItem:async()=>null,setItem:async()=>{}});await prefs.hydrate();await cap.hydrate();
 const global={id:90,name:'Global',slug:'global-feed',type:'channel',global:true,path:'/global',description:null,artworkUrl:null,saved:false,requiresSignIn:false};
 const group={...global,id:9,name:'Travel space',slug:'travel-space',type:'group',global:false,path:'/groups/travel-space'};
 let accepted=false,revision=0,stored=null;const writes=[];
 e.client={getJson:async path=>{
   if(path.endsWith('/config'))return {nativeHomeEnabled:true};
   if(path.endsWith('/home'))return {global,recent:[],genres:[{slug:'travel',name:'Travel',items:[group]}]};
   if(path.endsWith('/entry'))return {schemaVersion:1,space:global,document:{name:'Global',welcome:'Welcome',purpose:null,cultures:[],rules:[]},revision:'a'.repeat(64),canView:true,requiresSignIn:false,requiresAcknowledgment:!accepted,acknowledgmentEnabled:true,accepted};
   if(path.endsWith('/resume'))return {revision,outcome:stored?'restored':'new',checkpoint:stored};
   throw Error('Unexpected '+path);
 },postJson:async(path,body)=>{writes.push(path);if(path.endsWith('/accept')){accepted=true;return {ok:true}}if(path.endsWith('/visit')){assert.equal(body.revision,revision);stored=body.checkpoint;return {revision:++revision}}throw Error(path)},deleteJson:async()=>({ok:true})};
 const restores=[];
 e.feedFactory=(context,restore)=>new FeedStore(async()=>{restores.push(restore);
   const items=[1,2,3].map(id=>({publicationId:id,spaceId:90,uploadId:10,productionUlid:'01J00000000000000000000000',playbackUrl:'https://media.test/'+id,creator:{id:2,displayName:'Creator',avatarUrl:null},posterUrl:null,hasCaptions:false}));
   const ticket=e.auth.access.ticket();e.auth.access.seedPage({items,nextCursor:null,access:{...ticket,publications:[],publicIds:items.map(i=>i.publicationId),publicUntil:ticket.startedAt+60000}});
   return {items,nextCursor:null,...(restore?{resume:{requestedPublicationId:restore.publicationId,restoredPublicationId:restore.publicationId,outcome:'restored'}}:{})};});
 function App(){return R.createElement(ViewerNavigator,{preferences:prefs,sound:R.useSyncExternalStore(prefs.subscribe,prefs.getSnapshot),captionPreferences:cap,captions:R.useSyncExternalStore(cap.subscribe,cap.getSnapshot)});}
 let root;const screen=()=>root.root.findAllByType('Screen').find(n=>n.props.focused);
 const press=async label=>{const button=screen().findAllByType('Pressable').find(n=>n.props.accessibilityLabel===label);assert.ok(button,'Missing '+label);await Test.act(async()=>button.props.onPress());};
 const layout=async()=>Test.act(async()=>screen().findAllByType('View').find(n=>n.props.onLayout)?.props.onLayout({nativeEvent:{layout:{height:600}}}));
 try {
  await Test.act(async()=>{root=Test.create(R.createElement(App))});assert.equal(screen().props.name,'Home');assert.equal(e.players.length,0);assert.equal(restores.length,0);
  await press('About and rules for Global');assert.equal(screen().props.name,'SpaceEntry');assert.equal(e.players.length,0);assert.equal(writes.length,0);await press('Back');assert.equal(screen().props.name,'Home');
  await press('Global');assert.equal(screen().props.name,'SpaceEntry');assert.equal(e.players.length,0);
  assert.equal(screen().findAllByType('Pressable').find(n=>n.props.accessibilityLabel==='Enter space').props.disabled,true);
  await press('I’ve read the space rules');await press('Enter space');assert.equal(screen().props.name,'Feed');assert.equal(writes.filter(p=>p.endsWith('/accept')).length,1);await layout();
  const player=e.players.find(p=>p.playing);assert.ok(player,JSON.stringify({players:e.players.map(p=>({released:p.released,playing:p.playing,time:p.currentTime})),routes:e.navigationState.routes.map(r=>r.name),texts:screen().findAllByType('Text').map(n=>n.props.children)}));player.currentTime=7;await press('Pause video');
  await press('Open menu');await press('Home');assert.equal(screen().props.name,'Home');assert.ok(e.players.every(p=>p.released));assert.ok(stored);assert.equal(stored.positionSeconds,7);assert.equal(stored.userPaused,true);
  await press('About and rules for Global');assert.equal(screen().props.name,'SpaceEntry');assert.ok(e.players.every(p=>p.released));assert.equal(writes.filter(p=>p.endsWith('/accept')).length,1);await press('Back');
  await press('Global');assert.equal(screen().props.name,'Feed');await layout();assert.equal(restores.at(-1).positionSeconds,7);assert.equal(restores.at(-1).userPaused,true);assert.ok(e.players.filter(p=>!p.released).every(p=>!p.playing));
 }finally{if(root)await Test.act(async()=>root.unmount());}
});

test('lost acknowledgment response reconciles state without entering until another deliberate Enter',async()=>{
 const {EntryScreen,AuthStore,e}=await bundle(`export {EntryScreen} from './src/discovery/EntryScreen';export {AuthStore} from './src/auth/authStore';`);
 const session={token:'fixture',expiresAt:'2030-01-01',viewer:{id:1,displayName:'Test'}};e.auth=new AuthStore('https://api.test',{login:async()=>session,validate:async()=>session,revoke:async()=>{}},{load:async()=>null,save:async()=>{},clear:async()=>{}});await e.auth.restore();await e.auth.signIn('a@example.invalid','fixture');
 let accepted=false,entered=0,posts=0;
 const space={id:90,name:'Global',slug:'global-feed',type:'channel',global:true,path:'/global',description:null,artworkUrl:null,saved:false,requiresSignIn:false};
 e.client={getJson:async()=>({schemaVersion:1,space,document:{name:'Global',welcome:'Welcome',purpose:null,cultures:[],rules:[]},revision:'a'.repeat(64),canView:true,requiresSignIn:false,requiresAcknowledgment:!accepted,acknowledgmentEnabled:true,accepted}),postJson:async()=>{posts++;accepted=true;throw Error('The response was lost.')}};
 let root;const press=async label=>{const button=root.root.findAllByType('Pressable').find(n=>n.props.accessibilityLabel===label);assert.ok(button);await Test.act(async()=>button.props.onPress());};
 try{await Test.act(async()=>{root=Test.create(R.createElement(EntryScreen,{entryKey:'global',onEnter:async()=>{entered++},onClose:()=>{},onAccount:()=>{}}));});await press('I’ve read the space rules');await press('Enter space');assert.equal(posts,1);assert.equal(entered,0);assert.ok(root.root.findAllByType('Text').some(n=>n.props.children==='The response was lost.'));await press('Enter space');assert.equal(posts,1);assert.equal(entered,1);}finally{if(root)await Test.act(async()=>root.unmount());e.auth.dispose();}
});

test('acknowledgment completing in the background cannot navigate or auto-enter on foreground',async()=>{
 const {EntryScreen,AuthStore,e}=await bundle(`export {EntryScreen} from './src/discovery/EntryScreen';export {AuthStore} from './src/auth/authStore';`);
 const session={token:'fixture',expiresAt:'2030-01-01',viewer:{id:1,displayName:'Test'}};e.auth=new AuthStore('https://api.test',{login:async()=>session,validate:async()=>session,revoke:async()=>{}},{load:async()=>null,save:async()=>{},clear:async()=>{}});await e.auth.restore();await e.auth.signIn('a@example.invalid','fixture');
 let accepted=false,entered=0,finish;
 const space={id:90,name:'Global',slug:'global-feed',type:'channel',global:true,path:'/global',description:null,artworkUrl:null,saved:false,requiresSignIn:false};
 e.client={getJson:async()=>({schemaVersion:1,space,document:{name:'Global',welcome:'Welcome',purpose:null,cultures:[],rules:[]},revision:'a'.repeat(64),canView:true,requiresSignIn:false,requiresAcknowledgment:!accepted,acknowledgmentEnabled:true,accepted}),postJson:()=>new Promise(resolve=>{finish=()=>{accepted=true;resolve({ok:true})}})};
 let root;const button=label=>root.root.findAllByType('Pressable').find(n=>n.props.accessibilityLabel===label);
 try{
  await Test.act(async()=>{root=Test.create(R.createElement(EntryScreen,{entryKey:'global',onEnter:async()=>{entered++},onClose:()=>{},onAccount:()=>{}}));});
  await Test.act(async()=>button('I’ve read the space rules').props.onPress());await Test.act(async()=>button('Enter space').props.onPress());
  await Test.act(async()=>{e.state='background';e.listeners.forEach(fn=>fn('background'));});await Test.act(async()=>finish());assert.equal(entered,0);
  await Test.act(async()=>{e.state='active';e.listeners.forEach(fn=>fn('active'));});assert.equal(entered,0);assert.equal(button('Enter space').props.disabled,false);
  await Test.act(async()=>button('Enter space').props.onPress());assert.equal(entered,1);
 }finally{if(root)await Test.act(async()=>root.unmount());e.auth.dispose();}
});

test('an unavailable durable resume offers a deliberate fresh start without entering automatically',async()=>{
 const {EntryScreen,AuthStore,ApiError,e}=await bundle(`export {EntryScreen} from './src/discovery/EntryScreen';export {AuthStore} from './src/auth/authStore';export {ApiError} from './src/api/client';`);
 const session={token:'fixture',expiresAt:'2030-01-01',viewer:{id:1,displayName:'Test'}};e.auth=new AuthStore('https://api.test',{login:async()=>session,validate:async()=>session,revoke:async()=>{}},{load:async()=>null,save:async()=>{},clear:async()=>{}});await e.auth.restore();await e.auth.signIn('a@example.invalid','fixture');
 const space={id:90,name:'Global',slug:'global-feed',type:'channel',global:true,path:'/global',description:null,artworkUrl:null,saved:false,requiresSignIn:false};
 e.client={getJson:async()=>({schemaVersion:1,space,document:{name:'Global',welcome:'Welcome',purpose:null,cultures:[],rules:[]},revision:'a'.repeat(64),canView:true,requiresSignIn:false,requiresAcknowledgment:false,acknowledgmentEnabled:true,accepted:true})};
 let root,entered=0,requested=0;
 try{
  await Test.act(async()=>{root=Test.create(R.createElement(EntryScreen,{entryKey:'global',onEnter:async(_space,fromStart)=>{requested++;if(!fromStart)throw new ApiError('Saved video unavailable.',409,'resume_unavailable');entered++},onClose:()=>{},onAccount:()=>{}}));});
  assert.equal(requested,1);assert.equal(entered,0);assert.equal(e.players.length,0);
  const start=root.root.findAllByType('Pressable').find(n=>n.props.accessibilityLabel==='Start from current feed');assert.ok(start);assert.equal(start.props.disabled,false);
  await Test.act(async()=>start.props.onPress());assert.equal(entered,1);assert.equal(requested,2);
 }finally{if(root)await Test.act(async()=>root.unmount());e.auth.dispose();}
});
