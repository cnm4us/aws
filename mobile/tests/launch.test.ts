import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptLaunchPage, adaptLaunchResolved } from '../src/spaces/launchApi';
import { LaunchStore } from '../src/spaces/launchStore';
import { GlobalLaunchJourney, validateLaunchEntry, validateOriginProduction } from '../src/navigation/globalLaunchJourney';
import { ViewerJourney } from '../src/navigation/viewerJourney';
import { ApiError } from '../src/api/client';
const ulid='01ARZ3NDEKTSV4RRFFQ69G5FAV';
const destination={space:{id:12,name:'Group',type:'group' as const},publicationId:205};
const resolved={sourcePublicationId:100,productionUlid:ulid,...destination};
const page={sourcePublicationId:100,productionUlid:ulid,items:[destination],nextCursor:null};
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
  const item:any={publicationId:205,spaceId:12,productionUlid:ulid};const feed:any={items:[item],nextCursor:null,resume:{requestedPublicationId:205,restoredPublicationId:205,outcome:'restored'}};
  assert.equal(validateLaunchEntry(feed,entry),feed);
  for(const altered of [{...feed,resume:{...feed.resume,outcome:'unavailable',restoredPublicationId:null}},{...feed,items:[{...item,spaceId:13}]},{...feed,items:[{...item,productionUlid:null}]}])assert.throws(()=>validateLaunchEntry(altered,entry),{code:'launch_target_unavailable'});
  const global:any={...feed,items:[{...item,publicationId:100,productionUlid:null}],resume:{requestedPublicationId:100,restoredPublicationId:100,outcome:'restored'}};
  assert.equal(validateOriginProduction(global,origin).resume?.outcome,'unavailable');
});
