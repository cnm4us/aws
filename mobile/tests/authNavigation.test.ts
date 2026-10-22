import assert from 'node:assert/strict';
import test from 'node:test';
import { StackRouter,CommonActions } from '@react-navigation/routers';
import { AuthStore } from '../src/auth/authStore';
import { viewerIdentityKey } from '../src/navigation/viewerIdentityKey';
import type { StoredSession,NativeSession } from '../src/auth/types';

test('pending sign-in keeps Account mounted; success and sign-out reset principal history',async()=>{
  const origin='https://api.test';let saved:StoredSession|null=null,resolve!:(session:NativeSession)=>void;
  let signal:AbortSignal|undefined;
  const session:NativeSession={token:'nv1_'+'a'.repeat(64),expiresAt:'2030-01-01T00:00:00Z',viewer:{id:21,displayName:'Test'}};
  const auth=new AuthStore(origin,{login:async(_email,_password,s)=>{signal=s;return new Promise(done=>{resolve=done;});},
    validate:async()=>session,revoke:async()=>{}},{load:async()=>saved,save:async record=>{saved=record;},clear:async()=>{saved=null;}});
  await auth.restore();
  const router=StackRouter({initialRouteName:'Feed'}),options={routeNames:['Feed','Account','Spaces'],routeParamList:{},routeGetIdList:{}};
  let state=router.getInitialState(options),key=viewerIdentityKey(origin,auth.getSnapshot().viewer?.id),accountUnmounts=0;
  const dispatch=(name:string)=>{const next=router.getStateForAction(state,CommonActions.navigate(name),options);assert.ok(next && next.stale===false);state=next;};
  const unsubscribe=auth.subscribe(()=>{
    const next=viewerIdentityKey(origin,auth.getSnapshot().viewer?.id);
    if(key===next)return;
    key=next;
    const removingAccount=state.routes.some(route=>route.name==='Account');
    state=router.getInitialState(options);
    if(removingAccount){accountUnmounts++;auth.cancelSignIn();}
  });
  try {
    dispatch('Account');const before=auth.getSnapshot().generation;
    const pending=auth.signIn('fixture@example.invalid','test-only');
    await new Promise(done=>setTimeout(done,0));
    assert.ok(auth.getSnapshot().generation>before);
    assert.equal(auth.getSnapshot().status,'signingIn');assert.equal(state.routes.at(-1)?.name,'Account');
    assert.equal(accountUnmounts,0);assert.equal(signal?.aborted,false);
    resolve(session);await pending;
    assert.equal(auth.getSnapshot().status,'authenticated');assert.ok(saved);assert.equal(accountUnmounts,1);
    assert.equal(state.routes.length,1);assert.equal(state.routes[0].name,'Feed');
    dispatch('Spaces');assert.equal(auth.getSnapshot().viewer?.id,21);
    await auth.signOut();assert.equal(auth.getSnapshot().status,'anonymous');assert.equal(saved,null);
    assert.deepEqual(state.routes.map(route=>route.name),['Feed']);
  }finally{unsubscribe();auth.dispose();}
});

test('navigation identity boundaries separate accounts and API origins',()=>{
  assert.equal(viewerIdentityKey('https://a.test',undefined),viewerIdentityKey('https://a.test',null));
  assert.notEqual(viewerIdentityKey('https://a.test',21),viewerIdentityKey('https://a.test',22));
  assert.notEqual(viewerIdentityKey('https://a.test',21),viewerIdentityKey('https://b.test',21));
});
