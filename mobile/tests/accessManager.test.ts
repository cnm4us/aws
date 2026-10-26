import test from 'node:test';
import assert from 'node:assert/strict';
import { AccessManager } from '../src/auth/accessManager';
import { adaptAccess,stampResponse,itemKey } from '../src/auth/accessProof';
import { ApiError } from '../src/api/client';
import type { FeedVideoItem,FeedPage } from '../src/feed/types';
const item={publicationId:11,spaceId:7,uploadId:2,productionUlid:null,playbackUrl:'https://example.invalid/v.m3u8',creator:{id:3,displayName:'C',avatarUrl:null}} as FeedVideoItem;
const flush=async()=>{for(let n=0;n<10;n++)await Promise.resolve();};
function harness(){let now=0,wall=1000,viewer=9;const denied:ApiError[]=[];
 const manager=new AccessManager(()=>viewer,{now:()=>now,wallNow:()=>wall,onDenied:e=>denied.push(e)});
 const page=(ms=60000,items=[item],captured=manager.ticket()):FeedPage=>{
  const raw={items,access:{version:1,identity:{viewerId:viewer,remainingMs:ms},spaceView:{spaceId:7,remainingMs:ms},
   publicationViews:items.map(i=>({publicationId:i.publicationId,spaceId:7,uploadId:i.uploadId,productionUlid:i.productionUlid,creatorId:i.creator.id,remainingMs:ms}))}};
  stampResponse(raw,captured);return {items,nextCursor:null,access:adaptAccess(raw,items,{kind:'space',spaceId:7,name:'G',type:'group'})};
 };
 return {manager,page,denied,advance:(at:number)=>{wall+=at-now;now=at;},wall:(at:number)=>{wall=at;},viewer:(id:number)=>{viewer=id;}};
}
test('screen return reuses original confirmation without extending the hard deadline',()=>{
 const h=harness();h.manager.seedPage(h.page());h.advance(45000);assert(h.manager.canView(item));
 const release=h.manager.watch(7,[item],async()=>h.page());release();h.advance(59999);assert(h.manager.canView(item));
 h.advance(60000);assert.equal(h.manager.canView(item),false);h.manager.dispose();
});
test('quiet renewal at45s retains view through transient errors but not60s',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const h=harness();h.manager.seedPage(h.page());let calls=0;
 const release=h.manager.watch(7,[item],async()=>{calls++;throw new ApiError('offline');});
 h.advance(45000);t.mock.timers.tick(45000);await flush();assert.equal(calls,1);assert(h.manager.canView(item));
 h.advance(50000);t.mock.timers.tick(5000);await flush();assert.equal(calls,2);
 h.advance(60000);t.mock.timers.tick(10000);await flush();assert.equal(h.manager.canView(item),false);
 release();h.manager.dispose();
});
test('short policy deadline, elapsed wall time and delayed callback cannot extend authority',()=>{
 const h=harness();h.manager.seedPage(h.page(10000));h.advance(9999);assert(h.manager.canView(item));
 h.wall(11000);assert.equal(h.manager.canView(item),false);h.manager.dispose();
});
test('shared requests coalesce and releasing one observer keeps the other request',async()=>{
 const h=harness();let resolve!:(p:FeedPage)=>void,calls=0;
 const load=()=>{calls++;return new Promise<FeedPage>(r=>resolve=r);};
 const a=h.manager.watch(7,[item],load),b=h.manager.watch(7,[item],load);await flush();a();assert.equal(calls,1);
 resolve(h.page());await flush();assert(h.manager.canView(item));b();h.manager.dispose();
});
test('denial invalidates its space immediately and an old response cannot resurrect it',async()=>{
 const h=harness();h.manager.seedPage(h.page());const old=h.page();
 const release=h.manager.watch(7,[item],async()=>{throw new ApiError('denied',403);});
 await h.manager.check(7);assert.equal(h.manager.canView(item),false);assert.equal(h.denied.length,1);assert.equal(h.manager.seedPage(old),false);
 release();h.manager.dispose();
});
test('identity replacement, malformed proof, altered media and aged body are rejected',()=>{
 const h=harness(),page=h.page();h.viewer(8);assert.equal(h.manager.seedPage(page),false);h.viewer(9);h.manager.seedPage(page);
 assert.equal(h.manager.canView({...item,playbackUrl:'https://example.invalid/replaced.m3u8'}),false);
 const raw={access:{version:1,identity:{viewerId:9,remainingMs:60001},publicationViews:[]}};stampResponse(raw,h.manager.ticket());assert.throws(()=>adaptAccess(raw));
 h.advance(60000);assert.equal(h.manager.canView(item),false);h.manager.clear();assert.equal(h.manager.seedPage(page),false);h.manager.dispose();
});
test('missing neighbor does not revoke the selected video and identity-only proof cannot renew publication',async()=>{
 const h=harness(),neighbor={...item,publicationId:12};h.manager.seedPage(h.page(60000,[item,neighbor]));
 const release=h.manager.watch(7,[item,neighbor],async()=>h.page(60000,[item]));await h.manager.check(7);assert(h.manager.canView(item));assert.equal(h.manager.canView(neighbor),false);
 h.advance(60000);const p=h.page().access!;p.publications=[];h.manager.seed(p);assert(h.manager.identityValid());assert.equal(h.manager.canView(item),false);
 release();h.manager.dispose();
});

test('a newer checked media identity invalidates the old tuple and late older proof cannot regrant it',()=>{
 const h=harness(),old=h.page();h.manager.seedPage(old);h.advance(1000);
 const changed={...item,playbackUrl:'https://example.invalid/new.m3u8'};h.manager.seedPage(h.page(60000,[changed]));
 assert.equal(h.manager.canView(item),false);assert.equal(h.manager.canView(changed),true);
 h.manager.seedPage(old);assert.equal(h.manager.canView(item),false);assert.equal(h.manager.canView(changed),true);h.manager.dispose();
});
