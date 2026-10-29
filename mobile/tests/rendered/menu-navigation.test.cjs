const test=require('node:test'),assert=require('node:assert/strict');
const {bundle,React:R,Test,flatten}=require('./harness.cjs');
test('shared menu preserves source keys and Account fields, reuses destinations and sits above Settings',async()=>{
 const {ViewerNavigator,AuthStore,PlaybackPreferences,CaptionPreferences,e}=await bundle(`export {ViewerNavigator} from './src/navigation/ViewerNavigator';export {AuthStore} from './src/auth/authStore';export {PlaybackPreferences} from './src/preferences/playbackPreferences';export {CaptionPreferences} from './src/preferences/captionPreferences';`);
 let finishLogin,loginCalls=0;
 e.auth=new AuthStore('https://api.test',{login:()=>{loginCalls++;return new Promise(resolve=>{finishLogin=resolve;});},validate:async()=>{},revoke:async()=>{}},{load:async()=>null,save:async()=>{},clear:async()=>{}});await e.auth.restore();
 const global={id:90,name:'Global',slug:'global',type:'channel',global:true,path:'/global',description:null,artworkUrl:null,saved:false,requiresSignIn:false};
 let requiresAcknowledgment=true;
 e.client={getJson:async path=>path.endsWith('/config')?{nativeHomeEnabled:true}:path.endsWith('/home')?{global,recent:[],genres:[]}:path.endsWith('/entry')?{schemaVersion:1,space:global,document:{name:'Global',welcome:'Welcome',purpose:null,cultures:[],rules:[]},revision:'a'.repeat(64),canView:true,requiresSignIn:false,requiresAcknowledgment,acknowledgmentEnabled:true,accepted:!requiresAcknowledgment}:{items:[],nextCursor:null,genre:null}};
 const prefs=new PlaybackPreferences({getItem:async()=>null,setItem:async()=>{}}),caps=new CaptionPreferences({getItem:async()=>null,setItem:async()=>{}});await prefs.hydrate();await caps.hydrate();
 let root;const screen=()=>root.root.findAllByType('Screen').find(n=>n.props.focused),buttons=()=>screen().findAllByType('Pressable');
 const press=async label=>{const button=buttons().find(n=>n.props.accessibilityLabel===label);assert.ok(button,label);assert.ok(!button.props.disabled,label);await Test.act(async()=>{button.props.onPress();});};
 const key=()=>e.navigationState.routes.at(-1).key;
 try{
  await Test.act(async()=>{root=Test.create(R.createElement(ViewerNavigator,{preferences:prefs,sound:prefs.getSnapshot(),captionPreferences:caps,captions:caps.getSnapshot()}));});
  const homeKey=key();assert.equal(screen().props.name,'Home');assert.ok(!buttons().some(n=>['Home','Your Spaces','Account'].includes(n.props.accessibilityLabel)));
  await press('Open menu');assert.deepEqual(buttons().slice(1,4).map(n=>n.props.accessibilityLabel),['Home','Your Spaces','Account']);assert.equal(buttons().find(n=>n.props.accessibilityLabel==='Home').props.accessibilityState.selected,true);
  assert.ok(!buttons().some(n=>['Refresh feed','About & Rules','Feed readiness check','Open menu'].includes(n.props.accessibilityLabel)));
  await press('Home');assert.equal(key(),homeKey);assert.equal(e.navigationState.routes.length,1);
  await press('Global');assert.equal(screen().props.name,'SpaceEntry');await press('I’ve read the space rules');await press('Open menu');await press('Close menu');assert.equal(buttons().find(n=>n.props.accessibilityLabel==='I’ve read the space rules').props.accessibilityState.checked,true);
  await press('Open menu');requiresAcknowledgment=false;await press('Close menu');assert.equal(screen().props.name,'SpaceEntry','Menu Close must not auto-enter after policy refresh');assert.equal(e.players.length,0);await press('Back');assert.equal(key(),homeKey);
  await press('Open menu');await press('Your Spaces');assert.equal(screen().props.name,'YourSpaces');const savedKey=key();
  await press('Open menu');await press('Your Spaces');assert.equal(key(),savedKey);assert.equal(e.navigationState.routes.length,2);
  await press('Open menu');const staleHome=buttons().find(n=>n.props.accessibilityLabel==='Home').props.onPress;await press('Account');const accountKey=key();
  for(const [label,value] of [['Email','viewer@example.invalid'],['Password','temporary draft']])await Test.act(async()=>screen().findAllByType('TextInput').find(n=>n.props.accessibilityLabel===label).props.onChangeText(value));
  await press('Open menu');assert.equal(e.keyboardDismissed,true);assert.equal(buttons().find(n=>n.props.accessibilityLabel==='Account').props.accessibilityState.selected,true);await press('Close menu');assert.equal(key(),accountKey);assert.deepEqual(screen().findAllByType('TextInput').map(n=>n.props.value),['viewer@example.invalid','temporary draft']);
  await Test.act(async()=>staleHome());assert.equal(key(),accountKey); // departed menu cannot act
  await press('Open menu');await press('Account');assert.equal(key(),accountKey);
  await press('Open menu');await press('Settings');assert.equal(screen().props.name,'Settings');const settingsKey=key();assert.equal(root.root.findAllByType('Modal').length,0);assert.equal(screen().props.options.presentation,'transparentModal');
  await press('Open menu');assert.equal(screen().props.options.presentation,'fullScreenModal');await press('Close menu');assert.equal(key(),settingsKey);
  await press('Open menu');await press('Settings');assert.equal(key(),settingsKey);await press('Done');assert.equal(key(),accountKey);assert.equal(e.navigationState.routes.some(r=>r.name==='Menu'),false);
  assert.equal(loginCalls,0);await press('Sign in');assert.equal(e.auth.getSnapshot().status,'signingIn');await press('Open menu');await press('Account');assert.equal(e.auth.getSnapshot().status,'signingIn');
  await press('Open menu');await press('Home');assert.equal(key(),homeKey);assert.equal(e.navigationState.routes.length,1);assert.equal(e.players.length,0);assert.equal(e.auth.getSnapshot().status,'anonymous');
  await Test.act(async()=>finishLogin({token:'late',expiresAt:'2030-01-01',viewer:{id:2,displayName:'Late account'}}));assert.equal(e.auth.getSnapshot().status,'anonymous');assert.equal(key(),homeKey);assert.equal(loginCalls,1);
 }finally{await Test.act(async()=>root?.unmount());e.auth.dispose();}
});
