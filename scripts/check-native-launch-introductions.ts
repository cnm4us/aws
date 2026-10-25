import assert from 'node:assert/strict';
import fs from 'node:fs';
import { once } from 'node:events';
import { buildServer } from '../src/app';
import { getPool } from '../src/db';
import { assignDefaultAdminRoles } from '../src/services/spaceMembership';
import { seedIntroductionFixtures } from './native-launch-introduction-fixtures';
async function main(){
 process.env.NATIVE_SESSIONS_ENABLED='1';process.env.NATIVE_ALLOW_INSECURE_LOOPBACK='1';
 const f=await seedIntroductionFixtures(),db=getPool(),ids=[f.users.a.id,f.users.b.id];
 const [beforeSessions]:any=await db.query('SELECT id,user_id FROM native_sessions WHERE user_id IN (?,?) AND revoked_at IS NULL AND expires_at>NOW() ORDER BY id',ids);
 const [settings]:any=await db.query('SELECT id,settings FROM spaces WHERE id IN (?,?) ORDER BY id',[f.spaces.group,f.spaces.channel]);
 const [ownerRoles]:any=await db.query('SELECT user_id,space_id,role_id FROM user_space_roles WHERE user_id=? AND space_id=? ORDER BY role_id',[f.users.b.id,f.spaces.group]);
 await assignDefaultAdminRoles(db,{id:f.spaces.group,type:'group',owner_user_id:f.users.b.id},f.users.b.id);
 const [profile]:any=await db.query('SELECT is_public,show_bio FROM profiles WHERE user_id=?',[f.users.b.id]);
 const server=buildServer().listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as any).port}`;
 const path=`/api/viewer/v1/feed/global/publications/${f.introductionSource.publicationId}/spaces`,tokens:string[]=[],cookies:string[]=[];
 const directory='tests/runs/api-curl/plan_175_introductions';fs.mkdirSync(directory,{recursive:true});let checks=0,passed=false,duplicateId:number|undefined;
 const eq=(a:unknown,b:unknown)=>assert.deepEqual(a,b,`Launch introduction check ${++checks}`);
 const call=async(p:string,headers:Record<string,string>={},method='GET',body?:unknown)=>{
  const r=await fetch(base+p,{method,headers:{...headers,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(p.startsWith('/api/viewer/'))eq(r.headers.get('cache-control'),'no-store');
  return {status:r.status,body:await r.json() as any};
 };
 const login=async(label:string)=>{const r=await call('/api/native/v1/session',{},'POST',f.users[label]);eq(r.status,201);tokens.push(r.body.token);return {authorization:`Bearer ${r.body.token}`};};
 const browserLogin=async(label:string)=>{const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(f.users[label])});eq(r.status,200);const cookie=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');cookies.push(cookie);return {cookie,'x-csrf-token':decodeURIComponent(/(?:^|; )csrf=([^;]+)/.exec(cookie)?.[1]||'')};};
 try{
  eq((await call(path)).status,401);const a=await login('a'),b=await login('b'),webA=await browserLogin('a'),webB=await browserLogin('b');
  const settingsPath=`/api/spaces/${f.spaces.group}/settings`,original=JSON.parse(typeof settings.find((s:any)=>Number(s.id)===f.spaces.group).settings==='string'?settings.find((s:any)=>Number(s.id)===f.spaces.group).settings:JSON.stringify(settings.find((s:any)=>Number(s.id)===f.spaces.group).settings));
  const description='Disposable test community: thoughtful discussion with explicit local moderation. Plan175 fixture only.';
  eq((await call(settingsPath,webA,'PUT',{discoveryDescription:'not allowed'})).status,403);
  eq((await call(settingsPath,{cookie:webB.cookie},'PUT',{discoveryDescription:'not allowed'})).status,403);
  for(const input of [4,{},'x'.repeat(501)])eq((await call(settingsPath,webB,'PUT',{discoveryDescription:input})).status,400);
  const changed=await call(settingsPath,webB,'PUT',{discoveryDescription:description});eq(changed.status,200);eq(changed.body.settings,{...original,discoveryDescription:description});
  const listed=await call(path,a);eq(listed.status,200);eq(listed.body.creator.id,f.users.b.id);eq(Object.keys(listed.body.creator).sort(),['avatarUrl','bio','displayName','id']);eq(listed.body.creator.displayName,'Launch creator B');
  eq(listed.body.items.some((i:any)=>i.space.id===f.spaces.group&&i.space.description===description),true);
  eq(listed.body.items.some((i:any)=>i.space.id===f.spaces.channel),true);eq(listed.body.items.some((i:any)=>i.space.id===f.spaces.hidden),false);
  eq(Object.keys(listed.body.items.find((i:any)=>i.space.id===f.spaces.group).space).sort(),['description','id','name','type']);
  eq(JSON.stringify(listed.body).includes('publishing'),false);
  const resolved=await call(path+'/'+f.spaces.group,a);eq(resolved.status,200);eq(resolved.body.creator.id,f.users.b.id);eq(resolved.body.space.description,description);
  const feed=await call(`/api/viewer/v1/spaces/${f.spaces.group}/feed?anchorPublicationId=${resolved.body.publicationId}`,a);eq(feed.status,200);eq(feed.body.items.find((i:any)=>i.publicationId===resolved.body.publicationId)?.creator.id,f.users.b.id);
  const ordinary=await call(`/api/viewer/v1/feed/global/publications/${f.source.publicationId}/spaces`,a);eq(ordinary.status,200);
  if(ordinary.body.creator.id!==f.users.b.id){eq(ordinary.body.items.some((i:any)=>i.space.id===f.spaces.group),false);eq((await call(`/api/viewer/v1/feed/global/publications/${f.source.publicationId}/spaces/${f.spaces.group}`,a)).status,404);}
  await db.query('UPDATE profiles SET show_bio=0 WHERE user_id=?',[f.users.b.id]);eq((await call(path,a)).body.creator.bio,null);
  await db.query('UPDATE profiles SET is_public=0 WHERE user_id=?',[f.users.b.id]);const hidden=await call(path,a);eq(hidden.body.creator.bio,null);eq(hidden.body.creator.avatarUrl,null);eq(hidden.body.creator.displayName,'Launch test B');
  const cleared=await call(settingsPath,webB,'PUT',{discoveryDescription:null});eq(cleared.status,200);const expected={...original};delete expected.discoveryDescription;eq(cleared.body.settings,expected);
  eq((await call(path+'/'+f.spaces.group,a)).body.space.description,null);
  await db.query('UPDATE space_publications SET visible_in_global=0 WHERE id=?',[f.introductionSource.publicationId]);eq((await call(path,a)).status,404);eq((await call(path+'/'+f.spaces.group,a)).status,404);
  passed=true;
 }finally{
  await db.query('UPDATE space_publications SET visible_in_global=1 WHERE id=? AND owner_user_id=?',[f.introductionSource.publicationId,f.users.b.id]);
  if(duplicateId)await db.query('DELETE FROM space_publications WHERE id=? AND story_text=?',[duplicateId,'Plan175 temporary duplicate source test']);
  await db.query('UPDATE profiles SET is_public=?,show_bio=? WHERE user_id=?',[profile[0].is_public,profile[0].show_bio,f.users.b.id]);
  await db.query('DELETE FROM user_space_roles WHERE user_id=? AND space_id=?',[f.users.b.id,f.spaces.group]);
  for(const row of ownerRoles)await db.query('INSERT INTO user_space_roles(user_id,space_id,role_id) VALUES(?,?,?)',[row.user_id,row.space_id,row.role_id]);
  for(const row of settings)await db.query('UPDATE spaces SET settings=? WHERE id=?',[typeof row.settings==='string'?row.settings:JSON.stringify(row.settings),row.id]);
  for(const token of tokens)await fetch(base+'/api/native/v1/session',{method:'DELETE',headers:{authorization:`Bearer ${token}`}}).catch(()=>{});
  for(const cookie of cookies)await fetch(base+'/logout',{headers:{cookie},redirect:'manual'}).catch(()=>{});
  const [afterSessions]:any=await db.query('SELECT id,user_id FROM native_sessions WHERE user_id IN (?,?) AND revoked_at IS NULL AND expires_at>NOW() ORDER BY id',ids);eq(afterSessions,beforeSessions);
  const result={result:passed?'passed':'failed',checks,sourcePublicationId:f.introductionSource.publicationId,creatorId:f.users.b.id,preexistingPhoneSessionsPreserved:beforeSessions.length,scope:'Actual native+cookie Launch list/resolve, shared public creator and visibility/bio rules, scoped authored description/permission/CSRF/validation/clear and unrelated settings preservation; source/creator mismatch, exact anchored feed, source removal. Temporary fixture settings/profile/publication deltas and exact host sessions restored.'};
  fs.writeFileSync(directory+'/summary.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));await new Promise<void>(r=>server.close(()=>r()));await db.end();
 }
}
main().catch(async e=>{console.error(e.message);process.exitCode=1;await getPool().end().catch(()=>{});});
