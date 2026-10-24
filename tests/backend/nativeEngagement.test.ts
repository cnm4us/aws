import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { createEngagementAccess } from '../../src/features/engagement/access';
import { createEngagementService } from '../../src/features/engagement/service';
import { commentBody, positiveId, parsePage, encodeCursor } from '../../src/features/engagement/contract';
import { transaction, mapComment } from '../../src/features/engagement/repo';
import { can } from '../../src/security/permissions';
import { PERM } from '../../src/security/perm';
import { createViewerRouter } from '../../src/routes/viewer';
import { ViewerApiError, readBearer } from '../../src/features/native-sessions/service';
import { csrfProtect } from '../../src/middleware/csrf';
const ctx={spaceId:2,publicationId:9,userId:4};
function accessFixture() {
  const space:any={id:2,type:'group',slug:'group',settings:{}};
  let allowed=true,visible=true,post=true,enabled=1;
  const db:any={query:async()=>[[{comments_enabled:enabled}]]};
  const access=createEngagementAccess({space:async()=>space,canView:async(s:any,u:number,connection:any)=>{assert.equal(connection,db);return allowed;},
    select:async(id:number,opts:any,connection:any)=>{assert.equal(connection,db);return visible?[{publication_id:opts.publicationId,space_id:id}]:[];},can:async()=>post} as any);
  return {space,db,access:()=>access(2,9,4,db),deny:()=>{allowed=false;},hide:()=>{visible=false;},noPost:()=>{post=false;},off:()=>{enabled=0;}};
}
test('engagement uses exact eligible space/publication and distinguishes read from posting',async()=>{
  const f=accessFixture();assert.deepEqual(await f.access(),{canComment:true,disabledReason:null});
  f.off();assert.deepEqual(await f.access(),{canComment:false,disabledReason:'comments_disabled'});
  const g=accessFixture();g.noPost();assert.equal((await g.access()).disabledReason,'comment_forbidden');
  g.hide();await assert.rejects(g.access(),{status:404,code:'publication_not_found'});
  const h=accessFixture();h.deny();await assert.rejects(h.access(),{status:403,code:'forbidden'});
  const p=accessFixture();p.space.type='personal';assert.equal((await p.access()).canComment,true);p.deny();await assert.rejects(p.access(),{status:403});
});
test('Global aliases/settings cannot engage even if selector and user would allow them',async()=>{
  for(const mutate of [(s:any)=>s.slug='global',(s:any)=>s.slug='global-feed',(s:any)=>s.settings={global:true},(s:any)=>s.settings={isGlobal:true},(s:any)=>s.settings={feed:'global'}]){
    const f=accessFixture();mutate(f.space);await assert.rejects(f.access(),{status:403});
  }
  const f=accessFixture();f.space.settings={comments:'off'};assert.equal((await f.access()).disabledReason,'comments_disabled');
});
test('strict bodies, scalar IDs and context-bound pagination reject substitutions',()=>{
  for(const value of ['0','1e2','-1','1.5','9007199254740992',['2'],2])assert.throws(()=>positiveId(value));
  for(const value of [null,[],{body:2},{body:' '},{body:'x'.repeat(2001)},{body:'x',parentId:1},{body:'x',userId:5}])assert.throws(()=>commentBody(value));
  assert.deepEqual(commentBody({body:' a\nb '}),{body:'a\nb',parentId:null});
  assert.throws(()=>commentBody({body:'x',parentId:'2'},true));
  const cursor=encodeCursor(ctx,'newest','2026-10-23 12:00:00',8);
  assert.equal(parsePage({cursor},ctx).cursor!.id,8);
  for(const other of [{...ctx,spaceId:3},{...ctx,publicationId:10},{...ctx,userId:5}])assert.throws(()=>parsePage({cursor},other));
  for(const q of [{cursor,order:'oldest'},{limit:'51'},{limit:['2']},{order:['newest']},{cursor:'e30'},{extra:'x'}])assert.throws(()=>parsePage(q,ctx));
  assert.deepEqual(Object.keys(mapComment({id:1,user_id:4,body:'hi',created_at:'today',display_name:null,email:'private@example.invalid'},4)).sort(),['id','body','createdAt','author','isMine'].sort());
  assert.equal(mapComment({id:1,user_id:4,body:'hi',created_at:'today',email:'private@example.invalid'},4).author.displayName,'Viewer');
});
function serviceFixture() {
  let available=true,canPost=true;const events:string[]=[];
  const db:any={query:async()=>[]};
  const deps:any={access:async(s:number,p:number,u:number,conn:any)=>{events.push(conn?'access-transaction':'access');if(!available)throw new ViewerApiError(403,'forbidden');return {canComment:canPost,disabledReason:canPost?null:'comments_disabled'};},
    transaction:async(p:number,work:any)=>{events.push('transaction');return work(db);},
    summary:async()=>({likes:{count:1,likedByMe:true},comments:{count:1,hasCommentedByMe:true}}),
    setLike:async()=>{events.push('write-like');},parent:async()=>{events.push('parent');throw new ViewerApiError(404,'publication_not_found');},
    insertComment:async()=>{events.push('write-comment');return {id:1};},comments:async()=>({items:[],last:null}),likers:async()=>({items:[],last:null})};
  return {service:createEngagementService(deps),deps,events,deny:()=>{available=false;},disable:()=>{canPost=false;}};
}
test('writes revalidate after the publication lock; disabled posting and bad parents cannot write',async()=>{
  const f=serviceFixture();await f.service.like(ctx,true);assert.deepEqual(f.events,['access','transaction','access-transaction','write-like']);
  const g=serviceFixture();g.disable();await assert.rejects(g.service.create(ctx,'hello'),{code:'comments_disabled'});assert.equal(g.events.includes('write-comment'),false);
  const h=serviceFixture();await assert.rejects(h.service.create(ctx,'reply',99),{status:404});assert.equal(h.events.includes('write-comment'),false);
  const j=serviceFixture();j.deps.transaction=async(p:number,work:any)=>{j.deny();return work({});};await assert.rejects(j.service.like(ctx,true),{status:403});assert.equal(j.events.includes('write-like'),false);
});
test('comment page and auxiliary liker reads recheck authority after data read',async()=>{
  const f=serviceFixture();f.deps.comments=async()=>{f.deny();return {items:[{body:'private'}],last:null};};await assert.rejects(f.service.comments(ctx,parsePage({},ctx)),{status:403});
  const g=serviceFixture();g.deps.likers=async()=>{g.deny();return {items:[],last:null};};await assert.rejects(g.service.likers(ctx,parsePage({},ctx)),{status:403});
});
test('transaction rolls back failures and always releases connection; no partial count commit',async()=>{
  const module=require('../../src/db'),old=module.getPool;const calls:string[]=[];
  const db:any={query:async(sql:string)=>{calls.push(sql.startsWith('SELECT')?'lock':'isolation');return [[{id:9}]];},beginTransaction:async()=>{calls.push('begin');},commit:async()=>{calls.push('commit');},rollback:async()=>{calls.push('rollback');},release:()=>{calls.push('release');}};
  module.getPool=()=>({getConnection:async()=>db});
  try {await assert.rejects(transaction(9,async(conn)=>{assert.equal(conn,db);throw Error('write failed');}));assert.deepEqual(calls,['isolation','begin','lock','rollback','release']);}
  finally{module.getPool=old;}
});
test('comment suspension checks fail closed, preserve admin semantics and use supplied connection',async()=>{
  const checker:any={hasGlobalPermission:async(p:string)=>p===PERM.COMMENT_CREATE,hasSpacePermission:async()=>false};
  const db:any={query:async()=>[[{blocked:1}]]};assert.equal(await can(4,PERM.COMMENT_CREATE,{spaceId:2,checker,db}),false);
  db.query=async()=>{throw Error('database down');};await assert.rejects(can(4,PERM.COMMENT_CREATE,{spaceId:2,checker,db}));
  checker.hasGlobalPermission=async()=>true;assert.equal(await can(4,PERM.COMMENT_CREATE,{spaceId:2,checker,db}),true);
});
test('mounted viewer writes keep cookie CSRF, reject mixed auth and sanitize service errors',async()=>{
  const service=serviceFixture().service;
  const app=express();app.use(express.json());
  app.use((req:any,_res,next)=>{if(req.headers.cookie?.includes('sid=valid')){req.user={id:4};req.session={id:1};}next();});app.use(csrfProtect);
  app.use('/api/viewer/v1',createViewerRouter({engagement:service as any,resolveViewer:async(req)=>{
    const token=readBearer(req,false);if(!token && !req.user)throw new ViewerApiError(401,'unauthorized');return {source:token?'native':'cookie',viewer:{id:4,displayName:'Viewer'}};
  }}));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as any).port}/api/viewer/v1/spaces/2/publications/9`;
  try {
    assert.equal((await fetch(base+'/like',{method:'POST',headers:{cookie:'sid=valid; csrf=test'}})).status,403);
    const r=await fetch(base+'/like',{method:'POST',headers:{cookie:'sid=valid; csrf=test','x-csrf-token':'test'}});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
    const auth={authorization:'Bearer nv1_'+'a'.repeat(64)};
    assert.equal((await fetch(base+'/like',{method:'POST',headers:auth})).status,200);
    assert.equal((await fetch(base+'/like',{method:'POST',headers:{...auth,cookie:'sid=valid; csrf=test','x-csrf-token':'test'}})).status,400);
    assert.equal((await fetch(base+'/comments',{method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify({body:'hello',parentId:1})})).status,400);
    assert.equal((await fetch(base+'/engagement?spaceId=2',{headers:auth})).status,400);
    assert.equal((await fetch(base.replace('/spaces/2/','/spaces/0/')+'/engagement',{headers:auth})).status,400);
  } finally {server.close();server.closeAllConnections();}
});
