import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { accessMetadata, playbackIds } from '../../src/features/native-sessions/access';
import { createViewerRouter } from '../../src/routes/viewer';
const principal={source:'native' as const,viewer:{id:9,displayName:'Viewer'},expiresAt:'2030-01-01T00:00:00Z'};
const item={publicationId:11,spaceId:7,uploadId:4,productionUlid:null,creator:{id:2,displayName:'Creator',avatarUrl:null},playbackUrl:'https://example.invalid/video.m3u8'} as any;
test('confirmation budget is bounded by original request, session and applicable policy, never response receipt',()=>{
 const p={...principal,expiresAt:new Date(15000).toISOString()};
 const access=accessMetadata(1000,p,[item],{spaceId:7,validUntil:12000},false,4000);
 assert.equal(access.identity?.remainingMs,11000);assert.equal(access.spaceView?.remainingMs,8000);
 assert.equal(access.publicationViews[0].remainingMs,8000);
 assert.equal(accessMetadata(1000,principal,[item],undefined,true,62000).publicView?.remainingMs,0);
 const split=accessMetadata(1000,principal,[item],{spaceId:7,validUntil:Infinity,publicationValidUntil:9000,membersOnlyIds:new Set([11])},false,4000);
 assert.equal(split.spaceView?.remainingMs,57000);assert.equal(split.publicationViews[0].remainingMs,5000);
 const publicRow=accessMetadata(1000,principal,[item],{spaceId:7,validUntil:Infinity,publicationValidUntil:0,membersOnlyIds:new Set()},false,4000);
 assert.equal(publicRow.publicationViews[0].remainingMs,57000);
 assert.deepEqual(accessMetadata(1000,null,[item],undefined,true,4000).publicView,{remainingMs:57000,publicationIds:[11]});
});
test('playback probe validates bounds, duplicate IDs and all query keys',()=>{
 assert.deepEqual(playbackIds({publicationIds:'1,2,3'}),[1,2,3]);
 for(const q of [{},{publicationIds:'1,1'},{publicationIds:'1,2,3,4'},{publicationIds:'0'},{publicationIds:'01'},
 {publicationIds:'9007199254740992'},{publicationIds:['1']},{publicationIds:'1',allowed:'true'}])assert.throws(()=>playbackIds(q as any));
});
async function mounted(run:(url:string,calls:string[])=>Promise<void>) {
 const sessions=require('../../src/features/native-sessions/service'),spaces=require('../../src/features/spaces/service'),feeds=require('../../src/features/feeds/service'),
  profiles=require('../../src/features/profiles/viewer'),launch=require('../../src/features/publications/viewerLaunch');
 const originals=[sessions.resolveViewer,spaces.confirmedSpaceView,feeds.getSpaceFeed,feeds.getGlobalFeed,profiles.loadCreators,launch.viewerLaunch.resolve];
 const calls:string[]=[];
 sessions.resolveViewer=async(req:any,required:boolean)=>{calls.push('identity');if(req.headers.authorization==='Bearer denied')throw new sessions.ViewerApiError(401,'unauthorized');return required||req.headers.authorization?principal:null;};
 spaces.confirmedSpaceView=async(id:number)=>{calls.push(`space:${id}`);if(id===8)throw new sessions.ViewerApiError(403,'forbidden');return {space:{id,type:'group',name:'Group',slug:'group'},validUntil:Infinity,publicationValidUntil:Infinity};};
 const raw={publication:{id:11,space_id:7,upload_id:4,visibility:'inherit',published_at:'2026-01-01 00:00:00'},upload:{cdn_master:item.playbackUrl},owner:{id:2,displayName:'Creator'}};
 feeds.getSpaceFeed=async(id:number,q:any)=>{calls.push('feed');return {items:q.publicationId && q.publicationId!==11?[]:[raw],nextCursor:null};};
 feeds.getGlobalFeed=async()=>({items:[raw],nextCursor:null});
 profiles.loadCreators=async()=>new Map([[2,{id:2,displayName:'Creator',avatarUrl:null}]]);
 launch.viewerLaunch.resolve=async()=>{calls.push('resolve');return {space:{id:7,name:'Group',type:'group',description:null},publicationId:11,sourcePublicationId:10,productionUlid:null,creator:{id:2,displayName:'Creator',avatarUrl:null,bio:null}};};
 const app=express();app.use(createViewerRouter(undefined,{requireEntry:async(id,userId)=>{calls.push(`entry:${id}`);assert.equal(id,7);assert.equal(userId,9);}}));const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 try{await run(`http://127.0.0.1:${(server.address() as any).port}`,calls);}finally{
  server.close();server.closeAllConnections();
  [sessions.resolveViewer,spaces.confirmedSpaceView,feeds.getSpaceFeed,feeds.getGlobalFeed,profiles.loadCreators,launch.viewerLaunch.resolve]=originals;
 }
}
test('mounted feed and selected probes carry only checked rows; denial cannot mint grants',async()=>mounted(async(base,calls)=>{
 const r=await fetch(`${base}/spaces/7/feed?limit=20`),page=await r.json() as any;
 assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(page.access.spaceView.spaceId,7);assert.equal(page.access.publicationViews[0].publicationId,11);
 assert.equal(page.items[0].publishedAt,'2026-01-01T00:00:00.000Z');
 const anchored=await (await fetch(`${base}/spaces/7/feed?anchorPublicationId=11`)).json() as any;
 assert.equal(anchored.items[0].publishedAt,page.items[0].publishedAt);
 assert.equal(calls.filter(c=>c==='identity').length,2);
 const probe=await (await fetch(`${base}/spaces/7/playback-access?publicationIds=11,12`)).json() as any;
 assert.deepEqual(probe.unavailable,[12]);assert.deepEqual(probe.access.publicationViews.map((x:any)=>x.publicationId),[11]);
 assert.equal((await fetch(`${base}/spaces/8/feed`)).status,403);
 assert.equal((await fetch(`${base}/spaces/7/feed`,{headers:{authorization:'Bearer denied'}})).status,401);
}));
test('combined Launch opt-in preserves legacy shape and rejects unsupported query',async()=>mounted(async(base)=>{
 const path=`${base}/feed/global/publications/10/spaces/7`;
 const legacy=await (await fetch(path)).json() as any;assert.equal(legacy.entry,undefined);
 const response=await fetch(`${path}?include=entry`),body=await response.json() as any;
 assert.equal(response.status,200);assert.equal(body.entry.resume.outcome,'restored');assert.equal(body.entry.items[0].publicationId,11);assert.equal(body.entry.access.identity.viewerId,9);
 assert.equal(body.entry.items[0].publishedAt,'2026-01-01T00:00:00.000Z');
 assert.equal((await fetch(`${path}?include=bad`)).status,400);assert.equal((await fetch(`${path}?include=entry&extra=1`)).status,400);
}));
test('Global public proof is independent of sign-in and carries no membership/configuration',async()=>mounted(async(base)=>{
 const a=await (await fetch(`${base}/feed/global`)).json() as any,b=await (await fetch(`${base}/feed/global`,{headers:{authorization:'Bearer valid'}})).json() as any;
 assert.deepEqual(a.items,b.items);assert.equal(a.access.identity,undefined);assert.equal(b.access.identity.viewerId,9);
 assert.equal(a.items[0].publishedAt,'2026-01-01T00:00:00.000Z');
 assert.deepEqual(a.access.publicView.publicationIds,b.access.publicView.publicationIds);assert.equal(a.access.spaceView,undefined);
 assert.equal(JSON.stringify(a).includes('expiresAt'),false);
}));

test('shared space policy preserves personal/member/admin/ban rules and bounds scheduled or subscription expiry',async()=>{
 const {confirmedSpaceView,canViewSpaceFeed}=require('../../src/features/spaces/service');
 let member=false,admin=false,banned=false,subUntil=0,banAt=Infinity,type='group',owner:number|null=null,publicView=false;
 const db={query:async(sql:string)=>{
  if(sql.includes('FROM spaces WHERE id'))return [[{id:7,type,owner_user_id:owner,settings:publicView?{visibility:'public'}:{}}]];
  if(sql.includes('MIN(starts_at)'))return [[{boundary:banAt===Infinity?null:banAt}]];
  if(sql.includes('COUNT(*) AS total'))return [[{total:subUntil?1:0,indefinite:subUntil===Infinity?1:0,boundary:subUntil}]];
  if(sql.includes('FROM suspensions'))return [banned?[{}]:[]];
  if(sql.includes('FROM user_roles'))return [admin?[{name:'video:delete_any'}]:[]];
  if(sql.includes('JOIN role_permissions'))return [[]];
  if(sql.includes('FROM user_space_roles'))return [member?[{}]:[]];
  if(sql.includes('FROM space_subscriptions'))return [subUntil?[{}]:[]];
  throw Error('Unexpected test query');
 }};
 // Use the real permission constant rather than reproducing its spelling.
 const perm=require('../../src/security/perm').PERM.VIDEO_DELETE_ANY;
 const query=db.query;db.query=async sql=>sql.includes('FROM user_roles')?[admin?[{name:perm}]:[]]:query(sql);
 await assert.rejects(confirmedSpaceView(7,9,db),{status:403});
 member=true;banAt=Date.now()+10000;
 assert.equal((await confirmedSpaceView(7,9,db)).validUntil,banAt);
 member=false;publicView=true;subUntil=Date.now()+5000;
 let d=await confirmedSpaceView(7,9,db);assert.equal(d.validUntil,banAt);assert.equal(d.publicationValidUntil,subUntil);
 publicView=false;d=await confirmedSpaceView(7,9,db);assert.equal(d.validUntil,subUntil);
 type='personal';publicView=true;await assert.rejects(confirmedSpaceView(7,9,db),{status:403});
 owner=9;assert.equal((await confirmedSpaceView(7,9,db)).publicationValidUntil,banAt);
 banned=true;await assert.rejects(confirmedSpaceView(7,9,db),{status:403});
 banned=false;owner=null;admin=true;assert.equal(await canViewSpaceFeed({id:7,type:'personal',owner_user_id:null},9,db),true);
});
