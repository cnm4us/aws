import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptLaunchPage, adaptLaunchResolved } from '../src/spaces/launchApi';
import { LaunchStore } from '../src/spaces/launchStore';
import { GlobalLaunchJourney, validateLaunchEntry, validateOriginProduction } from '../src/navigation/globalLaunchJourney';
import { ViewerJourney } from '../src/navigation/viewerJourney';
import { ApiError } from '../src/api/client';
const ulid='01ARZ3NDEKTSV4RRFFQ69G5FAV';
const creator={id:2,displayName:'Creator',avatarUrl:null,bio:'Public bio'};
const destination={space:{id:12,name:'Group',type:'group' as const,description:'A thoughtful community'},publicationId:205};
const resolved={sourcePublicationId:100,productionUlid:ulid,creator,...destination};
const page={sourcePublicationId:100,productionUlid:ulid,creator,items:[destination],nextCursor:null};
const origin={apiOrigin:'https://api.test',authGeneration:1,journeyGeneration:1,context:{kind:'global' as const},publicationId:100,positionSeconds:8,userPaused:true,productionUlid:ulid};
test('launch adapters minimize fields, enforce source/target/context identities and reject changed production',()=>{
  assert.equal(JSON.stringify(adaptLaunchPage({...page,secret:'private',items:[{...destination,space:{...destination.space,email:'private'}}]},100,ulid)).includes('private'),false);
  for(const value of [{...page,sourcePublicationId:1},{...page,items:[{...destination,space:{...destination.space,type:'personal'}}]},{...page,items:[destination,destination]},{...page,items:[],nextCursor:'abc'}])assert.throws(()=>adaptLaunchPage(value,100,ulid));
  assert.throws(()=>adaptLaunchResolved(resolved,100,ulid,13));
  assert.throws(()=>adaptLaunchPage({...page,productionUlid:null},100,ulid),{code:'publication_not_found'});
});
test('store resolves afresh on selection, serializes taps and ignores a cancelled late response',async()=>{
  let finish!:(v:any)=>void;const paths:string[]=[];
  const store=new LaunchStore({getJson:async path=>{paths.push(path);return path.includes('?')?page:new Promise(r=>finish=r);}},100,ulid);
  await store.refresh();const pending=store.enter(12);assert.equal(await store.enter(12),null);assert.equal(store.getSnapshot().entering,true);
  store.cancel();finish(resolved);assert.equal(await pending,null);assert.equal(store.getSnapshot().entering,false);
  assert.match(paths[1],/\/publications\/100\/spaces\/12$/);
});
test('source expiry clears destinations, signals account invalidation only for401, paging detects loops',async()=>{
  let sourceMissing=0,unauthorized=0;const store=new LaunchStore({getJson:async path=>{if(path.includes('?'))return page;throw new ApiError('Source removed',404,'publication_not_found');}},100,ulid,()=>unauthorized++,()=>sourceMissing++);
  await store.refresh();assert.equal(await store.enter(12),null);assert.equal(sourceMissing,1);assert.equal(store.getSnapshot().items.length,0);assert.equal(unauthorized,0);
  const expired=new LaunchStore({getJson:async()=>{throw new ApiError('Expired',401);}},100,ulid,()=>unauthorized++);await expired.refresh();assert.equal(unauthorized,1);
  const loop=new LaunchStore({getJson:async()=>({...page,nextCursor:'abc'})},100,ulid);await loop.refresh();await loop.more();assert.match(loop.getSnapshot().error!,/advance/);
});
test('bounded outer/inner journeys preserve distinct roots and reject obsolete or cross-principal actions',()=>{
  const launch=new GlobalLaunchJourney(),generation=launch.open(origin);const entered=launch.enter(resolved,generation)!;
  assert.equal(entered.entry.positionSeconds,8);assert.equal(entered.entry.userPaused,true);
  const creator=new ViewerJourney();creator.open(2,{...origin,context:entered.context,publicationId:205,positionSeconds:12});assert.ok(creator.enter(2,creator.getSnapshot().generation));
  assert.equal(creator.originFor(origin.apiOrigin,1)?.publicationId,205);assert.equal(launch.originFor(origin.apiOrigin,1)?.publicationId,100);assert.equal(launch.originFor(origin.apiOrigin,2),null);
  creator.reset();assert.equal(launch.getSnapshot().origin?.publicationId,100);
  launch.reset();assert.equal(launch.enter(resolved,generation),null);
  const legacy=launch.open({...origin,productionUlid:null});assert.equal(launch.enter(resolved,legacy)?.entry.positionSeconds,0);
});
test('strict entry never accepts fallback or wrong-space/production item; tolerant origin return cannot seek a changed production',()=>{
  const launch=new GlobalLaunchJourney(),g=launch.open(origin),entry=launch.enter(resolved,g)!.entry;
  const item:any={creator:{id:2},publicationId:205,spaceId:12,productionUlid:ulid};const feed:any={items:[item],nextCursor:null,resume:{requestedPublicationId:205,restoredPublicationId:205,outcome:'restored'}};
  assert.equal(validateLaunchEntry(feed,entry),feed);
  for(const altered of [{...feed,resume:{...feed.resume,outcome:'unavailable',restoredPublicationId:null}},{...feed,items:[{...item,spaceId:13}]},{...feed,items:[{...item,productionUlid:null}]}])assert.throws(()=>validateLaunchEntry(altered,entry),{code:'launch_target_unavailable'});
  const global:any={...feed,items:[{...item,publicationId:100,productionUlid:null}],resume:{requestedPublicationId:100,restoredPublicationId:100,outcome:'restored'}};
  assert.equal(validateOriginProduction(global,origin).resume?.outcome,'unavailable');
});

test('Launch introduction validates public identity, safe avatar and bounded authored descriptions',()=>{
 const value={...page,creator:{...creator,avatarUrl:'http://unsafe.test/a',privateRule:'secret'},items:[{...destination,space:{...destination.space,privateSetting:'secret'}}]};
 const dto=adaptLaunchPage(value,100,ulid,2);assert.equal(dto.creator.avatarUrl,null);assert.equal(JSON.stringify(dto).includes('secret'),false);
 assert.equal(dto.items[0].space.description,'A thoughtful community');
 for(const changed of [{...page,creator:{...creator,bio:3}},{...page,creator:{...creator,id:0}},{...page,items:[{...destination,space:{...destination.space,description:'x'.repeat(501)}}]}])assert.throws(()=>adaptLaunchPage(changed,100,ulid,2));
 assert.throws(()=>adaptLaunchPage({...page,creator:{...creator,id:3}},100,ulid,2),{code:'publication_not_found'});
 assert.throws(()=>adaptLaunchResolved({...resolved,creator:{...creator,id:3}},100,ulid,12,2),{code:'publication_not_found'});
});
test('source creator mismatch in a fresh destination resolve masks old chooser data',async()=>{
 let missing=0;const store=new LaunchStore({getJson:async path=>path.includes('?')?page:{...resolved,creator:{...creator,id:3}}},100,ulid,()=>{},()=>missing++,2);
 await store.refresh();assert.equal(store.getSnapshot().creator?.id,2);assert.equal(await store.enter(12),null);assert.equal(missing,1);assert.equal(store.getSnapshot().creator,null);assert.deepEqual(store.getSnapshot().items,[]);
});

test('combined entry preparation is bounded, coalesces the tapped request and cannot enter after close',async()=>{
 const destinations=[12,13,14].map(id=>({...destination,space:{...destination.space,id},publicationId:205+id-12}));
 const gates=new Map<number,{resolve:(v:unknown)=>void;signal?:AbortSignal}>(),paths:string[]=[];
 const client={getJson:async(path:string,signal?:AbortSignal)=>{
  paths.push(path);if(!path.includes('include=entry'))return {...page,items:destinations};
  const id=Number(/spaces\/(\d+)/.exec(path)![1]);return new Promise(r=>gates.set(id,{resolve:r,signal}));
 }};
 const entry=(id:number)=>{const pub=205+id-12;return {...resolved,space:{...destination.space,id},publicationId:pub,entry:{context:{kind:'space',space:{id}},
  items:[{publicationId:pub,spaceId:id,uploadId:1,productionUlid:ulid,playbackUrl:'https://media.test/shared',creator:{id:2,displayName:'Creator',avatarUrl:null}}],nextCursor:null,
  resume:{requestedPublicationId:pub,restoredPublicationId:pub,outcome:'restored'}}};};
 const store=new LaunchStore(client,100,ulid,()=>{},undefined,2,()=>true);await store.refresh();store.prepareEntries([12,13,14]);
 assert.equal(gates.size,2);const pending=store.enter(12);assert.equal(paths.filter(p=>p.includes('/12?')).length,1);
 gates.get(12)!.resolve(entry(12));assert.equal((await pending)?.entry?.items[0].publicationId,205);
 await store.enter(12);assert.equal(paths.filter(p=>p.includes('/12?')).length,1);
 const next=store.enter(14);assert.equal(gates.get(13)!.signal?.aborted,false); // Oldest completed entry is evicted first.
 store.cancel();gates.get(14)!.resolve(entry(14));assert.equal(await next,null);store.clear();
});
