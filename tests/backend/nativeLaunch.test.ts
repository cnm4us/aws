import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewerLaunchService, parseLaunchQuery } from '../../src/features/publications/viewerLaunch';
const ulid='01ARZ3NDEKTSV4RRFFQ69G5FAV';
function fixture(count=4) {
  const candidates=Array.from({length:count},(_,i)=>({publicationId:i===0?100:200+i,productionId:7,
    space:{id:i+1,type:i%2?'channel':'group',owner_user_id:null,name:`Space ${i+1}`,slug:`space-${i+1}`,settings:{}}}));
  const hidden=new Set<number>(),ineligible=new Set<number>();let global=true,productionId:number|null=7,calls=0;
  const deps:any={now:()=>0,global:async()=>global?[{publication_id:100,production_id:productionId,production_ulid:ulid}]:[],
    candidates:async(prod:number,after:number,limit:number,id?:number)=>{calls++;return candidates.filter(c=>c.productionId===prod && c.space.id>after && (id===undefined || c.space.id===id)).slice(0,limit);},
    canView:async(s:any,user:number)=>user===9 && !hidden.has(s.id),
    space:async(id:number,s:any)=>{const c=candidates.find(c=>c.space.id===id && c.publicationId===s.publicationId);return c && !ineligible.has(id)?[{publication_id:c.publicationId,space_id:id,production_id:c.productionId}]:[];}};
  return {deps,candidates,hidden,ineligible,service:createViewerLaunchService(deps),revokeSource:()=>{global=false;},noProduction:()=>{productionId=null;},calls:()=>calls};
}
test('same-production destination uses exact eligible publication, including source space and same-ID contexts',async()=>{
  const f=fixture();f.hidden.add(2);f.ineligible.add(3);
  const list=await f.service.list(100,9,{});
  assert.deepEqual(list.items.map(x=>x.space.id),[1,4]);
  const entry=await f.service.resolve(100,1,9);assert.equal(entry.publicationId,100);
  assert.deepEqual(Object.keys(entry).sort(),['sourcePublicationId','productionUlid','space','publicationId'].sort());
  assert.deepEqual(Object.keys(entry.space).sort(),['id','name','type']);
  await assert.rejects(f.service.resolve(100,2,9),{status:404,code:'launch_target_unavailable'});
  await assert.rejects(f.service.resolve(100,3,9),{code:'launch_target_unavailable'});
  await assert.rejects(f.service.resolve(100,99,9),{code:'launch_target_unavailable'});
});
test('personal and all Global representations are excluded without excluding ordinary source room',async()=>{
  const f=fixture(6);f.candidates[1].space.type='personal';f.candidates[2].space.slug='global-feed';
  f.candidates[3].space.settings={global:true} as any;f.candidates[4].space.settings={feed:'global'} as any;
  assert.deepEqual((await f.service.list(100,9,{})).items.map(x=>x.space.id),[1,6]);
  await assert.rejects(f.service.resolve(100,2,9),{code:'launch_target_unavailable'});
});
test('filtered candidate batches cannot create false empty pages; cursor exposes only last returned allowed ID',async()=>{
  const f=fixture(130);for(let i=1;i<=105;i++)f.hidden.add(i);
  const page=await f.service.list(100,9,{limit:'2'});assert.deepEqual(page.items.map(x=>x.space.id),[106,107]);assert.ok(f.calls()>=3);
  const cursor=JSON.parse(Buffer.from(page.nextCursor!,'base64url').toString());assert.equal(cursor.after,107);
  const next=await f.service.list(100,9,{limit:'2',cursor:page.nextCursor});assert.deepEqual(next.items.map(x=>x.space.id),[108,109]);
  await assert.rejects(f.service.list(101,9,{cursor:page.nextCursor}),{code:'invalid_query'});
  await assert.rejects(f.service.list(100,10,{cursor:page.nextCursor}),{code:'invalid_query'});
  const last=await f.service.list(100,9,{limit:'50'});assert.equal(last.items.length,25);assert.equal(last.nextCursor,null);
});
test('missing source/mapping never guesses from an upload; DB failure never pretends empty',async()=>{
  const f=fixture();f.noProduction();assert.deepEqual((await f.service.list(100,9,{})).items,[]);assert.equal(f.calls(),0);
  await assert.rejects(f.service.resolve(100,1,9),{code:'launch_target_unavailable'});
  f.revokeSource();await assert.rejects(f.service.list(100,9,{}),{code:'publication_not_found'});
  const broken=fixture();broken.deps.canView=async()=>{throw Error('database failure');};await assert.rejects(broken.service.list(100,9,{}));
});
test('resolve and list recheck source and selected authority; wrong-production rows fail closed',async()=>{
  const f=fixture();f.deps.canView=async()=>{f.revokeSource();return true;};await assert.rejects(f.service.resolve(100,1,9),{code:'publication_not_found'});
  const g=fixture();let checks=0;g.deps.canView=async()=>++checks===1;await assert.rejects(g.service.resolve(100,1,9),{code:'launch_target_unavailable'});
  const h=fixture();h.deps.space=async()=>[{publication_id:100,space_id:1,production_id:99}];assert.equal((await h.service.list(100,9,{})).items.length,0);
});
test('query grammar, bounds, cancellation and scan budget are explicit failures',async()=>{
  for(const q of [{limit:'0'},{limit:'51'},{limit:['2']},{limit:'2e1'},{cursor:'bad token'},{cursor:'e30'},{unexpected:'x'}])assert.throws(()=>parseLaunchQuery(q,100,9),{code:'invalid_query'});
  const f=fixture(),c=new AbortController();c.abort();await assert.rejects(f.service.list(100,9,{},c.signal),{code:'service_unavailable'});
  const wide=fixture(5001);wide.deps.canView=async()=>false;await assert.rejects(wide.service.list(100,9,{}),{code:'service_unavailable'});
});
