import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthStore } from '../src/auth/authStore';
import { createSessionStorage } from '../src/auth/sessionStorage';
import { ApiError,createApiClient } from '../src/api/client';
import type { NativeSessionApi, SessionStorage, StoredSession } from '../src/auth/types';
import { accountPresentation } from '../src/auth/accountPresentation';

const origin='https://api.example';
const record:StoredSession={version:1,origin,token:'nv1_'+'a'.repeat(64),expiresAt:'2030-01-01T00:00:00.000Z'};
const session={...record,viewer:{id:1,displayName:'Viewer'}};
const deferred=<T>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise<void>(r=>setTimeout(r,0));
function harness(overrides:Partial<NativeSessionApi>={},initial:StoredSession|null=null,storageOverrides:Partial<SessionStorage>={}) {
  let saved=initial;const revoked:string[]=[];
  const api:NativeSessionApi={login:async()=>session,validate:async()=>({expiresAt:session.expiresAt,viewer:session.viewer}),revoke:async token=>{revoked.push(token);},...overrides};
  const storage:SessionStorage={load:async()=>saved,save:async s=>{saved=s;},clear:async()=>{saved=null;},...storageOverrides};
  const auth=new AuthStore(origin,api,storage);return {auth,revoked,saved:()=>saved};
}
test('anonymous launch, saved validation, and origin mismatch do not expose an unvalidated identity',async()=>{
  const empty=harness();await empty.auth.restore();assert.equal(empty.auth.getSnapshot().status,'anonymous');
  const gate=deferred<{expiresAt:string;viewer:typeof session.viewer}>();const h=harness({validate:()=>gate.promise},record);
  const p=h.auth.restore();await tick();assert.equal(h.auth.getSnapshot().viewer,null);assert.equal(h.auth.token(),undefined);
  gate.resolve(session);await p;assert.equal(h.auth.getSnapshot().viewer?.id,1);
  const other=harness({}, {...record,origin:'https://other.example'});await other.auth.restore();assert.equal(other.auth.token(),undefined);
});
test('network failure retains a quarantined credential and permits retry or anonymous browsing',async()=>{
  let fail=true;const h=harness({validate:async()=>{if(fail)throw new ApiError('offline');return session;}},record);
  await h.auth.restore();assert.equal(h.auth.getSnapshot().status,'unavailable');assert.equal(h.auth.token(),undefined);assert.ok(h.saved());
  h.auth.browseAnonymously();assert.equal(h.auth.getSnapshot().status,'anonymous');fail=false;
  await h.auth.restore();assert.equal(h.auth.getSnapshot().status,'authenticated');
});
test('expiry and server rejection remove saved credentials while transient errors do not',async()=>{
  const h=harness({validate:async()=>{throw new ApiError('ended',401);}},record);await h.auth.restore();assert.equal(h.saved(),null);assert.equal(h.auth.getSnapshot().status,'anonymous');
  const expired=harness({}, {...record,expiresAt:'2000-01-01T00:00:00Z'});await expired.auth.restore();assert.equal(expired.saved(),null);
});
test('cancelled sign-in ignores and revokes a late successful response',async()=>{
  const gate=deferred<typeof session>();const h=harness({login:()=>gate.promise});await h.auth.restore();
  const p=h.auth.signIn('a','secret');await tick();h.auth.cancelSignIn();gate.resolve(session);await p;await tick();
  assert.equal(h.auth.getSnapshot().status,'anonymous');assert.equal(h.saved(),null);assert.deepEqual(h.revoked,[record.token]);
});
test('logout serialized behind a delayed save cannot resurrect a session',async()=>{
  const gate=deferred<void>();let saved:StoredSession|null=null;
  const h=harness({},null,{save:async s=>{await gate.promise;saved=s;},clear:async()=>{saved=null;}});
  await h.auth.restore();const p=h.auth.signIn('a','secret');await tick();const logout=h.auth.signOut();
  gate.resolve();await Promise.all([p,logout]);assert.equal(saved,null);assert.equal(h.auth.token(),undefined);
});
test('cancel during a delayed save clears persisted state after the write finishes',async()=>{
  const gate=deferred<void>();let saved:StoredSession|null=null;
  const h=harness({},null,{save:async s=>{await gate.promise;saved=s;},clear:async()=>{saved=null;}});
  await h.auth.restore();const p=h.auth.signIn('a','secret');await tick();h.auth.cancelSignIn();gate.resolve();await p;await tick();assert.equal(saved,null);
});
test('account changes and stale unauthorized responses cannot invalidate the new account',async()=>{
  const a=deferred<typeof session>();let calls=0;const b={...session,token:'nv1_'+'b'.repeat(64),viewer:{id:2,displayName:'B'}};
  const h=harness({login:async()=>++calls===1?a.promise:b});await h.auth.restore();const p=h.auth.signIn('a','a');await tick();
  await h.auth.signIn('b','b');const gen=h.auth.getSnapshot().generation;await h.auth.invalidate(gen-1);a.resolve(session);await p;
  assert.equal(h.auth.getSnapshot().viewer?.id,2);assert.equal(h.saved()?.token,b.token);
});
test('failed secure save revokes the issued session and never authenticates',async()=>{
  const h=harness({},null,{save:async()=>{throw Error('disk');}});await h.auth.restore();await h.auth.signIn('a','a');
  assert.equal(h.auth.token(),undefined);assert.deepEqual(h.revoked,[record.token]);assert.match(h.auth.getSnapshot().message!,/securely/);
});
test('a save that persists before reporting failure is suppressed rather than restored next launch',async()=>{
  let persisted:StoredSession|null=null;
  const h=harness({},null,{save:async record=>{persisted=record;throw Error('uncertain result');},clear:async()=>{persisted=null;}});
  await h.auth.restore();await h.auth.signIn('a','a');assert.equal(persisted,null);assert.equal(h.auth.token(),undefined);
});
test('offline logout removes local identity and explains the revocation limit',async()=>{
  const h=harness({revoke:async()=>{throw Error('offline');}},record);await h.auth.restore();await h.auth.signOut();
  assert.equal(h.saved(),null);assert.equal(h.auth.getSnapshot().viewer,null);assert.match(h.auth.getSnapshot().message!,/phone/);
});

test('Account offers saved-session recovery and local sign-out after an offline verification failure', async()=>{
  let offline=false;
  const h=harness({validate:async()=>{if(offline)throw new ApiError('offline');return session;},
    revoke:async()=>{if(offline)throw new ApiError('offline');}},record);
  await h.auth.restore();const generation=h.auth.getSnapshot().generation;
  offline=true;await h.auth.validate();
  const view=accountPresentation(h.auth.getSnapshot());
  assert.equal(view.mode,'savedSession');assert.equal(view.canSignOut,true);assert.equal(view.canRetrySaved,true);
  assert.equal(h.saved()?.token,record.token);assert.equal(h.auth.getSnapshot().viewer?.id,1);
  assert.equal(h.auth.token(),undefined,'unavailable credentials still cannot authorize protected playback');
  offline=false;assert.equal(await h.auth.retryValidation(),true);
  assert.equal(h.auth.getSnapshot().generation,generation,'retry retains the same account generation');
  assert.equal(accountPresentation(h.auth.getSnapshot()).mode,'signedIn');
  offline=true;await h.auth.validate();await h.auth.signOut();
  assert.equal(h.saved(),null);assert.equal(accountPresentation(h.auth.getSnapshot()).mode,'signIn');
  await h.auth.restore();assert.equal(h.auth.getSnapshot().status,'anonymous');
});

test('Account sign-out stays available during validation and a late result cannot restore the session', async()=>{
  let nextValidation:Promise<typeof session>|undefined;
  const h=harness({validate:()=>nextValidation??Promise.resolve(session)},record);await h.auth.restore();
  const gate=deferred<typeof session>();nextValidation=gate.promise;
  const validation=h.auth.validate();
  assert.equal(accountPresentation(h.auth.getSnapshot()).busy,true);
  assert.equal(accountPresentation(h.auth.getSnapshot()).canSignOut,true);
  await h.auth.signOut();gate.resolve(session);await validation;
  assert.equal(h.saved(),null);assert.equal(h.auth.getSnapshot().status,'anonymous');assert.equal(h.auth.getSnapshot().viewer,null);
});

test('an offline cold restore and anonymous browsing keep saved-session actions without a password form', async()=>{
  const h=harness({validate:async()=>{throw new ApiError('offline');}},record);await h.auth.restore();
  assert.equal(h.auth.getSnapshot().viewer,null);
  assert.equal(accountPresentation(h.auth.getSnapshot()).mode,'savedSession');
  h.auth.browseAnonymously();
  assert.equal(accountPresentation(h.auth.getSnapshot()).mode,'savedSession');
  assert.equal(accountPresentation(h.auth.getSnapshot()).canSignOut,true);
  await h.auth.signOut();assert.equal(accountPresentation(h.auth.getSnapshot()).mode,'signIn');
});

test('a server-rejected session shows the password form rather than offering recovery of invalid credentials', async()=>{
  const h=harness({validate:async()=>{throw new ApiError('ended',401);}},record);await h.auth.restore();
  const view=accountPresentation(h.auth.getSnapshot());
  assert.equal(view.mode,'signIn');assert.equal(view.canSignOut,false);assert.equal(view.canRetrySaved,false);
  assert.equal(h.saved(),null);
});
test('failed local deletion is visible and cannot leave the current feed authorized',async()=>{
  const h=harness({},record,{clear:async()=>{throw Error('disk');}});await h.auth.restore();await h.auth.signOut();
  assert.equal(h.auth.token(),undefined);assert.match(h.auth.getSnapshot().message!,/Retry sign-out/);
});
test('validation is coalesced and an old completion cannot restore a logged-out viewer',async()=>{
  const h=harness({},record);await h.auth.restore();const first=h.auth.validate(),second=h.auth.validate();assert.equal(first,second);await first;
  const gate=deferred<typeof session>();const other=harness({validate:()=>gate.promise},record);const p=other.auth.restore();await tick();await other.auth.signOut();gate.resolve(session);await p;assert.equal(other.auth.token(),undefined);
});
function kv() {const map=new Map<string,string>();return {map,getItem:async(k:string)=>map.get(k)??null,setItem:async(k:string,v:string)=>{map.set(k,v);},removeItem:async(k:string)=>{map.delete(k);}};}
test('secure storage uses valid keys, blocks reinstall resurrection, and honors the sign-out marker',async()=>{
  const secure=kv(),prefs=kv(),s=createSessionStorage(secure,prefs,origin);
  await s.save(record);assert.deepEqual(await s.load(),record);assert.match([...secure.map.keys()][0],/^[\w.-]+$/);
  prefs.map.clear();assert.equal(await s.load(),null);assert.equal(secure.map.size,0);
  await s.save(record);await s.clear();assert.equal(await s.load(),null);
});
test('marker makes logout durable even when Keychain deletion fails',async()=>{
  const secure=kv(),prefs=kv(),s=createSessionStorage({...secure,removeItem:async()=>{throw Error('locked');}},prefs,origin);
  await s.save(record);await s.clear();assert.equal(await s.load(),null);assert.equal([...prefs.map.values()][0],'signed-out');
});
test('API requests snapshot credentials, disable redirects, and never attach them to media or legacy routes',async()=>{
  let captured:any;const client=createApiClient(origin,{getHeaders:()=>({Authorization:`Bearer ${record.token}`}),fetchImpl:async(_input,init)=>{captured=init;return new Response(null,{status:204});}});
  await client.deleteJson('/api/native/v1/session');assert.equal(captured.redirect,'error');assert.equal(captured.credentials,'omit');
  await assert.rejects(client.getJson('https://media.example/video'));await assert.rejects(client.getJson('/api/admin/users'));await assert.rejects(client.getJson('/\\other.example'));
});
test('API errors preserve auth/rate-limit status without exposing arbitrary response bodies',async()=>{
  const client=createApiClient(origin,{fetchImpl:async()=>new Response(JSON.stringify({error:'rate_limited',secret:'never display'}),{status:429,headers:{'Retry-After':'30'}})});
  await assert.rejects(client.getJson('/api/viewer/v1/feed/global'),(e:unknown)=>e instanceof ApiError && e.retryAfterSeconds===30 && !e.message.includes('secret'));
});
