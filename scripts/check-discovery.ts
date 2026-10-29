import {assertDiscoveryQaIsolated} from './discovery-qa-isolation';
/** Real SQL and isolated API qualification. Restores only this run's fixture-account discovery state. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {once} from 'node:events';
import {getPool} from '../src/db';
import {buildServer} from '../src/app';
import {discoveryPreviewFixtures} from './discovery-preview-fixtures';
import * as discovery from '../src/features/discovery/service';
async function main(){
 await assertDiscoveryQaIsolated();
 process.env.NATIVE_SESSIONS_ENABLED='1';process.env.NATIVE_ALLOW_INSECURE_LOOPBACK='1';await discoveryPreviewFixtures();
 const f=JSON.parse(fs.readFileSync('.codex-local/plan175-fixtures.json','utf8')),db=getPool();
 const tables=['viewer_saved_spaces','viewer_discovery_migrations','viewer_space_acknowledgments','viewer_recent_spaces'];
 const backups:Record<string,any[]>={};for(const table of tables){const [r]:any=await db.query(`SELECT * FROM ${table} WHERE user_id=?`,[f.users.a.id]);backups[table]=r;}
 const [entryDocuments]:any=await db.query("SELECT space_id,revision FROM space_entry_documents WHERE space_id IN (?,(SELECT id FROM spaces WHERE slug='global-feed'))",[f.spaces.group]);
 const [listing]:any=await db.query('SELECT * FROM discovery_spaces WHERE space_id=?',[f.spaces.group]);
 const globalId=(await discovery.resolveSpace('global',null)).space.id;
 const [globalListing]:any=await db.query('SELECT * FROM discovery_spaces WHERE space_id=?',[globalId]);
 const server=buildServer().listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as any).port}`;
 let checks=0;const eq=(a:any,b:any)=>{assert.deepEqual(a,b,`Discovery check ${checks+1}: expected ${JSON.stringify(b)}, received ${JSON.stringify(a)}`);checks++;};
 const call=async(path:string,headers:Record<string,string>={},body?:any)=>{const r=await fetch(base+path,{headers:{...headers,...(body===undefined?{}:{'content-type':'application/json'})},method:body===undefined?'GET':'POST',...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,headers:r.headers,body:await r.json() as any};};
 const prefix='/api/viewer/v1/discovery',tokens:string[]=[],cookies:string[]=[];
 try {
  const publicHome=await call(prefix+'/home');eq(publicHome.status,200);eq(publicHome.body.genres.map((g:any)=>g.name),['Travel','Cooking','Technology','Arts']);eq(publicHome.body.global.path,'/global');eq(publicHome.headers.get('cache-control'),'no-store');
  eq(publicHome.body.genres.every((g:any)=>g.items.length===1),true);eq(JSON.stringify(publicHome.body).includes('playbackUrl'),false);
  eq((await call(prefix+'/directory?genre=missing')).status,404);eq((await call(prefix+'/directory?limit=51')).status,400);
  eq((await call(prefix+`/spaces/${f.spaces.hidden}/entry`)).status,404);
  const anonymous=await call(prefix+`/spaces/${f.spaces.group}/entry`);eq(anonymous.status,200);eq(anonymous.body.requiresSignIn,true);eq(anonymous.body.canView,false);eq(anonymous.body.requiresAcknowledgment,true);
  eq((await call(prefix+'/saved')).status,401);
  const authResult=await call('/api/native/v1/session',{},f.users.a);eq(authResult.status,201);tokens.push(authResult.body.token);const auth={authorization:`Bearer ${authResult.body.token}`};
  eq((await call(prefix+'/genres',auth,{slug:'forbidden',name:'Forbidden',published:true,sortOrder:1})).status,403);
  const saved=await call(prefix+'/saved',auth);eq(saved.status,200);eq(saved.body.items.some((s:any)=>s.id===f.spaces.group),true);
  for(const value of [false,false])eq((await call(prefix+`/spaces/${f.spaces.group}/save`,auth,{saved:value})).status,200);
  eq((await call(prefix+'/saved',auth)).body.items.some((s:any)=>s.id===f.spaces.group),false);
  await discovery.migrateSaved(f.users.a.id);eq((await call(prefix+'/saved',auth)).body.items.some((s:any)=>s.id===f.spaces.group),false);
  eq((await call(prefix+`/spaces/${f.spaces.group}/save`,auth,{saved:true})).body.saved,true);
  const current=await call(prefix+`/spaces/${f.spaces.group}/entry`,auth);eq(current.body.canView,true);
  eq((await call(prefix+`/spaces/${f.spaces.group}/accept`,auth,{revision:'a'.repeat(64)})).status,409);
  eq((await call(prefix+`/spaces/${f.spaces.group}/accept`,auth,{revision:current.body.revision})).status,200);
  eq((await call(prefix+`/spaces/${f.spaces.group}/entry`,auth)).body.requiresAcknowledgment,false);
  await db.query('UPDATE discovery_spaces SET entry_enabled=1 WHERE space_id=?',[f.spaces.group]);
  const memberFeed=await call(`/api/viewer/v1/spaces/${f.spaces.group}/feed`,auth);eq(memberFeed.status,200);eq(memberFeed.body.items.length>0,true);
  const item=memberFeed.body.items[0],checkpoint={publicationId:item.publicationId,productionUlid:item.productionUlid,positionSeconds:7,userPaused:true};
  let resume=await call(prefix+`/spaces/${f.spaces.group}/resume`,auth);eq(resume.status,200);
  const visited=await call(prefix+`/spaces/${f.spaces.group}/visit`,auth,{revision:resume.body.revision,checkpoint});eq(visited.status,200);
  eq((await call(prefix+`/spaces/${f.spaces.group}/visit`,auth,{revision:resume.body.revision,checkpoint})).status,409);
  resume=await call(prefix+`/spaces/${f.spaces.group}/resume`,auth);eq(resume.body.checkpoint,checkpoint);eq(resume.body.outcome,'restored');
  eq((await call(prefix+'/recent',auth)).body.items.some((s:any)=>s.id===f.spaces.group),true);
  await db.query('UPDATE viewer_recent_spaces SET production_ulid=? WHERE user_id=? AND space_id=?',['01J00000000000000000000000',f.users.a.id,f.spaces.group]);
  const unavailable=await call(prefix+`/spaces/${f.spaces.group}/resume`,auth);eq(unavailable.body.outcome,'unavailable');eq(unavailable.body.checkpoint,null);
  await db.query('UPDATE viewer_recent_spaces SET visited_at=NOW()-INTERVAL 91 DAY WHERE user_id=? AND space_id=?',[f.users.a.id,f.spaces.group]);
  eq((await call(prefix+`/spaces/${f.spaces.group}/resume`,auth)).body.revision,0);
  eq((await call(prefix+`/spaces/${f.spaces.group}/visit`,auth,{revision:0,checkpoint})).status,200);
  await db.query('UPDATE discovery_spaces SET welcome=CONCAT(welcome,?) WHERE space_id=?',[' Updated preview text.',f.spaces.group]);
  eq((await call(`/api/viewer/v1/spaces/${f.spaces.group}/feed`,auth)).status,428);
  eq((await call(`/api/spaces/${f.spaces.group}/feed`,auth)).status,428);
  eq((await call(prefix+`/spaces/${f.spaces.group}/accept`,auth,{revision:current.body.revision})).status,409);
  const updated=await call(prefix+`/spaces/${f.spaces.group}/entry`,auth);eq(updated.body.requiresAcknowledgment,true);
  eq((await call(prefix+`/spaces/${f.spaces.group}/accept`,auth,{revision:updated.body.revision})).status,200);
  eq((await call(`/api/viewer/v1/spaces/${f.spaces.group}/feed`,auth)).status,200);
  const login=await call('/api/login',{},f.users.a);eq(login.status,200);const cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');cookies.push(cookie);
  eq((await call(prefix+`/spaces/${f.spaces.group}/save`,{cookie},{saved:false})).status,403);
  const csrf=decodeURIComponent(/(?:^|; )csrf=([^;]+)/.exec(cookie)?.[1]||'');eq((await call(prefix+`/spaces/${f.spaces.group}/save`,{cookie,'x-csrf-token':csrf},{saved:false})).status,200);
  eq((await call(prefix+'/saved',{...auth,cookie})).status,400);
  await db.query('INSERT INTO discovery_spaces (space_id,entry_enabled) VALUES (?,1) ON DUPLICATE KEY UPDATE entry_enabled=1',[globalId]);
  const global=await call(prefix+'/spaces/global/entry');eq(global.body.canView,true);eq(global.body.requiresAcknowledgment,true);
  eq((await call('/api/viewer/v1/feed/global')).status,428);
  const receipt=await call(prefix+'/spaces/global/accept',{}, {revision:global.body.revision});eq(receipt.status,200);eq(typeof receipt.body.receipt,'string');
  eq((await call('/api/viewer/v1/feed/global',{'x-space-entry-receipt':receipt.body.receipt})).status,200);
  eq((await call('/api/viewer/v1/feed/global',{'x-space-entry-receipt':'invalid'})).status,428);
  eq((await call('/api/feed/global',{'cookie':receipt.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')})).status,200);
  const old=await fetch(base+'/?publication_id=730&t=0&t_end=7',{redirect:'manual'});eq(old.status,302);eq(old.headers.get('location'),'/global?publication_id=730&t=0&t_end=7');
  eq((await fetch(base+'/global')).status,200);eq((await fetch(base+'/channels/global-feed',{redirect:'manual'})).headers.get('location'),'/global');
  fs.mkdirSync('tests/runs/api-curl/plan_184',{recursive:true});fs.writeFileSync('tests/runs/api-curl/plan_184/summary.json',JSON.stringify({checks,status:'passed',scope:'Real SQL, directory/privacy, saves/migration tombstones, current/stale acknowledgment, cookie-CSRF/bearer isolation, both content transports, anonymous Global signed receipt, expiry/CAS/resume, routes. Only fixture account state temporarily changed; restored.'},null,2));
  console.log(JSON.stringify({checks,status:'passed'}));
 }finally {
  for(const token of tokens)await fetch(base+'/api/native/v1/session',{method:'DELETE',headers:{authorization:`Bearer ${token}`}}).catch(()=>{});
  for(const cookie of cookies)await fetch(base+'/logout',{headers:{cookie},redirect:'manual'}).catch(()=>{});
  for(const table of tables){await db.query(`DELETE FROM ${table} WHERE user_id=?`,[f.users.a.id]);for(const row of backups[table])await db.query(`INSERT INTO ${table} SET ?`,[row]);}
  const [documentsNow]:any=await db.query('SELECT space_id,revision FROM space_entry_documents WHERE space_id IN (?,?)',[f.spaces.group,globalId]);
  for(const document of documentsNow)if(!entryDocuments.some((old:any)=>Number(old.space_id)===Number(document.space_id)&&old.revision===document.revision))await db.query('DELETE FROM space_entry_documents WHERE space_id=? AND revision=?',[document.space_id,document.revision]);
  await db.query('UPDATE discovery_spaces SET ? WHERE space_id=?',[listing[0],f.spaces.group]);
  if(globalListing.length)await db.query('UPDATE discovery_spaces SET ? WHERE space_id=?',[globalListing[0],globalId]);else await db.query('DELETE FROM discovery_spaces WHERE space_id=?',[globalId]);
  await new Promise<void>(r=>server.close(()=>r()));await db.end();
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
