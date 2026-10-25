import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { createFollowAccess, type FollowContext } from '../../src/features/follows/access';
import { createCreatorFollowService } from '../../src/features/follows/service';
import { transaction } from '../../src/features/follows/repo';
import { createFollowRouter } from '../../src/features/follows/router';
import { csrfProtect } from '../../src/middleware/csrf';
import { readBearer, ViewerApiError } from '../../src/features/native-sessions/service';
const ctx:FollowContext={spaceId:2,publicationId:9,userId:4};
function fixture(){
 const space:any={id:2,name:'Group',type:'group',slug:'group',settings:{comments:'off'}};
 let allowed=true,visible=true,deleted=false;const row:any={space_id:2,publication_id:9,owner_id:7,owner_user_id:8};
 const db:any={query:async()=>[deleted?[]:[{id:row.owner_id}]]};
 const access=createFollowAccess({space:async(_s:number,connection:any)=>{assert.equal(connection,db);return space;},canView:async(_s:any,_u:number,connection:any)=>{assert.equal(connection,db);return allowed;},select:async(s:number,o:any,connection:any)=>{assert.equal(s,2);assert.equal(o.publicationId,9);assert.equal(connection,db);return visible?[row]:[];}} as any);
 return {space,row,db,access:(c=ctx)=>access(c,db),deny:()=>allowed=false,hide:()=>visible=false,delete:()=>deleted=true};
}
test('Follow binds the eligible upload creator rather than publisher and validates all IDs before data',async()=>{
 const f=fixture();assert.equal((await f.access()).creatorId,7);await assert.rejects(f.access({...ctx,expectedCreatorId:8}),{status:404,code:'creator_not_found'});
 f.hide();await assert.rejects(f.access(),{status:404,code:'publication_not_found'});
 const g=fixture();g.deny();await assert.rejects(g.access(),{status:403});
 const h=fixture();h.delete();await assert.rejects(h.access(),{status:404,code:'creator_not_found'});
});
test('Follow rejects personal and Global aliases without repurposing commenting capability',async()=>{
 for(const change of [(s:any)=>s.type='personal',(s:any)=>s.slug='GLOBAL',(s:any)=>s.slug='global-feed',(s:any)=>s.settings={global:true},(s:any)=>s.settings={isGlobal:true},(s:any)=>s.settings={feed:'global'}]){
  const f=fixture();change(f.space);await assert.rejects(f.access(),{status:403});
 }
 const f=fixture();f.space.type='channel';assert.equal((await f.access()).space.type,'channel');
});
function serviceFixture(){
 let allowed=true,target=7,following=false;const db:any={};const calls:string[]=[];
 const deps:any={access:async(c:any,connection:any)=>{calls.push(connection?'access-connection':'access');if(!allowed)throw new ViewerApiError(403,'forbidden');return {creatorId:target,space:{id:c.spaceId,type:'group',name:'Group'}};},
  getSummary:async(_s:number,_t:number,_u:number,connection:any)=>{if(connection)assert.equal(connection,db);return {following,followingElsewhere:false,followersCount:following?4:3};},
  transaction:async(_p:number,work:any)=>work(db),setFollowing:async(_s:number,t:number,_u:number,wanted:boolean,connection:any)=>{assert.equal(connection,db);assert.equal(t,target);calls.push('write');following=wanted;}};
 return {deps,service:createCreatorFollowService(deps),calls,deny:()=>allowed=false,retarget:()=>target=8};
}
test('Follow desired-state writes recheck near mutation and after summary; self reads keep real count',async()=>{
 const f=serviceFixture();const one=await f.service.set(ctx,true);assert.equal(one.following,true);assert.equal((await f.service.set(ctx,true)).followersCount,4);assert.equal((await f.service.set(ctx,false)).followersCount,3);
 assert.deepEqual(f.calls.slice(0,4),['access','access-connection','write','access-connection']);
 const self=await f.service.summary({...ctx,userId:7});assert.equal(self.followingElsewhere,false);assert.equal(self.canFollow,false);assert.equal(self.followersCount,3);assert.equal(self.disabledReason,'self');await assert.rejects(f.service.set({...ctx,userId:7},true),{code:'cannot_follow_self'});
 const g=serviceFixture();g.deps.transaction=async(_p:number,work:any)=>{g.deny();return work({});};await assert.rejects(g.service.set(ctx,true),{status:403});assert.equal(g.calls.includes('write'),false);
 const h=serviceFixture();h.deps.getSummary=async()=>{h.deny();return {following:true,followersCount:1};};await assert.rejects(h.service.summary(ctx),{status:403});
 const j=serviceFixture();j.deps.transaction=async(_p:number,work:any)=>{j.retarget();return work({});};await assert.rejects(j.service.set(ctx,true),{code:'creator_not_found'});
});
test('elsewhere is caller-owned summary data, self-masked and withheld after current source denial',async()=>{
 const f=serviceFixture();f.deps.getSummary=async()=>({following:false,followingElsewhere:true,followersCount:3});
 assert.equal((await f.service.summary(ctx)).followingElsewhere,true);
 assert.equal((await f.service.summary({...ctx,userId:7})).followingElsewhere,false);
 f.deps.getSummary=async()=>{f.deny();return {following:false,followingElsewhere:true,followersCount:3};};
 await assert.rejects(f.service.summary(ctx),{status:403});
});
test('Follow SQL transaction rolls back and releases its supplied connection',async()=>{
 const module=require('../../src/db'),old=module.getPool,calls:string[]=[];
 const db:any={query:async(sql:string)=>{calls.push(sql.startsWith('SELECT')?'lock':'isolation');return [[{id:9}]];},beginTransaction:async()=>{calls.push('begin');},commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>calls.push('release')};
 module.getPool=()=>({getConnection:async()=>db});
 try{await assert.rejects(transaction(9,async conn=>{assert.equal(conn,db);throw Error('failed');}));assert.deepEqual(calls,['isolation','begin','lock','rollback','release']);}finally{module.getPool=old;}
});
test('mounted Follow routes enforce explicit proof, cookie CSRF, native transport separation and sanitized errors',async()=>{
 const f=serviceFixture();const deps:any={creatorFollow:f.service,resolveViewer:async(req:any)=>{
  const token=readBearer(req,false);if(!token&&!req.user)throw new ViewerApiError(401,'unauthorized');return {source:token?'native':'cookie',viewer:{id:4}};
 }};
 const app=express();app.use(express.json());app.use((req:any,_res,next)=>{if(req.headers.cookie?.includes('sid=valid')){req.user={id:4};req.session={id:1};}next();});app.use(csrfProtect);
 app.use(createFollowRouter(true,deps));app.use('/api/viewer/v1',createFollowRouter(false,deps));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as any).port}`;
 const native='/api/viewer/v1/spaces/2/publications/9/creator-follow',legacy='/api/spaces/2/users/7/follow';
 const auth={authorization:'Bearer nv1_'+'a'.repeat(64)},cookie={cookie:'sid=valid; csrf=test','x-csrf-token':'test'};
 try{
  assert.equal((await fetch(base+legacy,{headers:cookie})).status,400);
  for(const q of ['?publicationId=1&publicationId=2','?publicationId=1e1','?publicationId=9&x=1'])assert.equal((await fetch(base+legacy+q,{headers:cookie})).status,400);
  assert.equal((await fetch(base+legacy+'?publicationId=9',{headers:auth})).status,401);
  assert.equal((await fetch(base+legacy+'?publicationId=9',{method:'POST',headers:{cookie:cookie.cookie}})).status,403);
  const r=await fetch(base+legacy+'?publicationId=9',{method:'POST',headers:cookie});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
  assert.equal((await fetch(base+native,{method:'DELETE',headers:auth})).status,200);
  assert.equal((await fetch(base+native,{headers:{...auth,...cookie}})).status,400);
  assert.equal((await fetch(base+native+'?creatorId=7',{headers:auth})).status,400);
  assert.equal((await fetch(base+native,{method:'POST',headers:{...auth,'content-type':'application/json'},body:'{"creatorId":7}'})).status,400);
  f.deps.getSummary=async()=>{throw new Error('private SQL error');};const failed=await fetch(base+native,{headers:auth});assert.equal(failed.status,503);assert.deepEqual(await failed.json(),{error:'service_unavailable'});
 }finally{server.close();server.closeAllConnections();}
});
