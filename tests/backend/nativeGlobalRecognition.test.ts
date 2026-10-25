import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { createGlobalRecognition,createGlobalRecognitionRouter } from '../../src/features/follows/globalRecognition';
import { ViewerApiError,readBearer } from '../../src/features/native-sessions/service';

function fixture(){
 let visible=true,creator=7,deleted=false,follows=true,reads=0;
 const deps={select:async(q:any)=>{assert.equal(q.publicationId,9);assert.equal(q.userId,4);return visible?[{publication_id:9,owner_id:creator,owner_user_id:8}]:[];},
  creators:async(ids:number[])=>new Map(deleted?[]:ids.map(id=>[id,{id}])),
  followingInSpaces:async(c:number,u:number)=>{assert.equal(c,7);assert.equal(u,4);reads++;return follows;}};
 return {deps,recognition:createGlobalRecognition(deps as any),hide:()=>visible=false,retarget:()=>creator=8,deleted:()=>deleted=true,none:()=>follows=false,reads:()=>reads};
}
test('Global recognition is a minimal caller-owned read for the exact upload creator, rechecked before reply',async()=>{
 const f=fixture();assert.deepEqual(await f.recognition(9,4),{publicationId:9,creatorId:7,followingInSpaces:true});f.none();assert.equal((await f.recognition(9,4)).followingInSpaces,false);
 for(const change of ['hide','deleted'] as const){const h=fixture();h[change]();await assert.rejects(h.recognition(9,4),{status:404});assert.equal(h.reads(),0);}
 for(const change of ['hide','deleted','retarget'] as const){const h=fixture();h.deps.followingInSpaces=async()=>{h[change]();return true;};await assert.rejects(h.recognition(9,4),{status:404});}
 const self=createGlobalRecognition({select:async()=>[{publication_id:9,owner_id:4}],creators:async()=>new Map([[4,{id:4}]]),followingInSpaces:async()=>{throw Error('self must not read relationship');}} as any);
 assert.equal((await self(9,4)).followingInSpaces,false);
});
test('Global recognition route requires authentication/exact proof, never writes and sanitizes errors',async()=>{
 const f=fixture(),app=express();app.use(express.json());
 const deps={recognition:f.recognition,resolveViewer:async(req:any)=>{if(!readBearer(req,false))throw new ViewerApiError(401,'unauthorized');return {viewer:{id:4}};}};
 app.use('/api/viewer/v1',createGlobalRecognitionRouter(deps as any));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as any).port}/api/viewer/v1/feed/global/publications/9/creator-recognition`;
 const headers={authorization:'Bearer nv1_'+'a'.repeat(64)};
 try{
  const anon=await fetch(base);assert.equal(anon.status,401);assert.equal(anon.headers.get('cache-control'),'no-store');
  const r=await fetch(base,{headers});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.deepEqual(Object.keys(await r.json() as Record<string,unknown>).sort(),['publicationId','creatorId','followingInSpaces'].sort());
  for(const q of ['?creatorId=7','?spaceId=2'])assert.equal((await fetch(base+q,{headers})).status,400);
  assert.equal((await fetch(base.replace('/9/','/09/'),{headers})).status,400);
  for(const method of ['POST','DELETE'])assert.equal((await fetch(base,{headers,method})).status,404);
  deps.recognition=async()=>{throw Error('private SQL details');};const bad=await fetch(base,{headers});assert.equal(bad.status,503);assert.deepEqual(await bad.json(),{error:'service_unavailable'});
 }finally{server.close();server.closeAllConnections();}
});
