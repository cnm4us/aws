import test from 'node:test';
import assert from 'node:assert/strict';
import {GlobalFeedMemory} from '../src/feed/globalFeedMemory';
import {AccessManager} from '../src/auth/accessManager';
import type {FeedVideoItem} from '../src/feed/types';
test('origin memory keeps at most20 public rows and cannot restore expired or unconfirmed content',()=>{
 let now=0;const access=new AccessManager(()=>1,{now:()=>now,wallNow:()=>now}),memory=new GlobalFeedMemory();
 const items=Array.from({length:40},(_,n)=>({publicationId:n+1,spaceId:90,uploadId:1,productionUlid:null,creator:{id:2},playbackUrl:`https://example.invalid/${n}`} as FeedVideoItem));
 access.seedPage({items,nextCursor:null,access:{epoch:access.epoch(),startedAt:0,wallStartedAt:0,publications:[],publicUntil:60000,publicIds:items.map(i=>i.publicationId)}});
 memory.save(items,20,'cursor',access);const restored=memory.take(21,access)!;
 assert.equal(restored.items.length,20);assert.equal(restored.resume?.restoredPublicationId,21);assert.equal(memory.take(1,access),undefined);
 now=60000;assert.equal(memory.take(21,access),undefined);
 memory.save(items,0,null,access);assert.equal(memory.take(1,access),undefined);access.dispose();
});
