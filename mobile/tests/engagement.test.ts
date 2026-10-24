import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptEngagement,adaptComments,adaptCreated,type Engagement } from '../src/engagement/api';
import { EngagementStore } from '../src/engagement/engagementStore';
import { CommentsStore } from '../src/engagement/commentsStore';
import { ApiError,type ApiClient } from '../src/api/client';
const ctx={spaceId:2,publicationId:9};
const value:Engagement={...ctx,likes:{count:0,likedByMe:false},comments:{count:0,hasCommentedByMe:false,canComment:true,disabledReason:null}};
const row=(id=1)=>({id,body:'Comment',createdAt:'2026-10-23 12:00:00',author:{id:4,displayName:'Viewer'},isMine:true});
const page=(ids:number[]=[],nextCursor:string|null=null)=>({...ctx,items:ids.map(row),nextCursor,comments:value.comments});
const flush=async()=>{for(let i=0;i<18;i++)await Promise.resolve();};
const api=(overrides:Partial<ApiClient>={}):ApiClient=>({getJson:async path=>path.endsWith('engagement')?value:page(),postJson:async()=>({...ctx,item:row(),comments:{...value.comments,count:1}}),deleteJson:async()=>({...ctx,likes:value.likes}),getText:async()=>'',...overrides});
test('engagement adapters enforce exact context, shape, safe counts and sanitized author fields',()=>{
 assert.throws(()=>adaptEngagement({...value,spaceId:3},ctx));assert.throws(()=>adaptEngagement({...value,likes:{count:-1,likedByMe:false}},ctx));
 assert.throws(()=>adaptComments({...page([1]),items:[{...row(),body:'x'.repeat(2001)}]},ctx));assert.throws(()=>adaptComments(page([1,1]),ctx));
 assert.throws(()=>adaptComments(page([], 'cursor'),ctx));assert.throws(()=>adaptCreated({...ctx,item:row(),comments:{...value.comments,canComment:false}},ctx));
 const clean=adaptCreated({...ctx,item:{...row(),email:'private',author:{...row().author,email:'private'}},comments:value.comments},ctx);
 assert.equal('email' in clean.item,false);assert.equal('email' in clean.item.author,false);
});
test('Like is confirmed, double taps coalesce, and late success cannot update another visit',async()=>{
 let complete!:(v:unknown)=>void,writes=0;
 const store=new EngagementStore(api({postJson:()=>{writes++;return new Promise(r=>complete=r);}}),ctx,()=>{});
 store.setActive(true);await flush();const sending=store.toggle();void store.toggle();assert.equal(writes,1);assert.equal(store.getSnapshot().value!.likes.likedByMe,false);
 store.setActive(false);store.setActive(true);await flush();complete({...ctx,likes:{count:1,likedByMe:true}});await sending;assert.equal(store.getSnapshot().value!.likes.likedByMe,false);store.dispose();
});
test('Like delivery uncertainty withholds stale state until an authoritative refresh',async()=>{
 let denied=0;const store=new EngagementStore(api({postJson:async()=>{throw new ApiError('offline');}}),ctx,()=>denied++);
 store.setActive(true);await flush();await store.toggle();assert.equal(store.getSnapshot().value,null);assert.equal(denied,0);await store.refresh();assert.ok(store.getSnapshot().value);store.dispose();
});
test('comment send is never automatic; uncertain delivery requires read before deliberate resend',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let posts=0;
 const store=new CommentsStore(api({postJson:async()=>{posts++;if(posts===1)throw new ApiError('timeout');return {...ctx,item:row(),comments:{...value.comments,count:1}};}}),ctx,async()=>{},()=>{},()=>0);
 t.after(()=>{store.dispose();t.mock.timers.reset();});store.setActive(true);await flush();store.setDraft('hello');await store.send();assert.equal(store.getSnapshot().uncertain,true);assert.equal(store.getSnapshot().draft,'hello');
 await store.send();assert.equal(posts,1);await store.reload();assert.equal(posts,1);assert.equal(store.getSnapshot().reconciled,true);await store.send();assert.equal(posts,2);assert.equal(store.getSnapshot().draft,'');assert.equal(store.getSnapshot().posted!.id,1);
});
test('disabled posting preserves readable comments; a specific post403 does not revoke viewing',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let denied=0;
 const store=new CommentsStore(api({getJson:async path=>path.endsWith('engagement')?value:page([1]),postJson:async()=>{throw new ApiError('disabled',403,'comments_disabled');}}),ctx,async()=>{},()=>denied++,()=>0);
 t.after(()=>{store.dispose();t.mock.timers.reset();});store.setActive(true);await flush();store.setDraft('hello');await store.send();assert.equal(store.getSnapshot().authorized,true);assert.equal(store.getSnapshot().items.length,1);assert.equal(store.getSnapshot().summary!.canComment,false);assert.equal(denied,0);
});
test('comments quiet renewal retains draft/pages, hard expiry aborts a late write and clears protected data',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let now=0,checks=0;let renew!:(value:unknown)=>void,write!:(value:unknown)=>void,writeSignal!:AbortSignal;
 const store=new CommentsStore(api({getJson:async path=>{if(path.endsWith('engagement')){checks++;return checks===1?value:new Promise(r=>renew=r);}return page([1]);},postJson:(_p,_b,s)=>{writeSignal=s!;return new Promise(r=>write=r);}}),ctx,async()=>{},()=>{},()=>now);
 t.after(()=>{store.dispose();t.mock.timers.reset();});store.setActive(true);await flush();store.setDraft('draft');now=45_000;t.mock.timers.tick(45_000);await flush();assert.equal(store.getSnapshot().draft,'draft');assert.equal(store.getSnapshot().items.length,1);
 const sending=store.send();now=60_000;t.mock.timers.tick(15_000);assert.equal(store.getSnapshot().authorized,false);assert.equal(store.getSnapshot().draft,'');assert.equal(store.getSnapshot().items.length,0);assert.equal(writeSignal.aborted,true);
 write({...ctx,item:row(),comments:value.comments});renew(value);await sending;await flush();assert.equal(store.getSnapshot().authorized,false);assert.equal(store.getSnapshot().posted,null);
});
test('comments foreground and denied access require a new verification and ignore old pages',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let complete!:(value:unknown)=>void,calls=0,deny=false,denied=0;
 const store=new CommentsStore(api({getJson:async path=>{if(path.endsWith('engagement')){if(deny)throw new ApiError('denied',403,'forbidden');return value;}calls++;if(calls===1)return new Promise(r=>complete=r);return page([2]);}}),ctx,async()=>{},()=>denied++,()=>0);
 t.after(()=>{store.dispose();t.mock.timers.reset();});store.setActive(true);await flush();store.setDraft('draft');store.setActive(false);store.setActive(true);await flush();complete(page([1]));await flush();assert.deepEqual(store.getSnapshot().items.map(c=>c.id),[2]);assert.equal(store.getSnapshot().draft,'');
 deny=true;store.retry();await flush();assert.equal(store.getSnapshot().authorized,false);assert.equal(denied,1);assert.equal(store.getSnapshot().items.length,0);
});
test('paging deduplicates rows, refuses looping cursors and sorts without transporting drafts',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let calls=0;
 const store=new CommentsStore(api({getJson:async path=>path.endsWith('engagement')?value:++calls===1?page([1], 'next'):page([1,2],'next')}),ctx,async()=>{},()=>{},()=>0);
 t.after(()=>{store.dispose();t.mock.timers.reset();});store.setActive(true);await flush();await store.more();assert.match(store.getSnapshot().error!,/Refresh/);assert.deepEqual(store.getSnapshot().items.map(c=>c.id),[1]);
 store.setDraft('draft');store.sort('oldest');await flush();assert.equal(store.getSnapshot().order,'oldest');assert.equal(store.getSnapshot().draft,'draft');store.setActive(false);assert.equal(store.getSnapshot().draft,'');
});
