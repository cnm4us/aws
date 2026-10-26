import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { buildServer } from '../src/app';
import { getPool } from '../src/db';
import { seedEngagementFixtures } from './native-engagement-fixtures';
async function main(){
 process.env.NATIVE_SESSIONS_ENABLED='1';process.env.NATIVE_ALLOW_INSECURE_LOOPBACK='1';
 const f=await seedEngagementFixtures(),db=getPool(),nonce=`plan174-${crypto.randomBytes(8).toString('hex')}:`,pub=f.publications.group,space=f.spaces.group;
 const [priorLikes]:any=await db.query('SELECT publication_id FROM publication_likes WHERE publication_id IN (?,?) AND user_id IN (?,?)',[pub,f.publications.channel,f.users.a.id,f.users.b.id]);
 if(priorLikes.length){await db.end();throw Error('fixture likes must start empty');}
 const server=buildServer().listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as any).port}`;
 const path=(p=pub,s=space)=>`/api/viewer/v1/spaces/${s}/publications/${p}`;
 let checks=0,cookie='',csrf='',suspension:number|null=null;const tokens:string[]=[];
 const eq=(a:unknown,b:unknown)=>assert.deepEqual(a,b,`engagement contract check ${++checks}`);
 const request=async(p:string,headers:Record<string,string>={},method='GET',body?:unknown)=>{
  const r=await fetch(base+p,{method,headers:{...headers,...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  if(p.startsWith('/api/viewer/'))eq(r.headers.get('cache-control'),'no-store');
  // Keep native/cookie domain comparisons independent of expiring access metadata.
  const raw=await r.json() as any;const {access,...domain}=raw;const responseBody:any=domain;return {status:r.status,body:responseBody};
 };
 const login=async(label:string)=>{const r=await request('/api/native/v1/session',{},'POST',f.users[label]);eq(r.status,201);tokens.push(r.body.token);return {authorization:`Bearer ${r.body.token}`};};
 const [initial]:any=await db.query('SELECT id,likes_count,comments_count,comments_enabled,visible_in_space FROM space_publications WHERE id IN (?,?)',[pub,f.publications.channel]);
 const [settings]:any=await db.query('SELECT settings FROM spaces WHERE id=?',[space]);
 const [existing]:any=await db.query('SELECT publication_id FROM publication_likes WHERE publication_id IN (?,?) AND user_id IN (?,?)',[pub,f.publications.channel,f.users.a.id,f.users.b.id]);
 assert.equal(existing.length,0,'fixture likes must start empty');
 let passed=false;
 try {
  eq((await request(path()+'/engagement')).status,401);const a=await login('a'),b=await login('b');
  const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(f.users.a)});eq(r.status,200);cookie=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');csrf=decodeURIComponent(/(?:^|; )csrf=([^;]+)/.exec(cookie)?.[1]||'');
  const browser={cookie,'x-csrf-token':csrf};const before=(await request(path()+'/engagement',a)).body;
  eq((await request(path()+'/engagement',{cookie})).body,before);
  for(const label of ['hidden','banned'])eq((await request(path(f.publications[label],f.spaces[label])+'/engagement',a)).status,403);
  eq((await request(path(f.publications.members,f.spaces.members)+'/engagement',a)).status,404);
  eq((await request(path(f.publications.personal,f.spaces.personal)+'/engagement',a)).status,200);
  const [personalRoles]:any=await db.query('SELECT role_id FROM user_space_roles WHERE user_id=? AND space_id=?',[f.users.a.id,f.spaces.personal]);
  try{await db.query('DELETE FROM user_space_roles WHERE user_id=? AND space_id=?',[f.users.a.id,f.spaces.personal]);eq((await request(path(f.publications.personal,f.spaces.personal)+'/engagement',a)).status,403);}
  finally{for(const role of personalRoles)await db.query('INSERT IGNORE INTO user_space_roles(user_id,space_id,role_id) VALUES(?,?,?)',[f.users.a.id,f.spaces.personal,role.role_id]);}

  eq((await request(path(f.publications.channel,f.spaces.channel)+'/engagement',a)).status,200);
  eq((await request(path(f.publications.alias,f.spaces.alias)+'/engagement',a)).status,403);
  for(const label of ['invisible','unpublished'])eq((await request(path(f.publications[label],f.spaces[label])+'/engagement',a)).status,404);
  eq((await request(path(pub,f.spaces.channel)+'/engagement',a)).status,404);
  eq((await request(path()+'/engagement',{...a,cookie})).status,400);
  eq((await request(`/api/publications/${pub}/likes`,{cookie})).status,400);
  eq((await request(`/api/publications/${pub}/likes?spaceId=${space}`,a)).status,400);
  eq((await request(`/api/publications/${pub}/likes?spaceId=${space}`,{cookie},'POST')).status,403);
  eq((await request(path()+'/like',{cookie},'POST')).status,403);
  eq((await request(path()+'/like',browser,'POST')).status,200);
  await Promise.all(Array.from({length:8},async()=>eq((await request(path()+'/like',a,'POST')).status,200)));
  eq((await request(path()+'/engagement',a)).body.likes.count,before.likes.count+1);
  await Promise.all(Array.from({length:8},async()=>eq((await request(path()+'/like',a,'DELETE')).status,200)));
  eq((await request(path()+'/engagement',a)).body.likes.count,before.likes.count);
  // Inject a post-row/count failure on the same connection; the row must roll back.
  const getConnection=db.getConnection.bind(db);let injected=false;
  (db as any).getConnection=async()=>{const conn=await getConnection(),query=conn.query;let restored=false;
   conn.query=function(sql:any,...args:any[]){if(!injected&&typeof sql==='string'&&sql.startsWith('UPDATE space_publications SET likes_count')){injected=true;conn.query=query;restored=true;return Promise.reject(Error('controlled failure'));}return (query as any).call(conn,sql,...args);} as any;
   const release=conn.release.bind(conn);conn.release=()=>{if(!restored)conn.query=query;conn.release=release;release();};return conn;};
  try{eq((await request(path()+'/like',a,'POST')).status,503);}finally{db.getConnection=getConnection;}
  eq(injected,true);eq((await request(path()+'/engagement',a)).body.likes,before.likes);
  const ids:number[]=[];
  for(let i=0;i<23;i++){const r=await request(path()+'/comments',a,'POST',{body:`${nonce}${i}`});eq(r.status,201);ids.push(r.body.item.id);eq(Object.keys(r.body.item).sort(),['id','body','createdAt','author','isMine'].sort());eq('email' in r.body.item.author,false);}
  await Promise.all(Array.from({length:6},async(_,i)=>eq((await request(path()+'/comments',a,'POST',{body:nonce+'parallel-'+i})).status,201)));
  const countBeforeRollback=(await request(path()+'/engagement',a)).body.comments.count;
  let failedComment=false;
  (db as any).getConnection=async()=>{const conn=await getConnection(),query=conn.query,release=conn.release.bind(conn);
   conn.query=function(sql:any,...args:any[]){if(!failedComment&&typeof sql==='string'&&sql.startsWith('UPDATE space_publications SET comments_count')){failedComment=true;return Promise.reject(Error('controlled comment failure'));}return (query as any).call(conn,sql,...args);} as any;
   conn.release=()=>{conn.query=query;conn.release=release;release();};return conn;};
  try{eq((await request(path()+'/comments',a,'POST',{body:nonce+'rollback'})).status,503);}finally{db.getConnection=getConnection;}
  eq(failedComment,true);eq((await request(path()+'/engagement',a)).body.comments.count,countBeforeRollback);
  const [rolledBack]:any=await db.query('SELECT id FROM publication_comments WHERE publication_id=? AND user_id=? AND body=?',[pub,f.users.a.id,nonce+'rollback']);eq(rolledBack.length,0);
  const other=await request(path(f.publications.channel,f.spaces.channel)+'/comments',b,'POST',{body:nonce+'other-space'});eq(other.status,201);
  eq((await request(`/api/publications/${pub}/comments?spaceId=${space}`,browser,'POST',{body:nonce+'bad-reply',parentId:other.body.item.id})).status,404);
  const reply=await request(`/api/publications/${pub}/comments?spaceId=${space}`,browser,'POST',{body:nonce+'reply',parentId:ids[0]});eq(reply.status,201);
  eq((await request(`/api/publications/${pub}/comments?spaceId=${space}`,browser,'POST',{body:nonce+'nested',parentId:reply.body.id})).status,404);
  const first=await request(path()+'/comments?limit=20',a);eq(first.body.items.length,20);eq(typeof first.body.nextCursor,'string');
  const second=await request(path()+'/comments?limit=20&cursor='+first.body.nextCursor,a);eq(second.body.items.length,9);
  eq((await request(path()+'/comments?cursor='+first.body.nextCursor,b)).status,400);
  eq((await request(path()+'/comments?order=oldest&cursor='+first.body.nextCursor,a)).status,400);
  const oldest=await request(path()+'/comments?order=oldest',a);eq(oldest.body.items[0].id,ids[0]);
  eq((await request(path()+'/engagement',a)).body.comments.count,before.comments.count+30);
  await db.query("INSERT INTO publication_comments(publication_id,user_id,body,status) VALUES(?,?,?,'hidden')",[pub,f.users.a.id,nonce+'hidden']);
  eq((await request(path()+'/comments?limit=50',a)).body.items.some((i:any)=>i.body.endsWith('hidden')),false);
  eq((await request(path()+'/comments',a,'POST',{body:'x',parentId:ids[0]})).status,400);
  eq((await request(path()+'/comments',a,'POST',{body:' '.repeat(5)})).status,400);
  eq((await request(path()+'/comments',a,'POST',{body:'x'.repeat(2001)})).status,400);
  eq((await request(path()+'/comments',a,'POST',{body:'x'.repeat(20_000)})).status,413);
  await db.query('UPDATE space_publications SET comments_enabled=0 WHERE id=?',[pub]);
  eq((await request(path()+'/comments',a)).status,200);eq((await request(path()+'/engagement',a)).body.comments.disabledReason,'comments_disabled');eq((await request(path()+'/comments',a,'POST',{body:nonce+'disabled'})).status,403);
  await db.query('UPDATE space_publications SET comments_enabled=? WHERE id=?',[initial.find((x:any)=>Number(x.id)===pub).comments_enabled,pub]);
  const settingsObj=typeof settings[0].settings==='string'?JSON.parse(settings[0].settings):settings[0].settings;
  await db.query('UPDATE spaces SET settings=? WHERE id=?',[JSON.stringify({...settingsObj,comments:'off'}),space]);eq((await request(path()+'/engagement',a)).body.comments.disabledReason,'comments_disabled');
  await db.query('UPDATE spaces SET settings=? WHERE id=?',[typeof settings[0].settings==='string'?settings[0].settings:JSON.stringify(settings[0].settings),space]);
  const [s]:any=await db.query("INSERT INTO suspensions(user_id,target_type,target_id,kind,degree,reason,created_by) VALUES(?,'space',?,'posting',1,?,?)",[f.users.a.id,space,nonce+'posting',f.users.b.id]);suspension=Number(s.insertId);
  eq((await request(path()+'/engagement',a)).body.comments.disabledReason,'comment_forbidden');eq((await request(path()+'/comments',a,'POST',{body:nonce+'suspended'})).status,403);
  await db.query('DELETE FROM suspensions WHERE id=? AND reason=?',[suspension,nonce+'posting']);suspension=null;
  await db.query('UPDATE space_publications SET visible_in_space=0 WHERE id=?',[pub]);eq((await request(path()+'/like',a,'POST')).status,404);eq((await request(path()+'/comments',a)).status,404);
  await db.query('UPDATE space_publications SET visible_in_space=? WHERE id=?',[initial.find((x:any)=>Number(x.id)===pub).visible_in_space,pub]);
  const expired=await login('a');await fetch(base+'/api/native/v1/session',{method:'DELETE',headers:expired});eq((await request(path()+'/engagement',expired)).status,401);
  passed=true;
 } finally {
  if(suspension)await db.query('DELETE FROM suspensions WHERE id=? AND reason=?',[suspension,nonce+'posting']);
  await db.query('UPDATE spaces SET settings=? WHERE id=?',[typeof settings[0].settings==='string'?settings[0].settings:JSON.stringify(settings[0].settings),space]);
  for(const original of initial){
   const id=Number(original.id),conn=await db.getConnection();try{await conn.beginTransaction();await conn.query('SELECT id FROM space_publications WHERE id=? FOR UPDATE',[id]);
    const [visible]:any=await conn.query("SELECT COUNT(*) AS n FROM publication_comments WHERE publication_id=? AND user_id IN (?,?) AND body LIKE ? AND status='visible' AND deleted_at IS NULL",[id,f.users.a.id,f.users.b.id,nonce+'%']);
    await conn.query('DELETE FROM publication_comments WHERE publication_id=? AND user_id IN (?,?) AND body LIKE ?',[id,f.users.a.id,f.users.b.id,nonce+'%']);
    const [liked]:any=await conn.query('DELETE FROM publication_likes WHERE publication_id=? AND user_id IN (?,?)',[id,f.users.a.id,f.users.b.id]);
    await conn.query('UPDATE space_publications SET comments_count=GREATEST(comments_count-?,0),likes_count=GREATEST(likes_count-?,0),comments_enabled=?,visible_in_space=? WHERE id=?',[Number(visible[0].n),liked.affectedRows,original.comments_enabled,original.visible_in_space,id]);await conn.commit();
   }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }
  for(const token of tokens)await fetch(base+'/api/native/v1/session',{method:'DELETE',headers:{authorization:`Bearer ${token}`}}).catch(()=>{});
  if(cookie)await fetch(base+'/logout',{headers:{cookie},redirect:'manual'}).catch(()=>{});
  const [final]:any=await db.query('SELECT id,likes_count,comments_count,comments_enabled,visible_in_space FROM space_publications WHERE id IN (?,?)',[pub,f.publications.channel]);eq(final,initial);
  const result={result:passed?'passed':'failed',checks,scope:'Mounted native/cookie routes, exact authority, explicit context/CSRF, independent publications, concurrent/no-op Like, SQL rollback, comment body/privacy/paging/parent/disabled/suspension/hidden/expiry; scoped restoration complete.',fixtureStateRestored:true,hostSessionsRevoked:true};
  fs.mkdirSync('tests/runs/api-curl/plan_174_engagement',{recursive:true});fs.writeFileSync('tests/runs/api-curl/plan_174_engagement/summary.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
  await new Promise<void>(r=>server.close(()=>r()));await db.end();
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
