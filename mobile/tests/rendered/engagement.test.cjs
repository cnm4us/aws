const assert=require('node:assert/strict'),test=require('node:test');
const {bundle,React:R,Test,flatten}=require('./harness.cjs');
async function setup(t) {
 t.mock.timers.enable({apis:['setTimeout','setInterval']});let now=0;t.mock.method(performance,'now',()=>now);
 const {ViewerNavigator,AuthStore,PlaybackPreferences,CaptionPreferences,e}=await bundle(`export {ViewerNavigator} from './src/navigation/ViewerNavigator';export {AuthStore} from './src/auth/authStore';export {PlaybackPreferences} from './src/preferences/playbackPreferences';export {CaptionPreferences} from './src/preferences/captionPreferences';`,true,true,true);
 const session={token:'test',expiresAt:'2030-01-01',viewer:{id:1,displayName:'Test'}};
 e.validations=0;e.auth=new AuthStore('https://api.test',{login:async()=>session,validate:async()=>{e.validations++;return session;},revoke:async()=>{}},{load:async()=>null,save:async()=>{},clear:async()=>{}});await e.auth.restore();await e.auth.signIn('a@example.invalid','test');
 const space={id:12,ulid:null,name:'Test group',type:'group',slug:'test-group',relationship:'member',subscribed:false};
 e.paths=[];e.liked=false;e.comments=[];e.denied=false;e.postCalls=0;
 const summary=()=>({count:e.comments.length,hasCommentedByMe:e.comments.length>0,canComment:!e.disabled,disabledReason:e.disabled?'comments_disabled':null});
 e.fetch=async(url,options={})=>{
  const u=new URL(url),p=u.pathname;e.paths.push({path:p+u.search,method:options.method||'GET'});let data,status=200;
  const ctx={spaceId:12,publicationId:200};
  if(p==='/api/viewer/v1/me/spaces')data={personal:null,groups:[space],channels:[]};
  else if(p.endsWith('/engagement')){data=e.denied?{error:'forbidden'}:{...ctx,likes:{count:e.liked?1:0,likedByMe:e.liked},comments:summary()};if(e.denied)status=403;
   if(e.holdEngagement)return new Promise(r=>{e.finishEngagement=()=>r(new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}}));});}
  else if(p.endsWith('/like')){e.liked=options.method==='POST';data={...ctx,likes:{count:e.liked?1:0,likedByMe:e.liked}};if(e.holdLike)return new Promise(r=>{e.finishLike=()=>r(new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}}));});}
  else if(p.endsWith('/comments')){
   if(options.method==='POST'){
    e.postCalls++;const row={id:e.postCalls,body:JSON.parse(options.body).body,createdAt:'2026-10-23 12:00:00',author:{id:1,displayName:'Test'},isMine:true};
    if(e.holdPost)return new Promise(r=>{e.finishPost=()=>r(new Response(JSON.stringify({...ctx,item:row,comments:summary()}),{status:201,headers:{'Content-Type':'application/json'}}));});
    e.comments.push(row);data={...ctx,item:row,comments:summary()};status=201;
   }else data={...ctx,items:[...e.comments].sort((a,b)=>u.searchParams.get('order')==='oldest'?a.id-b.id:b.id-a.id),nextCursor:null,comments:summary()};
  }else {
   const global=p.includes('/feed/global'),spaceId=global?90:12;
   data={context:global?{kind:'global'}:{kind:'space',space},items:[global?100:200,global?101:201,global?102:202].map(id=>({publicationId:id,spaceId,productionUlid:null,uploadId:1,playbackUrl:`https://media.test/${id}`,posterUrl:null,creator:{id:2,displayName:'Creator',avatarUrl:null},hasStory:false,hasCaptions:false,description:'Video',width:100,height:200,durationSeconds:10})),nextCursor:null};
  }
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 };
 const prefs=new PlaybackPreferences({getItem:async()=>null,setItem:async()=>{}}),captions=new CaptionPreferences({getItem:async()=>null,setItem:async()=>{}});await prefs.hydrate();await captions.hydrate();let root;
 function App(){return R.createElement(ViewerNavigator,{preferences:prefs,sound:R.useSyncExternalStore(prefs.subscribe,prefs.getSnapshot),captionPreferences:captions,captions:R.useSyncExternalStore(captions.subscribe,captions.getSnapshot)});}
 await Test.act(async()=>{root=Test.create(R.createElement(App));});
 const screen=()=>root.root.findAllByType('Screen').find(n=>n.props.focused),labels=()=>screen().findAllByType('Pressable').map(n=>n.props.accessibilityLabel);
 const press=async label=>{const button=screen().findAllByType('Pressable').find(n=>typeof label==='string'?n.props.accessibilityLabel===label:label.test(n.props.accessibilityLabel));assert.ok(button,String(label));assert.ok(!button.props.disabled,`${label} disabled`);await Test.act(async()=>button.props.onPress());};
 const layout=async(height=550)=>{await Test.act(async()=>screen().findAllByType('View').find(n=>n.props.onLayout)?.props.onLayout({nativeEvent:{layout:{height}}}));};
 const selected=()=>e.players.find(p=>!p.released&&p.playing)||e.players.find(p=>!p.released);
 const texts=()=>screen().findAllByType('Text').map(n=>n.props.children);
 const draft=async text=>{await Test.act(async()=>screen().findByType('TextInput').props.onChangeText(text));};
 const tick=async ms=>{now+=ms;await Test.act(async()=>{t.mock.timers.tick(ms);});};
 const app=async status=>{await Test.act(async()=>{e.state=status;e.listeners.forEach(fn=>fn(status));});};
 const enter=async()=>{await layout();await press('Choose space. Current space: Global');await press('Test group');await layout();};
 t.after(async()=>{await Test.act(async()=>root.unmount());e.auth.dispose();t.mock.timers.reset();assert.equal(e.players.some(p=>!p.released),false);});
 return {e,root,screen,labels,press,layout,selected,texts,draft,tick,app,enter};
}
test('actual rail/router: Global never fetches engagement; Like confirms without pausing; Comments restores paused/playing position',async t=>{
 const h=await setup(t);await h.layout();assert.equal(h.e.paths.some(x=>x.path.endsWith('/engagement')),false);assert.equal(h.labels().some(x=>/^Like|^Comments/.test(x)),false);
 await h.enter();const player=h.selected();player.currentTime=4;
 await h.press(/^Like, 0/);assert.equal(player.playing,true);assert.ok(h.labels().some(x=>/^Unlike, 1/.test(x)));
 for(const paused of [false,true]){
  if(paused)await h.press('Pause video');await h.press(/^Comments,/);assert.equal(player.playing,false);assert.ok(h.labels().includes('Close comments'));
  await h.draft('A native comment');await h.press('Send comment');assert.ok(h.texts().includes('A native comment'));assert.equal(h.e.postCalls,paused?2:1);
  await h.press('Close comments');await h.layout();assert.equal(h.selected(),player);assert.equal(player.currentTime,4);assert.equal(player.playing,!paused);assert.equal(h.e.keyboardDismissed,true);
 }
 assert.equal(h.e.navigationState.routes.filter(r=>r.name==='Feed').length,1);assert.ok(h.e.players.filter(p=>!p.released).length<=3);
 await h.layout(250);const rail=h.screen().findAllByType('ScrollView').find(n=>flatten(n.props.style).right===16);assert.ok(flatten(rail.props.style).height<=202);
});
test('actual Comments verification owns renewal, preserves a draft quietly, clears on background/denial and recovers without sign-out',async t=>{
 const h=await setup(t);await h.enter();await h.press(/^Comments,/);await h.draft('Private draft');
 const feedReads=()=>h.e.paths.filter(x=>x.path.startsWith('/api/viewer/v1/spaces/12/feed')).length,before=feedReads(),validations=h.e.validations;
 await h.press(/Sort comments\. Current order:/);assert.equal(h.screen().findAllByType('Modal').length,1);
 await h.tick(45_000);assert.equal(h.screen().findByType('TextInput').props.value,'Private draft');assert.equal(feedReads(),before);assert.equal(h.e.validations,validations+1);
 assert.equal(h.screen().findAllByType('Modal').length,1);
 await h.app('background');assert.equal(h.screen().findAllByType('TextInput').length,0);assert.equal(h.e.players.some(p=>p.playing),false);
 assert.equal(h.screen().findAllByType('Modal').length,0);
 await h.app('active');assert.equal(h.screen().findByType('TextInput').props.value,'');
 await h.press(/Sort comments\. Current order:/);
 h.e.denied=true;await h.tick(45_000);assert.equal(h.screen().findAllByType('TextInput').length,0);assert.equal(h.e.auth.getSnapshot().status,'authenticated');
 assert.equal(h.screen().findAllByType('Modal').length,0);
 h.e.denied=false;await h.press('Try again');assert.equal(h.screen().findAllByType('TextInput').length,1);await h.press('Close comments');
 assert.equal(h.e.players.some(p=>p.playing),false);await h.press('Try again');await h.layout();assert.ok(h.selected().playing);
});
test('closing or signing out with a pending Send never posts again, restores a draft or resurrects a route',async t=>{
 const h=await setup(t);await h.enter();await h.press(/^Comments,/);await h.draft('Pending');h.e.holdPost=true;
 await h.press('Send comment');assert.equal(h.e.postCalls,1);await h.press('Close comments');await h.layout();await Test.act(async()=>h.e.finishPost());assert.equal(h.e.postCalls,1);assert.ok(!h.labels().includes('Close comments'));
 await h.press(/^Comments,/);assert.equal(h.screen().findByType('TextInput').props.value,'');await h.draft('Other draft');await h.press('Send comment');
 await Test.act(async()=>h.e.auth.signOut());await Test.act(async()=>h.e.finishPost());await h.layout();assert.equal(h.e.navigationState.routes.some(r=>r.name==='Comments'),false);assert.ok(h.labels().includes('Open spaces for this video'));
});

test('actual Like shows visible pending feedback and retains playback until confirmed',async t=>{
 const h=await setup(t);await h.enter();h.e.holdLike=true;const player=h.selected();
 await h.press(/^Like, 0/);assert.ok(h.labels().includes('Updating Like'));assert.ok(h.texts().includes('…'));assert.equal(player.playing,true);
 const button=h.screen().findAllByType('Pressable').find(n=>n.props.accessibilityLabel==='Updating Like');assert.equal(button.props.disabled,true);
 await Test.act(async()=>h.e.finishLike());assert.ok(h.labels().some(x=>/^Unlike, 1/.test(x)));assert.equal(player.playing,true);
});

test('Comments translucent route retains one paused Feed, masks unverified access, and gives enlarged text separate control rows',async t=>{
 const h=await setup(t);await h.enter();const player=h.selected();player.currentTime=4;
 h.e.dimensions={width:320,height:568,fontScale:1.6};h.e.holdEngagement=true;
 await h.press(/^Comments,/);
 const surface=()=>h.screen().findAllByType('View').find(n=>n.props.accessibilityViewIsModal);
 const backdrop=()=>flatten(surface().props.style).backgroundColor;
 assert.equal(h.screen().props.options.presentation,'transparentModal');
 assert.equal(h.screen().props.options.contentStyle.backgroundColor,'transparent');
 assert.equal(backdrop(),'#000');assert.equal(player.playing,false);
 assert.equal(h.e.navigationState.routes.filter(r=>r.name==='Feed').length,1);
 assert.equal(h.root.root.findAllByType('VideoView').length,1);
 h.e.holdEngagement=false;await Test.act(async()=>h.e.finishEngagement());
 assert.equal(backdrop(),'rgba(0,0,0,0.8)');assert.equal(player.playing,false);
 assert.ok(!h.texts().includes('Comments'));
 assert.ok(!h.texts().includes('Test group'));
 const close=h.screen().findAllByType('Pressable').find(n=>n.props.accessibilityLabel==='Close comments');
 assert.equal(close.findAllByType('Text').length,0);assert.equal(close.findAllByType('Image').length,1);
 const closeStyle=flatten(close.props.style({pressed:false}));assert.equal(closeStyle.width,44);assert.equal(closeStyle.height,44);
 const closestView=node=>{let parent=node.parent;while(parent&&parent.type!=='View')parent=parent.parent;return parent;};
 assert.equal(flatten(closestView(close).props.style).alignItems,'flex-end');
 const selector=h.screen().findAllByType('Pressable').find(n=>/Sort comments\. Current order:/.test(n.props.accessibilityLabel));
 assert.equal(flatten(closestView(selector).props.style).alignItems,'center');
 assert.equal(h.screen().findByType('FlatList').findAllByType('Pressable').some(n=>/Sort comments/.test(n.props.accessibilityLabel)),false);
 const send=h.screen().findAllByType('Pressable').find(n=>n.props.accessibilityLabel==='Send comment');
 assert.equal(flatten(closestView(send).props.style).flexDirection,'column');
 await h.press('Close comments');await h.layout();assert.equal(h.selected(),player);assert.equal(player.currentTime,4);assert.equal(player.playing,true);
 await h.press(/^Comments,/);assert.equal(player.playing,false);
 await h.draft('Protected draft');await h.tick(45_000);assert.equal(backdrop(),'rgba(0,0,0,0.8)');
 await h.app('inactive');assert.equal(backdrop(),'#000');assert.equal(h.screen().findAllByType('TextInput').length,0);
 await h.app('background');await h.app('active');assert.equal(backdrop(),'rgba(0,0,0,0.8)');assert.equal(h.screen().findByType('TextInput').props.value,'');
 h.e.denied=true;await h.tick(45_000);assert.equal(backdrop(),'#000');assert.equal(player.playing,false);
 h.e.denied=false;await h.press('Try again');assert.equal(backdrop(),'rgba(0,0,0,0.8)');
 await h.press('Close comments');await h.layout();await h.press('Try again');await h.layout();assert.ok(h.selected().playing);
});

test('centered Comments selector shows count for Newest and Oldest for oldest, with checked overlay choices and safe cancellation',async t=>{
 const h=await setup(t);await h.enter();h.e.dimensions={width:320,height:568,fontScale:1.6};
 h.e.comments=[1,2].map(id=>({id,body:`Comment ${id}`,createdAt:`2026-10-23 12:00:0${id}`,author:{id:1,displayName:'Test'},isMine:true}));h.e.postCalls=2;
 await h.press(/^Comments,/);const player=h.selected();assert.equal(player.playing,false);
 assert.ok(h.texts().includes('2 Comments'));assert.deepEqual(h.screen().findByType('FlatList').props.data.map(c=>c.id),[2,1]);
 await h.draft('Keep this draft');await h.press(/^2 Comments\. Sort comments/);
 assert.equal(h.screen().findByType('Modal').props.transparent,true);
 const options=()=>h.screen().findAllByType('Pressable').filter(n=>n.props.accessibilityRole==='radio');
 assert.deepEqual(options().map(n=>[n.props.accessibilityLabel,n.props.accessibilityState.checked]),[['Newest',true],['Oldest',false]]);
 await h.press('Oldest');assert.equal(h.screen().findAllByType('Modal').length,0);assert.ok(h.labels().includes('Oldest. Sort comments. Current order: Oldest'));
 assert.deepEqual(h.screen().findByType('FlatList').props.data.map(c=>c.id),[1,2]);assert.ok(h.e.paths.some(p=>p.path.includes('/comments?')&&p.path.includes('order=oldest')));
 assert.equal(h.screen().findByType('TextInput').props.value,'Keep this draft');assert.equal(h.e.postCalls,2);
 await h.press(/^Oldest\. Sort comments/);assert.equal(options()[1].props.accessibilityState.checked,true);await h.press('Newest');
 assert.ok(h.texts().includes('2 Comments'));assert.deepEqual(h.screen().findByType('FlatList').props.data.map(c=>c.id),[2,1]);
 const reads=h.e.paths.length;
 for(const dismiss of ['Cancel','Dismiss sort options']){await h.press(/^2 Comments\. Sort comments/);await h.press(dismiss);assert.equal(h.screen().findAllByType('Modal').length,0);}
 await h.press(/^2 Comments\. Sort comments/);await Test.act(async()=>h.screen().findByType('Modal').props.onRequestClose());assert.equal(h.screen().findAllByType('Modal').length,0);
 await h.press(/^2 Comments\. Sort comments/);await h.press('Newest');assert.equal(h.e.paths.length,reads);assert.equal(player.playing,false);
 h.e.holdPost=true;await h.press('Send comment');const trigger=h.screen().findAllByType('Pressable').find(n=>/Sort comments\. Current order:/.test(n.props.accessibilityLabel));assert.equal(trigger.props.disabled,true);
 await Test.act(async()=>h.e.finishPost());await h.press(/Sort comments\. Current order:/);await Test.act(async()=>h.e.auth.signOut());
 assert.equal(h.e.navigationState.routes.some(r=>r.name==='Comments'),false);assert.equal(h.root.root.findAllByType('Modal').length,0);
});
