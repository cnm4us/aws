import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptViewerFeedPage } from '../src/feed/adaptFeed';
import { fetchViewerFeed } from '../src/api/feed';
import { adaptMySpaces } from '../src/spaces/api';
import { FeedStore } from '../src/feed/feedStore';
import { ApiError } from '../src/api/client';

const context={kind:'space' as const,spaceId:4,name:'Group',type:'group' as const};
const item={publicationId:6,spaceId:4,uploadId:2,productionUlid:null,playbackUrl:'https://media.example/video.m3u8',posterUrl:null,
  creator:{id:1,displayName:null,email:'private'},description:'Video',width:100,height:200,durationSeconds:5};
const page={context:{kind:'space',space:{id:4}},items:[item],nextCursor:null};
test('viewer feed keeps publication identity, minimizes fields and rejects a mismatched context',()=>{
  const p=adaptViewerFeedPage(page,context);assert.equal(p.items[0].publicationId,6);assert.equal(p.items[0].uploadId,2);assert.equal(p.items[0].creator.displayName,'Creator');assert.equal(JSON.stringify(p).includes('private'),false);
  assert.throws(()=>adaptViewerFeedPage(page,{...context,spaceId:5}));
  assert.throws(()=>adaptViewerFeedPage({...page,items:[{...item,spaceId:5}]},context));
  assert.throws(()=>adaptViewerFeedPage(page,{kind:'global'}));
});
test('context loader uses the aggregator for Global, separate space feed, and encoded cursors',async()=>{
  const paths:string[]=[];const client={getJson:async(path:string)=>{paths.push(path);return path.includes('/feed/global')?{context:{kind:'global'},items:[],nextCursor:null}:page;}};
  await fetchViewerFeed(client,{kind:'global'});await fetchViewerFeed(client,context,undefined,'timestamp|2');
  assert.equal(paths[0],'/api/viewer/v1/feed/global?limit=20');assert.match(paths[1],/^\/api\/viewer\/v1\/spaces\/4\/feed\?limit=20&cursor=timestamp%7C2$/);
});
test('space list validates data and drops unexpected private fields',()=>{
  const space={id:4,ulid:null,name:'Group',slug:'group',type:'group',relationship:'member',subscribed:false,email:'private'};
  const data=adaptMySpaces({personal:null,groups:[space],channels:[]});assert.equal(JSON.stringify(data).includes('private'),false);
  assert.throws(()=>adaptMySpaces({personal:null,groups:[{...space,id:-1}],channels:[]}));
  assert.throws(()=>adaptMySpaces({personal:null,groups:null,channels:[]}));
});
test('denial during pagination removes previously loaded media and does not retain a cursor',async()=>{
  let failed=false;let status:number|undefined;
  const store=new FeedStore(async cursor=>{if(cursor)throw new ApiError('Denied',403);return {...adaptViewerFeedPage(page,context),nextCursor:'cursor'};},error=>{failed=true;status=(error as ApiError).status;});
  await store.refresh();assert.equal(store.getSnapshot().items.length,1);await store.loadMore();
  assert.equal(failed,true);assert.equal(status,403);assert.equal(store.getSnapshot().items.length,0);assert.equal(store.getSnapshot().nextCursor,null);assert.equal(store.getSnapshot().errorStatus,403);
});
test('cancelled old context response cannot append into a new store with the same publication ID',async()=>{
  let resolve!:(v:any)=>void;const old=new FeedStore(()=>new Promise(r=>resolve=r));const pending=old.refresh();old.cancel();
  const current=new FeedStore(async()=>adaptViewerFeedPage({...page,items:[{...item,description:'New context'}]},context));await current.refresh();
  resolve(adaptViewerFeedPage(page,context));await pending;
  assert.equal(old.getSnapshot().items.length,0);assert.equal(current.getSnapshot().items[0].description,'New context');
});
test('transient pagination failures preserve the valid feed and permit retry',async()=>{
  const store=new FeedStore(async cursor=>{if(cursor)throw new ApiError('offline');return {...adaptViewerFeedPage(page,context),nextCursor:'next'};});
  await store.refresh();await store.loadMore();assert.equal(store.getSnapshot().items.length,1);assert.equal(store.getSnapshot().errorStatus,null);assert.equal(store.getSnapshot().nextCursor,'next');
});
