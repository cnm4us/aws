import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../src/api/client';
import { FollowStore } from '../src/follows/followStore';
import { adaptFollow, adaptRecognition, type FollowProof } from '../src/follows/api';
const ctx:FollowProof={spaceId:2,publicationId:9,creatorId:7,generation:1,visitId:1};
const summary=(following=false)=>({space:{id:2,name:'Group',type:'group'},publicationId:9,creatorId:7,following,followingElsewhere:false,followersCount:following?4:3,canFollow:true,disabledReason:null});
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function fixture(t:any){
 t.mock.timers.enable({apis:['setTimeout']});let now=0,following=false,reads=0,writes=0,denied=0,verified=0;
 const client:any={getJson:async()=>{reads++;return summary(following);},postJson:async()=>{writes++;following=true;return summary(true);},deleteJson:async()=>{writes++;following=false;return summary(false);}};
 const store=new FollowStore(client,ctx,async()=>{verified++;},()=>denied++,()=>now);
 t.after(()=>{store.dispose();t.mock.timers.reset();});
 return {store,client,advance:async(ms:number)=>{now+=ms;t.mock.timers.tick(ms);await flush();},counts:()=>({reads,writes,denied,verified})};
}
test('Follow adapter validates exact proof/capability and minimizes the response',()=>{
 const dto=adaptFollow({...summary(),email:'secret',space:{...summary().space,token:'secret'}},ctx);assert.equal(JSON.stringify(dto).includes('secret'),false);
 for(const raw of [{...summary(),followingElsewhere:undefined},{...summary(),followingElsewhere:1},{...summary(),canFollow:false,disabledReason:'self',followingElsewhere:true},{...summary(),creatorId:8},{...summary(),publicationId:10},{...summary(),space:{...summary().space,type:'personal'}},{...summary(),followersCount:-1},{...summary(),canFollow:false},{...summary(),disabledReason:'self'}])assert.throws(()=>adaptFollow(raw,ctx));
 assert.equal(adaptFollow({...summary(),following:false,canFollow:false,disabledReason:'self'},ctx).followersCount,3);
 assert.equal(adaptFollow({...summary(),followingElsewhere:true},ctx).followingElsewhere,true);
 assert.equal(adaptFollow({...summary(true),followingElsewhere:true},ctx).following,true);
});
test('Follow confirms counts, serializes a pending write and ignores completion after close',async t=>{
 const h=fixture(t);h.store.setActive(true);await flush();assert.equal(h.store.getSnapshot().summary?.following,false);
 let finish!:(v:unknown)=>void,calls=0;h.client.postJson=()=>{calls++;return new Promise(r=>finish=r);};const pending=h.store.toggle();await h.store.toggle();assert.equal(calls,1);assert.equal(h.store.getSnapshot().busy,true);assert.equal(h.store.getSnapshot().summary?.following,false);
 h.store.setActive(false);finish(summary(true));await pending;assert.equal(h.store.getSnapshot().summary,null);assert.equal(h.store.getSnapshot().busy,false);
 h.store.setActive(true);await flush();assert.equal(h.store.getSnapshot().summary?.following,false);
});
test('quiet Follow renewal retains UI; hard expiry aborts a write and rejects late success',async t=>{
 const h=fixture(t);h.store.setActive(true);await flush();
 let finishRead!:(v:unknown)=>void;h.client.getJson=()=>new Promise(r=>finishRead=r);
 await h.advance(45_000);assert.equal(h.store.getSnapshot().authorized,true);assert.equal(h.store.getSnapshot().summary?.followersCount,3);
 let finishWrite!:(v:unknown)=>void;h.client.postJson=()=>new Promise(r=>finishWrite=r);const pending=h.store.toggle();
 await h.advance(15_000);assert.equal(h.store.getSnapshot().authorized,false);assert.equal(h.store.getSnapshot().summary,null);
 finishRead(summary());finishWrite(summary(true));await pending;await flush();assert.equal(h.store.getSnapshot().summary,null);
});
test('renewal started before a successful write cannot overwrite the confirmed Follow state',async t=>{
 const h=fixture(t);h.store.setActive(true);await flush();let finish!:(v:unknown)=>void;h.client.getJson=()=>new Promise(r=>finish=r);
 await h.advance(45_000);await h.store.toggle();assert.equal(h.store.getSnapshot().summary?.following,true);
 finish(summary(false));await flush();assert.equal(h.store.getSnapshot().summary?.following,true);
});
test('ambiguous Follow failure requires read reconciliation and never resends on Retry',async t=>{
 const h=fixture(t);h.store.setActive(true);await flush();let calls=0;
 h.client.postJson=async()=>{calls++;throw new ApiError('Timed out');};await h.store.toggle();assert.equal(h.store.getSnapshot().uncertain,true);assert.equal(h.store.getSnapshot().summary,null);
 await h.store.toggle();assert.equal(calls,1);h.client.getJson=async()=>summary(true);h.store.retry();await flush();assert.equal(h.store.getSnapshot().summary?.following,true);assert.equal(h.store.getSnapshot().uncertain,false);assert.equal(calls,1);
});
for(const status of [401,403,404,503])test(`Follow failure ${status} masks contextual state with scoped denial`,async t=>{
 const h=fixture(t);h.store.setActive(true);await flush();h.client.getJson=async()=>{throw new ApiError('Unavailable',status);};await h.advance(45_000);
 assert.equal(h.store.getSnapshot().authorized,false);assert.equal(h.store.getSnapshot().summary,null);assert.equal(h.counts().denied,status===503?0:1);
});
test('background/refocus requires fresh proof and self summary never writes',async t=>{
 const h=fixture(t);h.client.getJson=async()=>({...summary(),canFollow:false,disabledReason:'self'});h.store.setActive(true);await flush();await h.store.toggle();assert.equal(h.counts().writes,0);
 h.store.setActive(false);assert.equal(h.store.getSnapshot().summary,null);let finish!:(v:unknown)=>void;h.client.getJson=()=>new Promise(r=>finish=r);h.store.setActive(true);await flush();assert.equal(h.store.getSnapshot().checking,true);assert.equal(h.store.getSnapshot().summary,null);
 h.store.setActive(false);finish(summary());await flush();assert.equal(h.store.getSnapshot().summary,null);
});

test('explicit feed Follow remains a desired true state across repeated or stale taps',async t=>{
 const h=fixture(t);h.store.setActive(true);await flush();await h.store.follow();await h.store.follow();
 assert.equal(h.counts().writes,1);assert.equal(h.store.getSnapshot().summary?.following,true);
 await h.store.toggle();assert.equal(h.store.getSnapshot().summary?.following,false);assert.equal(h.counts().writes,2);
});

test('Global recognition validates exact selected creator/publication and exposes only a boolean',()=>{
 assert.deepEqual(adaptRecognition({publicationId:9,creatorId:7,followingInSpaces:true,spaces:['private']},9,7),{followingInSpaces:true});
 for(const raw of [{publicationId:10,creatorId:7,followingInSpaces:true},{publicationId:9,creatorId:8,followingInSpaces:true},{publicationId:9,creatorId:7,followingInSpaces:1}])assert.throws(()=>adaptRecognition(raw,9,7));
});
