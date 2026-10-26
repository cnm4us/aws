/** Read-only Plan176 API qualification against existing owned Plan175 fixtures. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { once } from 'node:events';
import { getPool } from '../src/db';
import { createViewerRouter } from '../src/routes/viewer';
import { createNativeSessionRouter } from '../src/routes/native-session';
async function main() {
 process.env.NATIVE_SESSIONS_ENABLED='1';process.env.NATIVE_ALLOW_INSECURE_LOOPBACK='1';
 const f=JSON.parse(fs.readFileSync('.codex-local/plan175-introduction-fixtures.json','utf8')),db=getPool(),tokens:string[]=[];
 const users=[f.users.a.id,f.users.b.id];
 const sessions=async()=>{const [r]=await db.query('SELECT id,user_id FROM native_sessions WHERE user_id IN (?,?) AND revoked_at IS NULL AND expires_at>NOW() ORDER BY id',users);return r;};
 const before=await sessions();let checks=0,passed=false;
 const eq=(a:unknown,b:unknown)=>{try{assert.deepEqual(a,b);}catch{throw Error(`access_check_${checks+1}`);}checks++;};
 const app=express();app.use(express.json());app.use('/api/native/v1/session',createNativeSessionRouter());app.use('/api/viewer/v1',createViewerRouter());
 const remote=process.env.VIEWER_ACCESS_BASE_URL;
 if(remote&&remote!=='https://aws.bawebtech.com')throw Error('Unexpected fixture API origin');
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 const base=remote||`http://127.0.0.1:${(server.address() as any).port}`;
 const get=async(path:string,token?:string)=>{const r=await fetch(base+path,{headers:token?{authorization:`Bearer ${token}`}:{}});eq(r.headers.get('cache-control'),'no-store');return {status:r.status,body:await r.json() as any};};
 try {
  const login=await fetch(base+'/api/native/v1/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:f.users.a.email,password:f.users.a.password})});eq(login.status,201);
  const session=await login.json() as any;tokens.push(session.token);eq(session.access.identity.viewerId,f.users.a.id);
  const path=`/api/viewer/v1/spaces/${f.spaces.group}`;
  eq((await get(path+'/feed')).status,401);
  const page=await get(path+'/feed?limit=20',session.token);eq(page.status,200);eq(page.body.access.spaceView.spaceId,f.spaces.group);
  assert(page.body.access.identity.remainingMs>0&&page.body.access.identity.remainingMs<=60000);checks++;
  eq(page.body.access.publicationViews.map((p:any)=>p.publicationId),page.body.items.map((p:any)=>p.publicationId));
  const follow=await get(path+`/publications/${f.publications.group}/creator-follow`,session.token);eq(follow.status,200);eq(follow.body.access.identity.viewerId,f.users.a.id);eq(follow.body.access.publicationViews,[]);
  const probe=await get(path+`/playback-access?publicationIds=${f.publications.group},2147483647`,session.token);eq(probe.status,200);eq(probe.body.unavailable,[2147483647]);eq(probe.body.access.publicationViews.length,1);
  eq((await get(path+'/playback-access?publicationIds=1,1',session.token)).status,400);
  const launch=`/api/viewer/v1/feed/global/publications/${f.introductionSource.publicationId}/spaces/${f.spaces.group}`;
  eq((await get(launch,session.token)).body.entry,undefined);
  const entry=await get(launch+'?include=entry',session.token);eq(entry.status,200);eq(entry.body.entry.resume.restoredPublicationId,f.publications.group);
  const selected=entry.body.entry.items.find((p:any)=>p.publicationId===f.publications.group);eq(selected.creator.id,f.users.b.id);eq(entry.body.entry.access.publicationViews.some((p:any)=>p.publicationId===selected.publicationId),true);
  const anonymous=await get('/api/viewer/v1/feed/global?limit=20'),signed=await get('/api/viewer/v1/feed/global?limit=20',session.token);
  eq(anonymous.body.items.map(({posterUrl,...i}:any)=>i),signed.body.items.map(({posterUrl,...i}:any)=>i));eq(anonymous.body.access.publicView.publicationIds,signed.body.access.publicView.publicationIds);eq(anonymous.body.access.identity,undefined);
  passed=true;
 }finally {
  for(const token of tokens){const r=await fetch(base+'/api/native/v1/session',{method:'DELETE',headers:{authorization:`Bearer ${token}`}});eq(r.status,204);eq((await get('/api/native/v1/session',token)).status,401);}
  eq(await sessions(),before);server.close();server.closeAllConnections();await db.end();
  const dir=remote?'tests/runs/api-curl/plan_176_live_https':'tests/runs/api-curl/plan_176_phase_a';fs.mkdirSync(dir,{recursive:true});
  const result={passed,checks,transport:remote?'live-https':'loopback',preexistingSessionsPreserved:true,fixtureMutations:false,mediaUrlsRecorded:false};fs.writeFileSync(dir+'/summary.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 }
}
main().catch(e=>{console.error(/^access_check_\d+$/.test(e.message)?e.message:'Plan176 access check failed; inspect sanitized assertions locally.');process.exitCode=1;getPool().end().catch(()=>{});});
