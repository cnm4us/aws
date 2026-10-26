import assert from 'node:assert/strict';
import test from 'node:test';
import {FeedCheckpoints,type SavedFeedCheckpoint} from '../src/navigation/feedCheckpoints';
import {validateOriginProduction} from '../src/navigation/globalLaunchJourney';
import type {FeedPage,FeedVideoItem} from '../src/feed/types';
const global={kind:'global'} as const;
const saved=(spaceId?:number):SavedFeedCheckpoint=>({apiOrigin:'https://api.test',authGeneration:2,journeyGeneration:1,context:spaceId?{kind:'space',spaceId,name:'Group',type:'group'}:global,publicationId:10,positionSeconds:7,userPaused:true,uploadId:1,productionUlid:'production',creatorId:3});
test('checkpoint collection is scalar-only, bounded LRU, and API/account generation scoped',()=>{
 const c=new FeedCheckpoints('https://api.test',2,2);c.save({...saved(),...{player:{},playbackUrl:'private'}});c.save(saved(1));
 assert.deepEqual(c.take(global),saved());c.save(saved(2));assert.equal(c.take(saved(1).context),undefined);assert.ok(c.take(global));
 c.save({...saved(),authGeneration:3});c.save({...saved(),apiOrigin:'https://other.test'});assert.equal(c.take(global)?.authGeneration,2);
 c.clear(global);assert.equal(c.take(global),undefined);
});
test('saved menu sources reject retargeted upload/production/creator without weakening exact Launch validation',()=>{
 const item={publicationId:10,uploadId:1,productionUlid:'production',creator:{id:3}} as FeedVideoItem;
 const page:FeedPage={items:[item],nextCursor:null,resume:{requestedPublicationId:10,restoredPublicationId:10,outcome:'restored'}};
 assert.equal(validateOriginProduction(page,saved()).resume?.outcome,'restored');
 for(const replacement of [{uploadId:2},{productionUlid:'other'},{creator:{id:4}}]){
  const changed={...page,items:[{...item,...replacement} as FeedVideoItem]};assert.equal(validateOriginProduction(changed,saved()).resume?.outcome,'unavailable');
 }
});
