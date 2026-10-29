const test=require('node:test'),assert=require('node:assert/strict');
const {bundle,React:R,Test,flatten}=require('./harness.cjs');
async function setup(){
 const ports=await bundle(`export {DiscoveryScreen} from './src/discovery/DiscoveryScreen';export {EntryScreen} from './src/discovery/EntryScreen';export {AuthStore} from './src/auth/authStore';`);
 const {e,AuthStore}=ports,session={token:'fixture',expiresAt:'2030-01-01',viewer:{id:1,displayName:'Test'}};
 e.auth=new AuthStore('https://api.test',{login:async()=>session,validate:async()=>session,revoke:async()=>{}},{load:async()=>null,save:async()=>{},clear:async()=>{}});await e.auth.restore();await e.auth.signIn('a@example.invalid','fixture');
 e.dimensions={width:440,height:956,fontScale:1};
 const global={id:90,name:'Global',slug:'global-feed',type:'channel',global:true,path:'/global',description:null,artworkUrl:null,saved:false,requiresSignIn:false};
 const group={...global,id:9,name:'Travel space',type:'group',global:false,path:'/groups/travel-space'};
 const channel={...group,id:10,name:'Channel with description',type:'channel',description:'Extra text must not change the card width.'};
 e.client={getJson:async()=>({global,recent:[group,channel],genres:[{slug:'travel',name:'Travel',items:[group,channel]}]}),postJson:async()=>({ok:true}),deleteJson:async()=>({ok:true})};
 return {...ports,global,group,channel};
}
const buttons=(root,label)=>root.root.findAllByType('Pressable').filter(n=>n.props.accessibilityLabel===label);
const props=(extra={})=>({onSelect:()=>{},onAbout:()=>{},onHome:()=>{},onSaved:()=>{},onRecent:()=>{},onGenre:()=>{},onAccount:()=>{},...extra});

test('safe-container widths ignore descriptions; launch/About are independent and larger text stays full width',async()=>{
 const {DiscoveryScreen,e}=await setup();let root,opens=0,abouts=0;
 try{
  await Test.act(async()=>{root=Test.create(R.createElement(DiscoveryScreen,props({onSelect:()=>opens++,onAbout:()=>abouts++})));});
  const cards=()=>root.root.findAllByType('View').filter(n=>/^space-card-/.test(n.props.testID||''));
  assert.equal(flatten(cards()[0].props.style).width,400);
  assert.deepEqual(cards().slice(1).map(n=>flatten(n.props.style).width),[336,336,336,336]);assert.equal(e.players.length,0);
  await Test.act(async()=>buttons(root,'About and rules for Travel space')[0].props.onPress());assert.equal(abouts,1);assert.equal(opens,0);
  await Test.act(async()=>buttons(root,'Open Travel space')[0].props.onPress());assert.equal(opens,1);assert.equal(buttons(root,'Save Global to Your Spaces').length,0);
  e.dimensions={width:320,height:700,fontScale:1.6};await Test.act(async()=>root.update(R.createElement(DiscoveryScreen,props())));
  await Test.act(async()=>root.root.findAllByType('View').find(n=>n.props.onLayout).props.onLayout({nativeEvent:{layout:{width:320}}}));
  assert.ok(cards().every(n=>flatten(n.props.style).width===280));
 }finally{if(root)await Test.act(async()=>root.unmount());e.auth.dispose();}
});

test('save is confirmed per space and updates duplicates without launching or replacing a scrolled row',async()=>{
 const {DiscoveryScreen,e}=await setup();let root,finish,opens=0,writes=0;
 e.client.postJson=()=>{writes++;return new Promise(resolve=>{finish=resolve;});};
 try{
  await Test.act(async()=>{root=Test.create(R.createElement(DiscoveryScreen,props({onSelect:()=>opens++})));});
  await Test.act(async()=>root.root.findAllByType('ScrollView').find(n=>n.props.testID==='space-row-travel').props.onScroll({nativeEvent:{contentOffset:{x:130}}}));
  await Test.act(async()=>buttons(root,'Save Travel space to Your Spaces')[0].props.onPress());
  assert.ok(buttons(root,'Save Travel space to Your Spaces').every(n=>n.props.disabled&&!n.props.accessibilityState.checked));
  assert.ok(buttons(root,'Save Channel with description to Your Spaces').every(n=>!n.props.disabled));
  await Test.act(async()=>buttons(root,'Save Travel space to Your Spaces')[1].props.onPress());assert.equal(writes,1);
  await Test.act(async()=>finish({ok:true}));assert.ok(buttons(root,'Save Travel space to Your Spaces').every(n=>n.props.accessibilityState.checked&&!n.props.disabled));assert.equal(opens,0);
  assert.equal(root.root.findAllByType('ScrollView').find(n=>n.props.testID==='space-row-travel').props.contentOffset.x,130);
 }finally{if(root)await Test.act(async()=>root.unmount());e.auth.dispose();}
});

test('failed removal keeps confirmed state; successful removal retains fixed Global and My Space cards',async()=>{
 const {DiscoveryScreen,e,global,group}=await setup();let root;
 e.client.getJson=async()=>({global,personal:{...group,id:11,type:'personal',name:'My Space',path:'/personal'},items:[{...group,saved:true}],nextCursor:null,genre:null});e.client.postJson=async()=>{throw Error('offline');};
 try{
  await Test.act(async()=>{root=Test.create(R.createElement(DiscoveryScreen,props({mode:'saved'})));});
  await Test.act(async()=>buttons(root,'Save Travel space to Your Spaces')[0].props.onPress());assert.equal(buttons(root,'Save Travel space to Your Spaces')[0].props.accessibilityState.checked,true);assert.equal(buttons(root,'Save My Space to Your Spaces').length,0);
  e.client.postJson=async()=>({ok:true});await Test.act(async()=>buttons(root,'Save Travel space to Your Spaces')[0].props.onPress());
  assert.equal(buttons(root,'Save Travel space to Your Spaces').length,0);assert.equal(buttons(root,'Global').length,1);assert.equal(buttons(root,'My Space').length,1);
 }finally{if(root)await Test.act(async()=>root.unmount());e.auth.dispose();}
});

test('About reads an accepted document without entering, acknowledging or writing a checkpoint',async()=>{
 const {EntryScreen,e,group}=await setup();let root,entered=0,writes=0;
 e.client.getJson=async()=>({schemaVersion:1,space:group,document:{name:group.name,welcome:'Welcome back',purpose:null,cultures:[],rules:[]},revision:'a'.repeat(64),canView:true,requiresSignIn:false,requiresAcknowledgment:false,acknowledgmentEnabled:true,accepted:true});e.client.postJson=async()=>{writes++;return {ok:true}};
 try{
  await Test.act(async()=>{root=Test.create(R.createElement(EntryScreen,{entryKey:'9',about:true,onEnter:async()=>entered++,onClose:()=>{},onAccount:()=>{}}));});
  assert.equal(entered,0);assert.equal(writes,0);assert.equal(e.players.length,0);
  await Test.act(async()=>buttons(root,'Enter space')[0].props.onPress());assert.equal(entered,1);assert.equal(writes,0);
 }finally{if(root)await Test.act(async()=>root.unmount());e.auth.dispose();}
});

test('background save completion cannot patch a hidden gallery; foreground refresh reconciles it',async()=>{
 const {DiscoveryScreen,e,global,group}=await setup();let root,finish,confirmed=false;
 e.client.getJson=async()=>({global,recent:[{...group,saved:confirmed}],genres:[]});
 e.client.postJson=()=>new Promise(resolve=>{finish=()=>{confirmed=true;resolve({ok:true})};});
 try{
  await Test.act(async()=>{root=Test.create(R.createElement(DiscoveryScreen,props()));});
  const page=()=>root.root.findAllByType('ScrollView').find(n=>n.props.testID==='space-page');
  await Test.act(async()=>page().props.onScroll({nativeEvent:{contentOffset:{y:320}}}));
  await Test.act(async()=>buttons(root,'Save Travel space to Your Spaces')[0].props.onPress());
  await Test.act(async()=>{e.state='background';e.listeners.forEach(fn=>fn('background'));});
  await Test.act(async()=>finish());assert.equal(buttons(root,'Save Travel space to Your Spaces').length,0);
  await Test.act(async()=>{e.state='active';e.listeners.forEach(fn=>fn('active'));});
  assert.equal(buttons(root,'Save Travel space to Your Spaces')[0].props.accessibilityState.checked,true);
  assert.equal(buttons(root,'Save Travel space to Your Spaces')[0].props.disabled,false);assert.equal(page().props.contentOffset.y,320);
 }finally{if(root)await Test.act(async()=>root.unmount());e.auth.dispose();}
});
