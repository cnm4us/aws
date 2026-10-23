import assert from 'node:assert/strict';
import fs from 'node:fs';
import { once } from 'node:events';
import { buildServer } from '../src/app';
import { getPool } from '../src/db';
import { seedLaunchFixtures } from './native-launch-fixtures';
async function main(){
  process.env.NATIVE_SESSIONS_ENABLED='1';process.env.NATIVE_ALLOW_INSECURE_LOOPBACK='1';
  const f=await seedLaunchFixtures(),db=getPool(),server=buildServer().listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${(server.address() as any).port}`,path=`/api/viewer/v1/feed/global/publications/${f.source.publicationId}/spaces`;
  let checks=0;const tokens:string[]=[];let cookie='';
  const eq=(a:unknown,b:unknown)=>assert.deepEqual(a,b,`launch contract check ${++checks}`);
  const call=async(p:string,headers:Record<string,string>={})=>{const r=await fetch(base+p,{headers});eq(r.headers.get('cache-control'),'no-store');return {status:r.status,body:await r.json() as any};};
  const login=async(label:string)=>{const r=await fetch(base+'/api/native/v1/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(f.users[label])});eq(r.status,201);const s=await r.json() as any;tokens.push(s.token);return {authorization:`Bearer ${s.token}`};};
  try{
    eq((await call(path)).status,401);
    const a=await login('a'),b=await login('b');
    const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(f.users.a)});eq(r.status,200);cookie=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
    const first=await call(path,a);eq(first.status,200);eq(first.body.sourcePublicationId,f.source.publicationId);
    const ids=first.body.items.map((i:any)=>i.space.id);
    for(const label of ['group','channel'])eq(ids.includes(f.spaces[label]),true);
    for(const label of ['hidden','members','banned','personal','alias','invisible','unpublished'])eq(ids.includes(f.spaces[label]),false);
    eq(Object.keys(first.body).sort(),['sourcePublicationId','productionUlid','items','nextCursor'].sort());
    eq((await call(path,{cookie})).body,first.body);eq((await call(path,{...a,cookie})).status,400);
    const target=await call(path+'/'+f.spaces.group,a);eq(target.status,200);eq(target.body.publicationId,f.publications.group);eq(target.body.publicationId===f.source.publicationId,false);
    eq(Object.keys(target.body.space).sort(),['id','name','type']);
    const feed=await call(`/api/viewer/v1/spaces/${f.spaces.group}/feed?anchorPublicationId=${f.publications.group}&limit=60`,a);eq(feed.status,200);eq(feed.body.resume.restoredPublicationId,f.publications.group);
    eq(feed.body.items.some((i:any)=>i.publicationId===f.publications.group && i.spaceId===f.spaces.group && i.productionUlid===f.source.productionUlid),true);
    const story=await call(`/api/viewer/v1/spaces/${f.spaces.group}/publications/${f.publications.group}/story`,a);eq(story.body.storyText,'Destination story for launch group');
    for(const label of ['hidden','banned','personal','alias','invisible','unpublished'])eq((await call(path+'/'+f.spaces[label],a)).status,404);
    const owner=await call(path,b);eq(owner.body.items.some((i:any)=>i.space.id===f.spaces.hidden),true);eq(owner.body.items.some((i:any)=>i.space.id===f.spaces.members),true);
    let subscriptionCreated=false;
    try{
      await db.query("INSERT INTO space_subscriptions(user_id,space_id,status) VALUES(?,?,'active')",[f.users.a.id,f.spaces.members]);subscriptionCreated=true;
      eq((await call(path+'/'+f.spaces.members,a)).status,200);
    }finally{if(subscriptionCreated)await db.query('DELETE FROM space_subscriptions WHERE user_id=? AND space_id=?',[f.users.a.id,f.spaces.members]);}
    try{await db.query('UPDATE space_publications SET visible_in_space=0 WHERE id=? AND space_id=?',[f.publications.group,f.spaces.group]);eq((await call(path+'/'+f.spaces.group,a)).status,404);eq((await call('/api/native/v1/session',a)).status,200);}
    finally{await db.query('UPDATE space_publications SET visible_in_space=1 WHERE id=? AND space_id=?',[f.publications.group,f.spaces.group]);}
    const tiny=await call(path+'?limit=1',a);eq(tiny.body.items.length,1);if(tiny.body.nextCursor){const next=await call(path+'?limit=1&cursor='+encodeURIComponent(tiny.body.nextCursor),a);eq(next.status,200);eq(next.body.items[0].space.id>tiny.body.items[0].space.id,true);eq((await call(path+'?cursor='+encodeURIComponent(tiny.body.nextCursor),b)).status,400);}
    eq((await call(path+'?limit=51',a)).status,400);eq((await call(path+'/0',a)).status,400);eq((await call(path+'/'+f.spaces.group+'?anything=1',a)).status,400);
    const original=db.query;let queries=0;
    try{db.query=function(...args:any[]){queries++;return (original as any).apply(db,args);} as any;eq((await call(path,a)).status,200);}finally{db.query=original;}
    try{db.query=function(sql:any,...args:any[]){if(typeof sql==='string' && sql.includes('FROM space_publications sp JOIN spaces s'))throw Error('controlled private database failure');return (original as any).call(db,sql,...args);} as any;const fail=await call(path,a);eq(fail.status,503);eq(fail.body,{error:'service_unavailable'});}finally{db.query=original;}
    eq((await fetch(base+`/api/publications/${f.source.publicationId}/jump-spaces`,{headers:{cookie}})).status,200);
    const expired=await login('a');await fetch(base+'/api/native/v1/session',{method:'DELETE',headers:expired});eq((await call(path,expired)).status,401);
    const summary={result:'passed',checks,sourcePublicationId:f.source.publicationId,destinationPublicationId:f.publications.group,listQueryCount:queries,scope:'Real DB/viewer-native+cookie parity, minimized source/destination authority, hidden/member/subscriber/owner/ban/alias filters, exact anchor/story, revalidation, cursor/bounds/503/expiry and read-only legacy Jump; Global unmodified. All host sessions revoked in finally.'};
    fs.mkdirSync('tests/runs/api-curl/plan_173_launch',{recursive:true});fs.writeFileSync('tests/runs/api-curl/plan_173_launch/summary.json',JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
  }finally{
    for(const token of tokens)await fetch(base+'/api/native/v1/session',{method:'DELETE',headers:{authorization:`Bearer ${token}`}}).catch(()=>{});
    if(cookie)await fetch(base+'/logout',{headers:{cookie},redirect:'manual'}).catch(()=>{});
    await new Promise<void>(r=>server.close(()=>r()));await db.end();
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
