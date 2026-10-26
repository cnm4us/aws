const assert=require('node:assert/strict'),test=require('node:test');
const {bundle,React:R,Test,flatten,visible}=require('./harness.cjs');
async function setup(t,otherCreator=false){
 t.mock.timers.enable({apis:['setTimeout','setInterval']});let now=0;t.mock.method(performance,'now',()=>now);
 const {ViewerNavigator,AuthStore,PlaybackPreferences,CaptionPreferences,e}=await bundle(`export {ViewerNavigator} from './src/navigation/ViewerNavigator';export {AuthStore} from './src/auth/authStore';export {PlaybackPreferences} from './src/preferences/playbackPreferences';export {CaptionPreferences} from './src/preferences/captionPreferences';`,true,true,true);
 const session={token:'test',expiresAt:'2030-01-01',viewer:{id:1,displayName:'Viewer'}};
 e.auth=new AuthStore('https://api.test',{login:async()=>session,validate:async()=>{e.validations++;return session;},revoke:async()=>{}},{load:async()=>null,save:async()=>{},clear:async()=>{}});e.validations=0;await e.auth.restore();await e.auth.signIn('test@example.invalid','test');
 const space=id=>({id,name:id===12?'Group':id===13?'Channel':'Personal',type:id===12?'group':id===13?'channel':'personal',ulid:null,slug:`space-${id}`,relationship:'member',subscribed:false});
 e.paths=[];e.follows={};e.writes=0;e.globalOtherCreator=otherCreator;
 e.makeEntry=(s,pub)=>({context:{kind:'space',space:s},items:[pub,pub+1,pub+2].map(id=>({publicationId:id,spaceId:s.id,productionUlid:null,uploadId:1,playbackUrl:`https://media.test/${id}`,posterUrl:null,creator:{id:2,displayName:'Creator 2',avatarUrl:null},hasStory:false,hasCaptions:false})),nextCursor:null,resume:{requestedPublicationId:pub,restoredPublicationId:pub,outcome:'restored'}});
 e.serverAccess=true;
 e.fetch=async(url,options={})=>{
  const u=new URL(url),p=u.pathname,method=options.method||'GET';e.paths.push({path:p,method});let data,status=200;
  const response=()=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
  if(p==='/api/viewer/v1/me/spaces')data={personal:space(20),groups:[space(12)],channels:[space(13)]};
  else if(p.startsWith('/api/viewer/v1/creators/')){const id=Number(p.split('/').pop());data={creator:{id,displayName:`Creator ${id}`,handle:null,avatarUrl:null,bio:'Public bio'},personalEntry:{state:'allowed',space:space(20)}};}
  else if(p.includes('/feed/global/publications/100/spaces')){const target={space:{id:12,name:'Group',type:'group',description:'Fixture group introduction'},publicationId:200};data={sourcePublicationId:100,productionUlid:null,creator:{id:2,displayName:'Creator 2',avatarUrl:null,bio:'Public bio'},...(p.endsWith('/12')?target:{items:[target],nextCursor:null})};}
  else if(p.endsWith('/creator-recognition')){
   const pub=Number(p.split('/')[7]),creator=e.globalOtherCreator&&pub===101?3:e.self?1:2;
   data={publicationId:pub,creatorId:creator,followingInSpaces:!e.self&&Object.entries(e.follows).some(([key,value])=>value&&key.endsWith(`:${creator}`))};
   if(e.recognitionDenied){status=404;data={error:'publication_not_found'};}
   if(e.offline){status=503;data={error:'service_unavailable'};}
   if(e.holdRecognition)return new Promise(r=>{e.finishRecognition=()=>r(response());});
  }
  else if(p.endsWith('/creator-follow')){
   const id=Number(p.split('/')[5]),pub=Number(p.split('/')[7]),creator=e.self?1:2,key=`${id}:${creator}`;
   if(method!=='GET'){e.writes++;e.follows[key]=method==='POST';}
   data={space:{id,name:space(id).name,type:space(id).type},publicationId:pub,creatorId:creator,following:!!e.follows[key],followingElsewhere:!e.self&&Object.entries(e.follows).some(([other,value])=>value&&other!==key&&other.endsWith(`:${creator}`)),followersCount:e.follows[key]?6:5,canFollow:!e.self,disabledReason:e.self?'self':null};
   if(e.denied){status=403;data={error:'forbidden'};}
   if(e.offline){status=503;data={error:'service_unavailable'};}
   if(e.holdRead&&method==='GET')return new Promise(r=>{e.finishRead=()=>r(response());});
   if(e.holdWrite&&method!=='GET')return new Promise(r=>{e.finishWrite=()=>r(response());});
  }else if(p.endsWith('/engagement')){const id=Number(p.split('/')[5]),pub=Number(p.split('/')[7]);data={spaceId:id,publicationId:pub,likes:{count:0,likedByMe:false},comments:{count:0,hasCommentedByMe:false,canComment:true,disabledReason:null}};}
  else {const id=p.includes('/feed/global')?90:Number(p.split('/')[5]),pub=id===90?100:id===12?200:id===13?400:300,creator=id===20?3:e.self?1:2;
   data={context:id===90?{kind:'global'}:{kind:'space',space:space(id)},items:[0,1,2].map(n=>({publicationId:pub+n,spaceId:id,productionUlid:null,uploadId:1,playbackUrl:`https://media.test/${pub+n}`,posterUrl:null,creator:{id:id===90&&e.globalOtherCreator&&n===1?3:creator,displayName:`Creator ${id===90&&e.globalOtherCreator&&n===1?3:creator}`,avatarUrl:null},hasStory:false,hasCaptions:false,description:'Video',width:100,height:200,durationSeconds:10})),nextCursor:null};}
  const anchor=Number(u.searchParams.get('anchorPublicationId'));if(anchor)data.resume={requestedPublicationId:anchor,restoredPublicationId:anchor,outcome:'restored'};
  return response();
 };
 const prefs=new PlaybackPreferences({getItem:async()=>null,setItem:async()=>{}}),captions=new CaptionPreferences({getItem:async()=>null,setItem:async()=>{}});await prefs.hydrate();await captions.hydrate();let root;
 function App(){return R.createElement(ViewerNavigator,{preferences:prefs,sound:R.useSyncExternalStore(prefs.subscribe,prefs.getSnapshot),captionPreferences:captions,captions:R.useSyncExternalStore(captions.subscribe,captions.getSnapshot)});}
 await Test.act(async()=>{root=Test.create(R.createElement(App));});
 const screen=()=>root.root.findAllByType('Screen').find(n=>n.props.focused),buttons=()=>screen().findAllByType('Pressable').filter(visible),labels=()=>buttons().map(n=>n.props.accessibilityLabel),texts=()=>screen().findAllByType('Text').map(n=>n.props.children).flat();
 const press=async label=>{const button=buttons().find(n=>typeof label==='string'?n.props.accessibilityLabel===label:label.test(n.props.accessibilityLabel));assert.ok(button,String(label));assert.ok(!button.props.disabled,`${label} disabled`);await Test.act(async()=>button.props.onPress());};
 const back=async()=>{await Test.act(async()=>screen().props.navigation.goBack());};
 const layout=async()=>{await Test.act(async()=>screen().findAllByType('View').filter(visible).find(n=>n.props.onLayout)?.props.onLayout({nativeEvent:{layout:{height:600}}}));};
 const enter=async(name='Group')=>{await layout();await press(/Choose space/);await press(name);await layout();};
 const app=async status=>{await Test.act(async()=>{e.state=status;e.listeners.forEach(fn=>fn(status));});};
 const tick=async ms=>{now+=ms;await Test.act(async()=>t.mock.timers.tick(ms));};
 const player=()=>e.players.find(p=>!p.released&&p.playing)||e.players.find(p=>!p.released);
 t.after(async()=>{await Test.act(async()=>root.unmount());e.auth.dispose();t.mock.timers.reset();assert.equal(e.players.some(p=>!p.released),false);});
 return {e,root,screen,buttons,labels,texts,press,back,layout,enter,app,tick,player};
}
test('actual Creator Follow is absent from Global/personal; confirmed state is scoped and playback return is preserved',async t=>{
 const h=await setup(t);await h.layout();await h.press("View Creator 2's profile");assert.equal(h.e.paths.some(x=>x.path.endsWith('/creator-follow')),false);await h.back();
 await h.enter();const player=h.player();player.currentTime=4;await h.press("View Creator 2's profile");assert.equal(player.playing,false);assert.ok(h.labels().includes('Follow in Group'));
 const button=h.buttons().find(n=>n.props.accessibilityLabel==='Follow in Group');assert.ok(flatten(button.props.style).minHeight>=44);
 await h.press('Follow in Group');assert.ok(h.labels().includes('Unfollow in Group'));assert.ok(h.texts().includes(6));
 await h.back();await h.layout();assert.equal(h.player(),player);assert.equal(player.currentTime,4);assert.equal(player.playing,true);
 await h.press('Pause video');await h.press("View Creator 2's profile");assert.ok(h.labels().includes('Unfollow in Group'));await h.press('Unfollow in Group');await h.back();await h.layout();assert.equal(h.player().playing,false);
 await h.enter('Channel');await h.press("View Creator 2's profile");assert.ok(h.labels().includes('Follow in Channel'));await h.back();
 await h.enter('Personal');const globalReads=h.e.paths.filter(x=>x.path.endsWith('/creator-recognition')).length;const reads=h.e.paths.filter(x=>x.path.endsWith('/creator-follow')).length;await h.press("View Creator 3's profile");assert.equal(h.e.paths.filter(x=>x.path.endsWith('/creator-follow')).length,reads);assert.equal(h.labels().some(x=>/Follow in/.test(x)),false);assert.equal(h.e.paths.filter(x=>x.path.endsWith('/creator-recognition')).length,globalReads);
});
test('actual nested Launch/group Creator/personal visit never inherits the outer Follow context',async t=>{
 const h=await setup(t);await h.layout();await h.press('Open spaces for this video');await h.press('Open Group (group)');await h.layout();assert.ok(h.labels().includes('Pause video'),JSON.stringify({labels:h.labels(),texts:h.texts(),paths:h.e.paths}));await h.press('Pause video');
 await h.press("View Creator 2's profile");assert.ok(h.labels().includes('Follow in Group'));await h.press('View personal space');await h.layout();
 const reads=h.e.paths.filter(x=>x.path.endsWith('/creator-follow')).length;await h.press("View Creator 3's profile");assert.equal(h.e.paths.filter(x=>x.path.endsWith('/creator-follow')).length,reads);assert.equal(h.labels().some(x=>/Follow in/.test(x)),false);
 await h.back();await h.layout();assert.equal(h.player().playing,false);assert.equal(h.e.navigationState.routes.filter(r=>r.name==='Feed').length,1);assert.ok(h.e.players.filter(p=>!p.released).length<=3);
});
test('actual Follow owns quiet renewal and masks contextual fields on background/denial while public identity stays',async t=>{
 const h=await setup(t);await h.enter();await h.press("View Creator 2's profile");const before=h.e.validations,feedReads=h.e.paths.filter(p=>p.path.endsWith('/feed')).length;
 await h.tick(45_000);assert.ok(h.labels().includes('Follow in Group'));assert.equal(h.e.validations,before);assert.equal(h.e.paths.filter(p=>p.path.endsWith('/feed')).length,feedReads);
 await h.app('background');assert.equal(h.labels().some(x=>/Follow in/.test(x)),false);assert.equal(h.e.players.some(p=>p.playing),false);
 await h.app('active');assert.ok(h.labels().includes('Follow in Group'));h.e.denied=true;await h.tick(45_000);assert.equal(h.labels().some(x=>/Follow in/.test(x)),false);assert.ok(h.texts().includes('Public bio'));assert.equal(h.e.auth.getSnapshot().status,'authenticated');
 h.e.denied=false;await h.press('Refresh Follow status');assert.ok(h.labels().includes('Follow in Group'));
});
test('actual Follow pending close/sign-out cannot resurrect state or resend a write',async t=>{
 const h=await setup(t);await h.enter();await h.press("View Creator 2's profile");h.e.holdWrite=true;await h.press('Follow in Group');assert.equal(h.e.writes,1);assert.equal(h.buttons().find(n=>n.props.accessibilityLabel==='Follow in Group').props.disabled,true);
 await h.back();await Test.act(async()=>h.e.finishWrite());await h.layout();assert.equal(h.e.navigationState.routes.at(-1).name,'Feed');assert.equal(h.e.writes,1);
 await h.press("View Creator 2's profile");assert.ok(h.labels().includes('Unfollow in Group'));await h.press('Unfollow in Group');await Test.act(async()=>h.e.auth.signOut());await Test.act(async()=>h.e.finishWrite());assert.equal(h.e.navigationState.routes.at(-1).name,'Feed');assert.equal(h.e.writes,2);assert.equal(h.labels().some(x=>/Follow in/.test(x)),false);
});
test('actual self Follow preserves the scoped count and exposes no write action',async t=>{
 const h=await setup(t);h.e.self=true;await h.enter();assert.equal(h.labels().some(x=>/^Follow Creator 1/.test(x)),false);await h.press("View Creator 1's profile");assert.ok(h.texts().includes('This is you.'));assert.ok(h.texts().includes(5));assert.equal(h.labels().some(x=>/Follow in/.test(x)),false);assert.equal(h.e.writes,0);
});

test('selected feed Follow updates here, profile and revisit without changing playback or preloading other creators',async t=>{
 const h=await setup(t);await h.enter();
 const reads=()=>h.e.paths.filter(x=>x.path.endsWith('/creator-follow'));
 assert.ok(h.labels().includes('Follow Creator 2 in Group'));
 assert.ok(reads().every(x=>x.path.includes('/publications/200/')),'only selected publication is read');
 const player=h.player();player.currentTime=4;await h.press('Pause video');
 const stalePlus=h.buttons().find(n=>n.props.accessibilityLabel==='Follow Creator 2 in Group').props.onPress;
 await h.press('Follow Creator 2 in Group');await Test.act(async()=>stalePlus());assert.equal(h.e.writes,1);assert.equal(h.labels().includes('Follow Creator 2 in Group'),false);
 assert.equal(flatten(h.buttons().find(n=>n.props.accessibilityLabel==="View Creator 2's profile"&&n.props.accessibilityHint).props.style).borderColor,'#4ade80');assert.equal(player.currentTime,4);assert.equal(player.playing,false);
 await h.press("View Creator 2's profile");assert.ok(h.labels().includes('Unfollow in Group'));
 await h.press('Unfollow in Group');await h.back();await h.layout();
 assert.ok(h.labels().includes('Follow Creator 2 in Group'));assert.equal(h.player().currentTime,4);assert.equal(h.player().playing,false);
 await h.press('Follow Creator 2 in Group');
 const list=h.screen().findByType('FlatList');
 await Test.act(async()=>{list.props.onScrollBeginDrag();list.props.onScroll({nativeEvent:{contentOffset:{y:600}}});list.props.onMomentumScrollEnd({nativeEvent:{contentOffset:{y:600}}});});
 assert.ok(reads().some(x=>x.path.includes('/publications/201/')));
 assert.equal(h.labels().includes('Follow Creator 2 in Group'),false);assert.match(h.buttons().find(n=>n.props.accessibilityLabel==="View Creator 2's profile"&&n.props.accessibilityHint).props.accessibilityHint,/Following in Group/);assert.equal(h.e.writes,3);
});
test('feed Follow shares account renewal owner and masks background or expired selected proof',async t=>{
 const h=await setup(t);await h.enter();const before=h.e.validations;
 await h.tick(45_000);assert.equal(h.e.validations,before);assert.ok(h.labels().includes('Follow Creator 2 in Group'));
 await h.app('background');assert.equal(h.labels().includes('Follow Creator 2 in Group'),false);assert.equal(h.e.players.some(p=>p.playing),false);
 await h.app('active');assert.ok(h.labels().includes('Follow Creator 2 in Group'));
 h.e.holdRead=true;await h.tick(45_000);assert.ok(h.labels().includes('Follow Creator 2 in Group'));
 await h.tick(15_000);assert.equal(h.labels().includes('Follow Creator 2 in Group'),false);
 await Test.act(async()=>h.e.finishRead());assert.equal(h.labels().includes('Follow Creator 2 in Group'),false);
 h.e.holdRead=false;await h.press('Refresh Follow status for Creator 2');assert.ok(h.labels().includes('Follow Creator 2 in Group'));
});
test('uncertain feed Follow reconciles by read; pending profile navigation cannot resend or expose an old result',async t=>{
 const h=await setup(t);await h.enter();h.e.holdWrite=true;
 await h.press('Follow Creator 2 in Group');assert.equal(h.e.writes,1);
 assert.equal(h.buttons().find(n=>n.props.accessibilityLabel==='Follow Creator 2 in Group').props.disabled,true);
 await h.press("View Creator 2's profile");await Test.act(async()=>h.e.finishWrite());
 assert.equal(h.e.writes,1);assert.ok(h.labels().includes('Unfollow in Group'));
 h.e.holdWrite=false;await h.back();await h.layout();assert.equal(h.labels().includes('Follow Creator 2 in Group'),false);
 await h.press("View Creator 2's profile");await h.press('Unfollow in Group');await h.back();await h.layout();
 h.e.offline=true;await h.press('Follow Creator 2 in Group');assert.equal(h.e.writes,3);
 assert.ok(h.labels().includes('Refresh Follow status for Creator 2'));assert.equal(flatten(h.buttons().find(n=>n.props.accessibilityLabel==="View Creator 2's profile"&&n.props.accessibilityHint).props.style).borderColor,'#777');h.e.offline=false;
 await h.press('Refresh Follow status for Creator 2');assert.equal(h.e.writes,3);assert.equal(h.labels().includes('Follow Creator 2 in Group'),false);assert.equal(flatten(h.buttons().find(n=>n.props.accessibilityLabel==="View Creator 2's profile"&&n.props.accessibilityHint).props.style).borderColor,'#4ade80');
});

test('avatar plus and gray/yellow/green reflect exact-space Follow, profile unfollow and masked lifecycle states',async t=>{
 const h=await setup(t);await h.enter();
 const avatar=()=>h.buttons().find(n=>n.props.accessibilityLabel==="View Creator 2's profile"&&n.props.accessibilityHint);
 const color=()=>flatten(avatar().props.style).borderColor;
 const plus=()=>h.buttons().find(n=>/^Follow Creator 2 in /.test(n.props.accessibilityLabel));
 assert.equal(color(),'#777');assert.ok(plus());assert.equal(flatten(plus().props.style).height,44);
 assert.equal(h.texts().includes('Follow here'),false);
 await h.press('Follow Creator 2 in Group');assert.equal(color(),'#4ade80');assert.equal(plus(),undefined);
 await h.enter('Channel');assert.equal(color(),'#facc15');assert.ok(plus());assert.match(avatar().props.accessibilityHint,/another space, not yet in Channel/);
 await h.press('Follow Creator 2 in Channel');assert.equal(color(),'#4ade80');assert.equal(plus(),undefined);
 await h.press("View Creator 2's profile");await h.press('Unfollow in Channel');await h.back();await h.layout();assert.equal(color(),'#facc15');assert.ok(plus());
 await h.app('background');assert.equal(color(),'#777');assert.equal(plus(),undefined);await h.app('active');assert.equal(color(),'#facc15');
 h.e.holdRead=true;await h.tick(45_000);assert.equal(color(),'#facc15');await h.tick(15_000);assert.equal(color(),'#777');
 await Test.act(async()=>h.e.finishRead());assert.equal(color(),'#777');h.e.holdRead=false;await h.press('Refresh Follow status for Creator 2');assert.equal(color(),'#facc15');
 h.e.denied=true;await h.tick(45_000);assert.equal(h.labels().some(x=>/^Follow Creator/.test(x)),false);assert.equal(h.e.players.some(p=>p.playing),false);
});

test('Global recognizes a followed creator with yellow only; last contextual unfollow clears it on return',async t=>{
 const h=await setup(t);await h.layout();
 const avatar=()=>h.buttons().find(n=>n.props.accessibilityLabel==="View Creator 2's profile"&&n.props.accessibilityHint);
 const color=()=>flatten(avatar().props.style).borderColor;
 assert.equal(color(),'#777');assert.equal(h.labels().some(x=>/^Follow Creator/.test(x)),false);
 assert.ok(h.e.paths.filter(x=>x.path.endsWith('/creator-recognition')).every(x=>x.path.includes('/publications/100/')));
 await h.press('Pause video');await h.press('Open spaces for this video');await h.press('Open Group (group)');await h.layout();await h.press('Follow Creator 2 in Group');
 await h.press('Back to Global');await h.layout();assert.equal(color(),'#facc15');assert.equal(h.labels().some(x=>/^Follow Creator/.test(x)),false);assert.equal(h.player().playing,false);
 await h.press("View Creator 2's profile");assert.equal(h.labels().some(x=>/Follow in/.test(x)),false);await h.back();await h.layout();assert.equal(color(),'#facc15');
 await h.press('Open spaces for this video');await h.press('Open Group (group)');await h.layout();await h.press("View Creator 2's profile");await h.press('Unfollow in Group');await h.back();await h.layout();await h.press('Back to Global');await h.layout();assert.equal(color(),'#777');
 assert.ok(h.e.paths.filter(x=>x.path.endsWith('/creator-recognition')).every(x=>x.method==='GET'));
});
test('Global recognition masks background, expiry, error and late selection while public playback remains usable',async t=>{
 const h=await setup(t,true);h.e.follows['12:2']=true;await h.layout();
 const avatar=()=>h.buttons().find(n=>n.props.accessibilityLabel==="View Creator 2's profile"&&n.props.accessibilityHint);
 const color=()=>flatten(avatar().props.style).borderColor;
 await h.tick(45_000);assert.equal(color(),'#facc15');
 await h.app('background');assert.equal(color(),'#777');await h.app('active');assert.equal(color(),'#facc15');
 h.e.holdRecognition=true;await h.tick(45_000);assert.equal(color(),'#facc15');await h.tick(15_000);assert.equal(color(),'#777');
 const late=h.e.finishRecognition;h.e.holdRecognition=false;
 const list=h.screen().findByType('FlatList');await Test.act(async()=>{list.props.onScrollBeginDrag();list.props.onScroll({nativeEvent:{contentOffset:{y:600}}});list.props.onMomentumScrollEnd({nativeEvent:{contentOffset:{y:600}}});});
 await Test.act(async()=>late());assert.equal(h.e.paths.filter(x=>x.path.endsWith('/creator-recognition')).some(x=>x.path.includes('/publications/101/')),true);
 const selected=h.buttons().find(n=>n.props.accessibilityLabel==="View Creator 3's profile"&&n.props.accessibilityHint);assert.equal(flatten(selected.props.style).borderColor,'#777');
 h.e.offline=true;await h.tick(45_000);assert.ok(h.labels().includes('Pause video'));assert.equal(h.e.auth.getSnapshot().status,'authenticated');assert.equal(h.e.writes,0);
 await Test.act(async()=>h.e.auth.signOut());await h.layout();assert.equal(h.e.navigationState.routes.at(-1).name,'Feed');assert.equal(h.labels().some(x=>/^Follow Creator/.test(x)),false);
 const anonReads=h.e.paths.filter(x=>x.path.endsWith('/creator-recognition')).length;await h.tick(45_000);assert.equal(h.e.paths.filter(x=>x.path.endsWith('/creator-recognition')).length,anonReads);
});
