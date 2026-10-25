import assert from 'node:assert/strict';
import fs from 'node:fs';
import { once } from 'node:events';
import { buildServer } from '../src/app';
import { getPool } from '../src/db';
import { seedIntroductionFixtures } from './native-launch-introduction-fixtures';
async function main(){
 process.env.NATIVE_SESSIONS_ENABLED='1';process.env.NATIVE_ALLOW_INSECURE_LOOPBACK='1';
 const f=await seedIntroductionFixtures(),db=getPool(),aId=f.users.a.id,bId=f.users.b.id,s=f.spaces.group,p=f.publications.group;
 const tuples=[[aId,bId,s],[aId,bId,f.spaces.channel],[bId,aId,s],[aId,bId,f.spaces.personal],[aId,bId,f.spaces.alias],[aId,bId,f.spaces.hidden]];
 const [existingSessions]:any=await db.query('SELECT id,user_id FROM native_sessions WHERE user_id IN (?,?) AND revoked_at IS NULL AND expires_at>NOW() ORDER BY id',[aId,bId]);
 const snapshots=[];for(const tuple of tuples){const [rows]:any=await db.query('SELECT created_at FROM space_user_follows WHERE follower_user_id=? AND target_user_id=? AND space_id=?',tuple);snapshots.push({tuple,rows});}
 const [originalPub]:any=await db.query('SELECT owner_user_id,visible_in_space FROM space_publications WHERE id=? AND space_id=?',[f.secondPublicationId,s]);
 const [roles]:any=await db.query('SELECT user_id,space_id,role_id FROM user_space_roles WHERE user_id=? AND space_id=? ORDER BY role_id',[aId,f.spaces.personal]);
 const [settings]:any=await db.query('SELECT settings FROM spaces WHERE id=?',[s]);
 const [deleted]:any=await db.query('SELECT deleted_at FROM users WHERE id=?',[bId]);assert.equal(deleted[0].deleted_at,null);
 const server=buildServer().listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as any).port}`;
 const dir='tests/runs/api-curl/plan_175_follows';fs.mkdirSync(dir,{recursive:true});let checks=0,passed=false,cookie='',csrf='';const tokens:string[]=[];
 const eq=(a:unknown,b:unknown)=>assert.deepEqual(a,b,`Follow API check ${++checks}`);
 const request=async(path:string,headers:Record<string,string>={},method='GET',body?:unknown)=>{
  const r=await fetch(base+path,{method,headers:{...headers,...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  if(path.includes('/creator-recognition')||path.includes('/creator-follow')||/\/users\/\d+\/follow/.test(path))eq(r.headers.get('cache-control'),'no-store');
  return {status:r.status,body:r.status===204?null:await r.json() as any};
 };
 const recognition=`/api/viewer/v1/feed/global/publications/${f.introductionSource.publicationId}/creator-recognition`;
 const path=(pub=p,space=s)=>`/api/viewer/v1/spaces/${space}/publications/${pub}/creator-follow`;
 const login=async(label:string)=>{const r=await request('/api/native/v1/session',{},'POST',f.users[label]);eq(r.status,201);tokens.push(r.body.token);return {authorization:`Bearer ${r.body.token}`};};
 try{
  const a=await login('a'),b=await login('b');
  eq((await request(recognition)).status,401);eq((await request(recognition+'?creatorId=1',a)).status,400);
  eq((await request(`/api/viewer/v1/feed/global/publications/${p}/creator-recognition`,a)).status,404);
  for(const method of ['POST','DELETE'])eq((await fetch(base+recognition,{method,headers:a})).status,404);
  eq((await request(recognition,b)).body.followingInSpaces,false);eq((await request(path())).status,401);
  const loginWeb=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(f.users.a)});eq(loginWeb.status,200);
  cookie=loginWeb.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');csrf=decodeURIComponent(/(?:^|; )csrf=([^;]+)/.exec(cookie)?.[1]||'');const web={cookie,'x-csrf-token':csrf};
  const legacy=`/api/spaces/${s}/users/${bId}/follow`,legacyProof=legacy+`?publicationId=${p}`;
  eq((await request(legacy,{cookie})).status,400);eq((await request(legacyProof,a)).status,401);
  eq((await request(legacyProof,{cookie},'POST')).status,403);eq((await request(path(),{cookie},'POST')).status,403);
  eq((await request(path(),{...a,cookie})).status,400);
  for(const proof of ['?publicationId=1&publicationId=2','?publicationId=1.0','?publicationId=1e2','?publicationId=0','?publicationId=9&x=1'])eq((await request(legacy+proof,web)).status,400);
  for(const suffix of ['?creatorId=1','?publicationId=9'])eq((await request(path()+suffix,a)).status,400);
  eq((await request(path(),a,'POST',{targetUserId:bId})).status,400);
  for(const label of ['hidden','banned'])eq((await request(path(f.publications[label],f.spaces[label]),a)).status,403);
  for(const label of ['alias','personal'])eq((await request(path(f.publications[label],f.spaces[label]),a)).status,403);
  for(const label of ['members','invisible','unpublished'])eq((await request(path(f.publications[label],f.spaces[label]),a)).status,404);
  eq((await request(path(p,f.spaces.channel),a)).status,404);
  eq((await request(`/api/spaces/${s}/users/${aId}/follow?publicationId=${p}`,web)).status,404);
  // Start the chosen exact tuples empty, preserving any prior state for restoration.
  for(const tuple of tuples)await db.query('DELETE FROM space_user_follows WHERE follower_user_id=? AND target_user_id=? AND space_id=?',tuple);
  const before=(await request(path(),a)).body;eq(before.following,false);eq(before.creatorId,bId);eq(Object.keys(before).sort(),['space','publicationId','creatorId','following','followingElsewhere','followersCount','canFollow','disabledReason'].sort());
  eq(before.followingElsewhere,false);
  const globalBefore=(await request(recognition,a)).body;eq(globalBefore,{publicationId:f.introductionSource.publicationId,creatorId:bId,followingInSpaces:false});
  for(const excluded of [f.spaces.personal,f.spaces.alias]){
   await db.query('INSERT INTO space_user_follows(follower_user_id,target_user_id,space_id) VALUES(?,?,?)',[aId,bId,excluded]);
   eq((await request(path(),a)).body.followingElsewhere,false);eq((await request(recognition,a)).body.followingInSpaces,false);
  }
  await db.query('INSERT INTO space_user_follows(follower_user_id,target_user_id,space_id) VALUES(?,?,?)',[aId,bId,f.spaces.hidden]);
  const history=(await request(path(),a)).body;eq(history.followingElsewhere,true);eq(history.following,false);eq((await request(recognition,a)).body.followingInSpaces,true);
  eq(Object.keys(history).sort(),Object.keys(before).sort());
  await db.query('DELETE FROM space_user_follows WHERE follower_user_id=? AND target_user_id=? AND space_id=?',[aId,bId,f.spaces.hidden]);
  eq((await request(recognition,a)).body.followingInSpaces,false);
  const initialCount=before.followersCount;
  await Promise.all(Array.from({length:6},async(_,i)=>eq((await request(path(i%2?f.secondPublicationId:p),a,'POST')).status,200)));
  eq((await request(path(),a)).body.followersCount,initialCount+1);eq((await request(path(f.secondPublicationId),a)).body.following,true);eq((await request(path(f.publications.channel,f.spaces.channel),a)).body.following,false);eq((await request(path(f.publications.channel,f.spaces.channel),a)).body.followingElsewhere,true);
  const self=await request(path(),b);eq((await request(recognition,a)).body.followingInSpaces,true);eq(self.body.followingElsewhere,false);eq(self.body.canFollow,false);eq(self.body.followersCount,initialCount+1);eq((await request(path(),b,'POST')).status,403);
  eq((await request(legacyProof,web,'DELETE')).body.following,false);
  await Promise.all(Array.from({length:6},async(_,i)=>eq((await request(path(i%2?f.secondPublicationId:p),a,'DELETE')).status,200)));
  eq((await request(path(),a)).body.followersCount,initialCount);eq((await request(recognition,a)).body.followingInSpaces,false);
  eq((await request(path(f.publications.channel,f.spaces.channel),a,'POST')).status,200);eq((await request(path(),a)).body.following,false);eq((await request(path(),a)).body.followingElsewhere,true);eq((await request(recognition,a)).body.followingInSpaces,true); // public non-member channel
  await db.query('UPDATE space_publications SET owner_user_id=? WHERE id=? AND space_id=?',[aId,f.secondPublicationId,s]);
  eq((await request(path(f.secondPublicationId),a)).body.creatorId,bId); // publisher is deliberately different
  await db.query('UPDATE uploads SET user_id=? WHERE id=? AND user_id=?',[aId,f.secondUploadId,bId]);
  eq((await request(path(f.secondPublicationId),a)).body.canFollow,false);eq((await request(path(f.secondPublicationId),b,'POST')).body.creatorId,aId);
  eq((await request(path(),a)).body.following,false);
  await db.query('UPDATE uploads SET user_id=? WHERE id=? AND user_id=?',[bId,f.secondUploadId,aId]);
  // Failure after relationship insert must roll back, without a partial count result.
  const originalConnection=db.getConnection.bind(db);let injected=false;
  (db as any).getConnection=async()=>{const conn=await originalConnection(),query=conn.query,release=conn.release.bind(conn);conn.query=function(sql:any,...args:any[]){
   if(!injected&&typeof sql==='string'&&sql.startsWith('SELECT')&&sql.includes('AS followersCount')){injected=true;return Promise.reject(Error('controlled post-write failure'));}
   return (query as any).call(conn,sql,...args);
  } as any;conn.release=()=>{conn.query=query;conn.release=release;release();};return conn;};
  try{eq((await request(path(),a,'POST')).status,503);}finally{db.getConnection=originalConnection;}
  eq(injected,true);eq((await request(path(),a)).body.following,false);
  await db.query('UPDATE users SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL',[bId]);eq((await request(path(),a)).status,404);eq((await request(recognition,a)).status,404);await db.query('UPDATE users SET deleted_at=NULL WHERE id=?',[bId]);
  // Follow does not grant personal entry: remove exact disposable grant, compare, restore below.
  await db.query('DELETE FROM user_space_roles WHERE user_id=? AND space_id=?',[aId,f.spaces.personal]);
  const profile=`/api/viewer/v1/creators/${bId}`;
  eq((await request(profile,a)).body.personalEntry.state,'unavailable');eq((await request(path(),a,'POST')).status,200);eq((await request(profile,a)).body.personalEntry.state,'unavailable');
  eq((await request(`/api/viewer/v1/spaces/${f.spaces.personal}/feed`,a)).status,403);
  const configured=typeof settings[0].settings==='string'?JSON.parse(settings[0].settings):settings[0].settings;
  for(const alias of [{global:true},{isGlobal:true},{feed:'global'}]){await db.query('UPDATE spaces SET settings=? WHERE id=?',[JSON.stringify({...configured,...alias}),s]);eq((await request(path(),a)).status,403);}
  await db.query('UPDATE spaces SET settings=? WHERE id=?',[typeof settings[0].settings==='string'?settings[0].settings:JSON.stringify(settings[0].settings),s]);
  const [explain]:any=await db.query('EXPLAIN SELECT COUNT(*) FROM space_user_follows WHERE space_id=? AND target_user_id=?',[s,bId]);
  fs.writeFileSync(dir+'/count-query-plan.json',JSON.stringify({plan:explain.map((r:any)=>({type:r.type,key:r.key,possibleKeys:r.possible_keys,estimatedRows:r.rows,extra:r.Extra})),note:'Uses existing space/target indexes at current owned fixture scale; no new index or broad count-cache justified by this run.'},null,2)+'\n');
  passed=true;
 }finally{
  await db.query('UPDATE users SET deleted_at=? WHERE id=?',[deleted[0].deleted_at,bId]);
  await db.query('UPDATE uploads SET user_id=? WHERE id=? AND user_id IN (?,?)',[bId,f.secondUploadId,aId,bId]);
  await db.query('UPDATE space_publications SET owner_user_id=?,visible_in_space=? WHERE id=? AND space_id=?',[originalPub[0].owner_user_id,originalPub[0].visible_in_space,f.secondPublicationId,s]);
  await db.query('UPDATE spaces SET settings=? WHERE id=?',[typeof settings[0].settings==='string'?settings[0].settings:JSON.stringify(settings[0].settings),s]);
  for(const role of roles)await db.query('INSERT IGNORE INTO user_space_roles(user_id,space_id,role_id) VALUES(?,?,?)',[role.user_id,role.space_id,role.role_id]);
  for(const entry of snapshots){await db.query('DELETE FROM space_user_follows WHERE follower_user_id=? AND target_user_id=? AND space_id=?',entry.tuple);for(const row of entry.rows)await db.query('INSERT INTO space_user_follows(follower_user_id,target_user_id,space_id,created_at) VALUES(?,?,?,?)',[...entry.tuple,row.created_at]);const [restored]:any=await db.query('SELECT created_at FROM space_user_follows WHERE follower_user_id=? AND target_user_id=? AND space_id=?',entry.tuple);eq(restored,entry.rows);}
  for(const token of tokens)await fetch(base+'/api/native/v1/session',{method:'DELETE',headers:{authorization:`Bearer ${token}`}}).catch(()=>{});
  if(cookie)await fetch(base+'/logout',{headers:{cookie},redirect:'manual'}).catch(()=>{});
  const [native]:any=await db.query('SELECT id,user_id FROM native_sessions WHERE user_id IN (?,?) AND revoked_at IS NULL AND expires_at>NOW() ORDER BY id',[aId,bId]);eq(native,existingSessions);
  const result={result:passed?'passed':'failed',checks,fixtureStateRestored:true,preexistingNativeFixtureSessionsPreserved:existingSessions.length,scope:'Actual mounted native/cookie/CSRF routes, exact source and upload creator, private/public/deleted/self/alias cases, cross-publication uniqueness, cross-space independence, Global recognition/no writes/minimal own-history/exclusions, rollback and no personal-access grant. Exact fixture rows/settings/roles/upload publisher restored.'};
  fs.writeFileSync(dir+'/summary.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));await new Promise<void>(r=>server.close(()=>r()));await db.end();
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
