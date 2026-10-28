const test=require('node:test'),assert=require('node:assert/strict');
const {bundle,React:R,Test,flatten}=require('./harness.cjs');
async function setup(t,{anonymous=false}={}) {
 t.mock.timers.enable({apis:['setTimeout','setInterval']});let now=0;t.mock.method(performance,'now',()=>now);
 const {ViewerNavigator,AuthStore,PlaybackPreferences,CaptionPreferences,e}=await bundle(`export {ViewerNavigator} from './src/navigation/ViewerNavigator';export {AuthStore} from './src/auth/authStore';export {PlaybackPreferences} from './src/preferences/playbackPreferences';export {CaptionPreferences} from './src/preferences/captionPreferences';`,true,true,true);
 const session={token:'test',expiresAt:'2030-01-01',viewer:{id:1,displayName:'Test'}};
 e.auth=new AuthStore('https://api.test',{login:async()=>session,validate:async()=>session,revoke:async()=>{}},{load:async()=>null,save:async()=>{},clear:async()=>{}});await e.auth.restore();if(!anonymous)await e.auth.signIn('a@example.invalid','test');
 const space={id:12,ulid:null,name:'Test group',type:'group',slug:'test-group',relationship:'member',subscribed:false};
 e.paths=[];e.reports=new Map();e.posts=0;e.serverAccess=true;
 const groups=[{id:3,label:'Safety',shortDescription:'Safety reason',rules:[{id:1,slug:'safe',title:'Safe rule',shortDescription:'Explanation',isDefault:true}]},{id:4,label:'Other reason',shortDescription:null,rules:[{id:2,slug:'other',title:'Other rule',shortDescription:null,isDefault:true}]}];
 e.fetch=async(url,options={})=>{
  const u=new URL(url),p=u.pathname;e.paths.push({path:p+u.search,method:options.method||'GET'});let data,status=200;
  const global=p.includes('/feed/global'),pub=Number(/\/publications\/(\d+)/.exec(p)?.[1])||100,ctx={context:global?{kind:'global'}:{kind:'space',spaceId:12},publicationId:pub,spaceId:global?29:12};
  if(p.endsWith('/reporting/options')){
   data={...ctx,reportedByMe:e.reports.has(pub),myReport:e.reports.get(pub)||null,groups:e.hideRules?[]:groups,initialGroupIds:e.hideRules?[]:[3],durationSeconds:20};
   if(e.holdRead)return new Promise(r=>{e.finishRead=()=>r(new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}}));});
  }else if(/\/reporting\/groups\/\d+\/rules\/\d+$/.test(p)){
   data={...ctx,groupId:3,ruleId:1,version:2,title:'Safe rule',description:[{kind:'heading',text:'Full explanation',links:[{label:'Read further',href:'https://example.test/rule'}]}],allowed:[{kind:'list',text:'Allowed example',links:[]}],disallowed:[{kind:'paragraph',text:'Disallowed example',links:[]}]};if(e.ruleMissing){data={error:'report_rule_unavailable'};status=404;}if(e.holdDetail)return new Promise(r=>{e.finishDetail=()=>r(new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}}));});
  }else if(p.endsWith('/report')){
   e.posts++;e.lastBody=JSON.parse(options.body);const own={ruleId:e.lastBody.ruleId||1,ruleSlug:'safe',ruleTitle:'Safe rule',userFacingRuleId:e.lastBody.userFacingRuleId,userFacingRuleLabel:'Safety',reportedStartSeconds:e.lastBody.reportedStartSeconds,reportedEndSeconds:e.lastBody.reportedEndSeconds,createdAt:'2026-10-27 00:00:00'};
   e.reports.set(pub,own);data={...ctx,reportedByMe:true,myReport:own};status=201;
   if(e.holdPost)return new Promise(r=>{e.finishPost=()=>r(new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}}));});
  }else if(p==='/api/viewer/v1/me/spaces')data={personal:null,groups:[space],channels:[]};
  else if(p.endsWith('/engagement'))data={spaceId:12,publicationId:pub,likes:{count:0,likedByMe:false},comments:{count:0,hasCommentedByMe:false,canComment:true,disabledReason:null}};
  else data={context:global?{kind:'global'}:{kind:'space',space},items:[global?100:200,global?101:201,global?102:202].map(id=>({publicationId:id,spaceId:global?29:12,uploadId:1,productionUlid:'same-production',playbackUrl:`https://media.test/${id}`,posterUrl:null,creator:{id:2,displayName:'Creator',avatarUrl:null},reportedByMe:e.reports.has(id),hasCaptions:true,hasStory:false,width:720,height:1280,durationSeconds:20})),nextCursor:null};
  const anchor=Number(u.searchParams.get('anchorPublicationId'));if(anchor&&data.items)data.resume={requestedPublicationId:anchor,restoredPublicationId:anchor,outcome:'restored'};
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 };
 const prefs=new PlaybackPreferences({getItem:async()=>null,setItem:async()=>{}}),caps=new CaptionPreferences({getItem:async()=>null,setItem:async()=>{}});await prefs.hydrate();await caps.hydrate();let root;
 function App(){return R.createElement(ViewerNavigator,{preferences:prefs,sound:R.useSyncExternalStore(prefs.subscribe,prefs.getSnapshot),captionPreferences:caps,captions:R.useSyncExternalStore(caps.subscribe,caps.getSnapshot)});}
 await Test.act(async()=>{root=Test.create(R.createElement(App));});
 const screen=()=>root.root.findAllByType('Screen').find(n=>n.props.focused);
 const labels=()=>screen().findAllByType('Pressable').map(n=>n.props.accessibilityLabel);
 const press=async label=>{const b=screen().findAllByType('Pressable').find(n=>typeof label==='string'?n.props.accessibilityLabel===label:label.test(n.props.accessibilityLabel));assert.ok(b,String(label));assert.ok(!b.props.disabled,`${label} disabled`);await Test.act(async()=>{b.props.onPress();});};
 const layout=async()=>{await Test.act(async()=>screen().findAllByType('View').find(n=>n.props.onLayout)?.props.onLayout({nativeEvent:{layout:{width:375,height:650}}}));};
 const selected=()=>e.players.find(p=>!p.released&&p.playing)||e.players.find(p=>!p.released);
 const texts=()=>screen().findAllByType('Text').map(n=>n.props.children);
 const edit=async(field,value)=>{await Test.act(async()=>screen().findAllByType('TextInput').find(n=>n.props.accessibilityLabel===`Report ${field} time`).props.onChangeText(value));};
 const app=async state=>{await Test.act(async()=>{e.state=state;e.listeners.forEach(fn=>fn(state));});};
 const tick=async ms=>{now+=ms;await Test.act(async()=>{t.mock.timers.tick(ms);});};
 t.after(async()=>{await Test.act(async()=>root.unmount());e.auth.dispose();t.mock.timers.reset();assert.ok(e.players.every(p=>p.released));});
 return {e,root,screen,labels,press,layout,selected,texts,edit,app,tick};
}
test('Global flag does not prefetch, owns a stable row and opens one silent retained Feed',async t=>{
 const h=await setup(t);await h.layout();const before=h.labels(),player=h.selected();player.currentTime=7;
 assert.ok(before.indexOf('Report video')>before.indexOf('Show captions'));assert.ok(before.indexOf('Report video')<before.findIndex(l=>/^(Mute|Unmute)$/.test(l)));assert.equal(h.e.paths.some(p=>p.path.includes('/reporting/')),false);
 await h.press('Report video');assert.equal(player.playing,false);assert.equal(h.screen().props.options.presentation,'transparentModal');assert.equal(h.root.root.findAllByType('VideoView').length,1);assert.equal(h.e.navigationState.routes.filter(r=>r.name==='Feed').length,1);
 assert.ok(h.labels().includes('More about Safe rule'));assert.ok(!h.labels().includes('More about Other rule'));assert.equal(h.e.posts,0);
 assert.ok(h.texts().includes('Current video time: 0:07'));assert.deepEqual(h.screen().findAllByType('TextInput').map(n=>n.props.value),['','']);
 await h.press('Use flagged time for Start');assert.deepEqual(h.screen().findAllByType('TextInput').map(n=>n.props.value),['0:07','']);
 await h.edit('start','0:05');await h.press('Use flagged time for End');assert.deepEqual(h.screen().findAllByType('TextInput').map(n=>n.props.value),['0:05','0:07']);
 await h.press('Clear times — whole video');assert.deepEqual(h.screen().findAllByType('TextInput').map(n=>n.props.value),['','']);assert.equal(player.currentTime,7);assert.equal(player.playing,false);assert.equal(h.e.posts,0);
 await h.press('Show all reasons');assert.ok(h.labels().includes('More about Other rule'));await h.edit('start','0:05');await h.press('Close report');await h.layout();assert.equal(h.selected(),player);assert.equal(player.currentTime,7);assert.equal(player.playing,true);
 await h.press('Report video');assert.equal(h.screen().findAllByType('TextInput')[0].props.value,'0:05');
});
test('mapped rule explanations, editable times and explicit submission yield Sent without cross-publication bleed',async t=>{
 const h=await setup(t);await h.layout();const player=h.selected();player.currentTime=7;
 await h.press('Report video');await h.edit('start','0:00');await h.press('Use flagged time for End');await h.press('More about Safe rule');assert.ok(JSON.stringify(h.texts()).includes('Full explanation'));
 await h.press('Rule section: Long Description');await h.press('Allowed Examples');assert.ok(JSON.stringify(h.texts()).includes('Allowed example'));await h.press('Rule section: Allowed Examples');await h.press('Disallowed Examples');assert.ok(JSON.stringify(h.texts()).includes('Disallowed example'));assert.equal(h.e.posts,0);
 await h.press('Rule section: Disallowed Examples');await h.press('Long Description');await h.press('Open link: Read further');assert.equal(h.e.openedUrl,'https://example.test/rule');
 await h.press('Submit report');await h.layout();assert.equal(h.e.posts,1);assert.deepEqual(h.e.lastBody,{userFacingRuleId:3,ruleId:1,reportedStartSeconds:0,reportedEndSeconds:7});assert.ok(h.labels().includes('Report already sent'));assert.equal(h.selected(),player);assert.equal(player.currentTime,7);
 await h.press('Report already sent');assert.ok(h.texts().includes('Your report was sent.'));assert.ok(!h.labels().includes('Submit report'));await h.press('Read reported rule');assert.ok(h.labels().includes('Back to reporting reasons'));assert.ok(!h.labels().includes('Submit report'));await h.press('Back to reporting reasons');await h.press('Close report');await h.layout();
 await h.press('Choose space. Current space: Global');await h.press('Test group');await h.layout();assert.ok(h.labels().includes('Report video'));assert.ok(!h.labels().includes('Report already sent'));
});
test('paused playback stays paused, background clears draft and blocks covered controls',async t=>{
 const h=await setup(t);await h.layout();const player=h.selected();player.currentTime=4;await h.press('Pause video');await h.press('Report video');await h.edit('start','0:03');await h.app('background');assert.equal(h.screen().findAllByType('TextInput').length,0);assert.equal(player.playing,false);
 await h.app('active');assert.equal(h.screen().findAllByType('TextInput')[0].props.value,'');await h.press('Close report');await h.layout();assert.equal(player.playing,false);assert.equal(player.currentTime,4);
});
test('optional explanation404 leaves reporting/feed usable, and late read cannot reopen after Close',async t=>{
 const h=await setup(t);await h.layout();await h.press('Report video');h.e.ruleMissing=true;await h.press('More about Safe rule');assert.ok(h.labels().includes('Back to reporting reasons'));assert.equal(h.screen().findAllByType('Pressable').find(n=>n.props.accessibilityLabel==='Submit report').props.disabled,true);assert.ok(!h.texts().includes('Loading explanation…'));assert.equal(h.e.auth.getSnapshot().status,'authenticated');await h.press('Back to reporting reasons');assert.ok(!h.labels().includes('Submit report'));await h.press('Close report');await h.layout();assert.ok(h.selected().playing);
 h.e.holdRead=true;await h.press('Report video');const backdrop=h.screen().findAllByType('View').find(n=>n.props.accessibilityViewIsModal);assert.equal(flatten(backdrop.props.style).backgroundColor,'#000');await h.press('Close report');await h.layout();await Test.act(async()=>h.e.finishRead());assert.ok(!h.labels().includes('Close report'));assert.ok(h.selected().playing);
});
test('pending submission Close/account replacement never navigates or repeats a report',async t=>{
 const h=await setup(t);await h.layout();await h.press('Report video');await h.press('More about Safe rule');h.e.holdPost=true;await h.press('Submit report');assert.equal(h.e.posts,1);await h.press('Back to reporting reasons');for(const field of ['Start','End'])assert.equal(h.screen().findAllByType('Pressable').find(n=>n.props.accessibilityLabel===`Use flagged time for ${field}`).props.disabled,true);await h.press('Close report');await h.layout();await Test.act(async()=>h.e.finishPost());assert.equal(h.e.posts,1);assert.ok(!h.labels().includes('Close report'));
 await h.press('Report video');assert.ok(h.texts().includes('Your report was sent.'));await Test.act(async()=>h.e.auth.signOut());assert.equal(h.e.navigationState.routes.some(r=>r.name==='Report'),false);
});
test('anonymous Global prompts for sign-in without loading reasons or carrying submit intent',async t=>{
 const h=await setup(t,{anonymous:true});await h.layout();await h.press('Report video');assert.ok(h.labels().includes('Sign in'));assert.equal(h.e.paths.some(p=>p.path.includes('/reporting/')),false);assert.equal(h.e.posts,0);await h.press('Sign in');assert.equal(h.e.navigationState.routes.some(r=>r.name==='Report'),false);
});

test('rule Back restores times, Show all, bounded scroll and originating More focus without a second route',async t=>{
 const h=await setup(t);await h.layout();const player=h.selected();player.currentTime=7;await h.press('Report video');await h.press('Show all reasons');await h.edit('start','0:02');
 const list=()=>h.screen().findAllByType('ScrollView').find(n=>n.props.testID==='report-reasons-list');
 await Test.act(async()=>{list().props.onLayout({nativeEvent:{layout:{height:600}}});list().props.onContentSizeChange(375,1600);list().props.onScroll({nativeEvent:{contentOffset:{y:460}}});});
 await h.press('More about Safe rule');assert.equal(h.e.focusedAccessibilityLabel,'Safe rule');assert.equal(h.screen().findAllByType('TextInput').length,0);assert.ok(!h.labels().includes('Close report'));assert.equal(h.root.root.findAllByType('Modal').length,0);
 const footer=h.screen().findAllByType('View').find(n=>n.props.testID==='report-rule-footer');for(let n=footer.parent;n;n=n.parent)assert.notEqual(n.type,'ScrollView');
 await h.press('Rule section: Long Description');assert.equal(h.screen().findAllByType('Pressable').find(n=>n.props.accessibilityLabel==='Submit report').props.disabled,true);await h.press('Cancel section selection');
 await h.press('Back to reporting reasons');await Test.act(async()=>{list().props.onLayout({nativeEvent:{layout:{height:600}}});list().props.onContentSizeChange(375,1600);});
 assert.deepEqual(h.screen().findAllByType('TextInput').map(n=>n.props.value),['0:02','']);assert.ok(h.labels().includes('More about Other rule'));assert.ok(h.e.scrolls.some(s=>s.target==='report-reasons-list'&&s.y===460));assert.equal(h.e.focusedAccessibilityLabel,'More about Safe rule');assert.equal(player.playing,false);assert.equal(h.e.posts,0);assert.equal(h.root.root.findAllByType('VideoView').length,1);
 await h.press('Close report');await h.layout();assert.equal(h.selected(),player);assert.equal(player.currentTime,7);assert.equal(player.playing,true);
});
test('Back during rule loading ignores late detail; failed rule remains on its view and retries',async t=>{
 const h=await setup(t);await h.layout();await h.press('Report video');h.e.holdDetail=true;await h.press('More about Safe rule');assert.ok(h.texts().includes('Loading explanation…'));assert.ok(h.labels().includes('Back to reporting reasons'));assert.equal(h.screen().findAllByType('Pressable').find(n=>n.props.accessibilityLabel==='Submit report').props.disabled,true);
 await h.press('Back to reporting reasons');await Test.act(async()=>h.e.finishDetail());assert.ok(h.labels().includes('More about Safe rule'));assert.ok(!h.labels().includes('Submit report'));
 h.e.holdDetail=false;h.e.ruleMissing=true;await h.press('More about Safe rule');assert.ok(h.labels().includes('Retry explanation'));assert.ok(h.labels().includes('Back to reporting reasons'));h.e.ruleMissing=false;await h.press('Retry explanation');assert.ok(h.labels().includes('Rule section: Long Description'));assert.equal(h.e.posts,0);
});
test('range errors and expiry are visible on the rule footer and require time review without automatic writes',async t=>{
 const h=await setup(t);await h.layout();await h.press('Report video');await h.edit('start','0:08');await h.edit('end','0:07');await h.press('More about Safe rule');assert.equal(h.screen().findAllByType('Pressable').find(n=>n.props.accessibilityLabel==='Submit report').props.disabled,true);assert.equal(h.e.posts,0);assert.ok(JSON.stringify(h.texts()).includes('Go Back to edit the video segment'));
 await h.press('Back to reporting reasons');await h.edit('start','0:00');await h.press('More about Safe rule');await h.tick(45000);await h.tick(15000);assert.equal(h.screen().findAllByType('Pressable').find(n=>n.props.accessibilityLabel==='Submit report').props.disabled,false);
 await h.press('Back to reporting reasons');assert.deepEqual(h.screen().findAllByType('TextInput').map(n=>n.props.value),['0:00','0:07']);await h.press('More about Safe rule');
 for(let elapsed=60000;elapsed<900000;){const step=Math.min(15000,900000-elapsed);await h.tick(step);elapsed+=step;}assert.ok(h.labels().includes('Back to reporting reasons'));assert.equal(h.screen().findAllByType('Pressable').find(n=>n.props.accessibilityLabel==='Submit report').props.disabled,true);assert.ok(JSON.stringify(h.texts()).includes('time edits expired'));assert.equal(h.e.posts,0);
 await h.press('Back to reporting reasons');await h.edit('end','0:08');await h.press('More about Safe rule');assert.equal(h.screen().findAllByType('Pressable').find(n=>n.props.accessibilityLabel==='Submit report').props.disabled,false);
});

test('choices renewal removes selected rule content/action without denying feed or changing selected view',async t=>{
 const h=await setup(t);await h.layout();await h.press('Report video');await h.press('More about Safe rule');assert.ok(JSON.stringify(h.texts()).includes('Full explanation'));
 h.e.hideRules=true;await h.tick(45000);assert.ok(h.labels().includes('Back to reporting reasons'));assert.ok(!JSON.stringify(h.texts()).includes('Full explanation'));assert.equal(h.screen().findAllByType('Pressable').find(n=>n.props.accessibilityLabel==='Submit report').props.disabled,true);assert.ok(!h.labels().includes('Retry explanation'));assert.equal(h.e.auth.getSnapshot().status,'authenticated');
 await h.press('Back to reporting reasons');await h.press('Close report');await h.layout();assert.ok(h.selected().playing);assert.equal(h.e.posts,0);
});
