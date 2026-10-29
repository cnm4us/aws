import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptViewerFeedPage} from '../src/feed/adaptFeed';
import {stampResponse} from '../src/auth/accessProof';
import {AccessManager} from '../src/auth/accessManager';
import {contextKey,contextName} from '../src/feed/context';
function response(kind='following',source='space'){
 const item={publicationId:1,publishedAt:'2026-10-29T00:00:00Z',uploadId:3,productionUlid:'01ARZ3NDEKTSV4RRFFQ69G5FAV',spaceId:10,creator:{id:2,displayName:'Creator',avatarUrl:null},playbackUrl:'https://media.test/master.m3u8',posterUrl:null,width:720,height:1280,durationSeconds:20,
  sourceContext:source==='space'?{kind:'space',spaceId:10,name:'Group',type:'group'}:{kind:'global'}};
 const identity={viewerId:9,remainingMs:60000};const access={version:1,identity,publicationViews:[]};
 const scope=source==='space'?{...access,spaceView:{spaceId:10,remainingMs:60000},publicationViews:[{publicationId:1,spaceId:10,uploadId:3,productionUlid:item.productionUlid,creatorId:2,remainingMs:60000}]}:{...access,publicView:{remainingMs:60000,publicationIds:[1]}};
 return {context:{kind},items:[item],nextCursor:null,access,aggregateAccess:{version:1,kind,viewerId:9,remainingMs:60000,publicationIds:[1]},sourcePages:[{context:source==='space'?{kind:'space',space:{id:10,name:'Group',type:'group'}}:{kind:'global'},items:[item],nextCursor:null,access:scope}]};
}
for(const source of ['space','global'])test(`aggregate ${source} authority composes source, identity and feed eligibility`,()=>{
 let now=0;const manager=new AccessManager(()=>9,{now:()=>now,wallNow:()=>now});const raw=response('following',source);stampResponse(raw,manager.ticket());const page=adaptViewerFeedPage(raw,{kind:'following'});assert.equal(manager.seedPage(page),true);assert.equal(manager.aggregateValid('following',page.items[0]),true);assert.equal(manager.aggregateValid('creations',page.items[0]),false);
 now=60001;assert.equal(manager.aggregateValid('following',page.items[0]),false);manager.invalidate();
});
test('aggregate pages reject unconfirmed, mismatched and cross-account source claims',()=>{
 const attempts=[(r:any)=>r.sourcePages=[],(r:any)=>r.items[0].sourceContext.spaceId=11,(r:any)=>r.sourcePages[0].access.identity.viewerId=8,(r:any)=>r.aggregateAccess.publicationIds=[2],(r:any)=>r.sourcePages.push(r.sourcePages[0])];
 for(const change of attempts){const raw=response();change(raw);stampResponse(raw,{startedAt:0,wallStartedAt:0,epoch:0});assert.throws(()=>adaptViewerFeedPage(raw,{kind:'following'}));}
 assert.throws(()=>adaptViewerFeedPage(response(),{kind:'following'}));
});
test('aggregate grants are rejected after account epoch changes and local unfollow invalidates matching tuples only',()=>{
 const manager=new AccessManager(()=>9,{now:()=>0,wallNow:()=>0}),raw=response();stampResponse(raw,manager.ticket());const page=adaptViewerFeedPage(raw,{kind:'following'});manager.seedPage(page);manager.invalidateAggregate('following',10,2);assert.equal(manager.aggregateValid('following',page.items[0]),false);manager.seedPage(page);manager.invalidate();assert.equal(manager.seedPage(page),false);
});
test('destination names and keys keep aggregate checkpoints independent from concrete spaces',()=>{
 assert.deepEqual([{kind:'following'},{kind:'creations'},{kind:'global'}].map(c=>contextKey(c as any)),['following','creations','global']);assert.equal(contextName({kind:'creations'}),'Your Creations');assert.notEqual(contextKey({kind:'following'}),contextKey({kind:'space',spaceId:10,name:'Group',type:'group'}));
});
test('short source expiry publishes promptly even when no ordinary space watcher owns the mixed feed',t=>{
 t.mock.timers.enable({apis:['setTimeout']});let now=0;const manager=new AccessManager(()=>9,{now:()=>now,wallNow:()=>now}),raw=response();raw.sourcePages[0].access.publicationViews[0].remainingMs=1000;stampResponse(raw,manager.ticket());const page=adaptViewerFeedPage(raw,{kind:'following'});manager.seedPage(page);const version=manager.getSnapshot();now=1001;t.mock.timers.tick(1001);assert.ok(manager.getSnapshot()>version);assert.equal(manager.aggregateValid('following',page.items[0]),false);manager.invalidate();t.mock.timers.reset();
});
