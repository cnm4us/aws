import assert from 'node:assert/strict';
import {FeedSessions,orderCandidates,type Candidate} from '../src/features/aggregate-feeds/model';
import {aggregatePage} from '../src/features/aggregate-feeds/service';
const now=Date.parse('2026-10-29T12:00:00Z');let checks=0;
const eq=(a:unknown,b:unknown)=>{assert.deepEqual(a,b);checks++;};
const row=(id:number,creatorId:number,spaceId=10,production=`p${id}`,personal=false):Candidate=>({id,creatorId,spaceId,production,personal,publishedAt:new Date(now-id*1000).toISOString()});
async function main(){
 eq(orderCandidates([row(1,1),row(2,1),row(3,2),row(4,1)],'following',now).map(r=>r.id),[1,3,2,4]);
 eq(orderCandidates([row(1,1,10,'shared'),row(2,1,11,'shared',true)],'creations',now).map(r=>r.id),[2]);
 eq(orderCandidates([row(1,1),{...row(3,2),publishedAt:new Date(now-2*86400000).toISOString()}],'following',now).map(r=>r.id),[1,3]);
 let clock=now;const cache=new FeedSessions(()=>clock);const token=cache.create(1,'following');assert.throws(()=>cache.get(token,2,'following'));assert.throws(()=>cache.get(token,1,'creations'));clock+=86400000;assert.throws(()=>cache.get(token,1,'following'));checks+=3;
 let data=[row(1,2,10,'shared'),row(2,2,11,'shared'),row(3,3),row(4,2)],denied=new Set<number>(),reviews=new Set<number>();
 const principal={viewer:{id:1,displayName:'Fixture'},source:'native' as const,expiresAt:'2030-01-01'};
 const deps={sessions:new FeedSessions(()=>now),candidates:async(_user:number,_kind:any,after?:any,exact?:number|number[])=>data.filter(r=>exact?(Array.isArray(exact)?exact.includes(r.id):r.id===exact):!after||r.id>after.id).slice(0,500),
  source:async(spaceId:number,_p:any,_at:number,ids:number[])=>{if(denied.has(spaceId))return null;if(reviews.has(spaceId))return {review:{id:spaceId,name:'Review space',type:'group'}};const source={kind:'space' as const,spaceId,name:'Fixture space',type:'group' as const};return {source,page:{context:{kind:'space',space:{id:spaceId,name:source.name,type:source.type}},items:data.filter(r=>r.spaceId===spaceId&&ids.includes(r.id)).map(r=>({publicationId:r.id,creator:{id:r.creatorId},spaceId,productionUlid:r.production})),nextCursor:null}};}};
 const first=await aggregatePage('following',principal,{limit:'1'},now,deps);eq(first.items.map(i=>i.publicationId),[1]);assert.ok(first.nextCursor);checks++;
 const next=await aggregatePage('following',principal,{cursor:first.nextCursor!,limit:'1'},now,deps);eq(next.items.map(i=>i.publicationId),[3]);
 data.unshift(row(9,4));const retry=await aggregatePage('following',principal,{cursor:first.nextCursor!,limit:'1'},now,deps);eq(retry.items.map(i=>i.publicationId),[3]);
 await assert.rejects(()=>aggregatePage('creations',principal,{cursor:first.nextCursor!},now,deps));checks++;
 denied.add(10);const renewed=await aggregatePage('following',principal,{publicationIds:'1'},now,deps);eq(renewed.items,[]);denied.clear();
 data=data.filter(r=>r.id!==1);eq((await aggregatePage('following',principal,{publicationIds:'1'},now,deps)).items,[]);
 const missing=await aggregatePage('following',principal,{anchorPublicationId:'1'},now,deps);eq(missing.resume?.outcome,'unavailable');
 reviews.add(11);const gated=await aggregatePage('following',principal,{},now,deps);eq(gated.items.some(i=>i.spaceId===11),false);eq(gated.reviewRequired?.[0].id,11);
 await assert.rejects(()=>aggregatePage('following',principal,{publicationIds:'2,2'},now,deps));await assert.rejects(()=>aggregatePage('following',principal,{cursor:'bad'},now,deps));checks+=2;
 data=Array.from({length:525},(_,i)=>row(i+1,(i%5)+2));reviews.clear();
 const windows=await aggregatePage('following',principal,{limit:'50'},now,deps);let page=windows;const seen=new Set(page.items.map(i=>i.publicationId));
 while(page.nextCursor){page=await aggregatePage('following',principal,{cursor:page.nextCursor,limit:'50'},now,deps);for(const item of page.items){assert.ok(!seen.has(item.publicationId));seen.add(item.publicationId);}}
 eq(seen.size,525);eq((await aggregatePage('following',principal,{cursor:windows.nextCursor!,limit:'50'},now,deps)).items.length,50);
 console.log(JSON.stringify({suite:'aggregate selection/ranking/session contracts',passed:checks}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
