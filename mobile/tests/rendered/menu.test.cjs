const assert = require('node:assert/strict');
const test = require('node:test');
const { bundle, React:R, Test } = require('./harness.cjs');
for (const preview of [false,true]) test(`actual menu identity, logout failure and diagnostic policy (internal=${preview})`, async()=>{
  const { ViewerMenu, AuthStore, e }=await bundle("export {ViewerMenu} from './src/navigation/ViewerMenu';export {AuthStore} from './src/auth/authStore';",preview);
  let failClear=false,saved=null,root;
  e.auth=new AuthStore('https://api.test',{login:async()=>({token:'test',viewer:{id:1,displayName:'Test'},expiresAt:'2030-01-01'}),validate:async()=>{},revoke:async()=>{throw Error('offline');}},
    {load:async()=>saved,save:async x=>{saved=x;},clear:async()=>{if(failClear)throw Error('disk');saved=null;}});
  await e.auth.restore();
  const props={onAccount:()=>{},onSettings:()=>{},onClose:()=>{}};
  const labels=()=>root.root.findAllByType('Pressable').map(n=>n.props.accessibilityLabel);
  try{
    await Test.act(async()=>{root=Test.create(R.createElement(ViewerMenu,props));});
    assert.ok(labels().includes('Sign in')); assert.equal(labels().includes('Refresh feed'),false);
    assert.equal(labels().includes('Playback diagnostics'),preview);
    await Test.act(async()=>e.auth.signIn('test@example.invalid','test'));
    assert.ok(labels().includes('Sign out'));
    const stale=root.root.findAllByType('Pressable').find(n=>n.props.accessibilityLabel==='Sign out').props.onPress;
    failClear=true;
    await Test.act(async()=>stale());
    assert.equal(e.auth.getSnapshot().status,'anonymous');assert.equal(e.auth.getSnapshot().hasSavedSession,true);
    assert.ok(labels().includes('Sign out on this phone'));
    failClear=false;
    await Test.act(async()=>root.root.findAllByType('Pressable').find(n=>n.props.accessibilityLabel==='Sign out on this phone').props.onPress());
    assert.equal(saved,null);assert.ok(labels().includes('Sign in'));
    await Test.act(async()=>e.auth.signIn('second@example.invalid','test'));
    await Test.act(async()=>stale()); assert.equal(e.auth.getSnapshot().status,'authenticated');
    if(preview){
      await Test.act(async()=>root.root.findAllByType('Pressable').find(n=>n.props.accessibilityLabel==='Playback diagnostics').props.onPress());
      assert.equal(e.alert[0],'Playback diagnostics');e.alert[2].find(a=>a.text==='Share report').onPress();
      assert.equal(JSON.parse(e.shared.message).build.kind,'internal-preview');
      e.alert[2].find(a=>a.text==='Reset diagnostics').onPress();assert.equal(e.alert[0],'Diagnostics reset');
    }
  }finally{await Test.act(async()=>root?.unmount());e.auth.dispose();}
});
