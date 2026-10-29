/** Isolated SQL/API qualification. Only a uniquely named disposable database is mutated. */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {once} from 'node:events';
import assert from 'node:assert/strict';
async function main(){
 const original=process.env.DB_NAME||'aws';assert.match(original,/^[a-zA-Z0-9_]+$/);
 const name=`${original}_plan187_qa_${Date.now()}`;assert.notEqual(name,original);
 const source=mysql.createPool({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',database:original,connectionLimit:2});
 const port=Number(process.env.PLAN187_QA_PORT);assert.ok(Number.isInteger(port)&&port>1024&&port!==Number(process.env.DB_PORT||3306),'Disposable QA port required');
 const admin=mysql.createPool({host:'127.0.0.1',port,user:'root',password:'',connectionLimit:1,dateStrings:true});
 let server:any,db:any;let checks=0;
 const eq=(a:unknown,b:unknown)=>{assert.deepEqual(a,b,`SQL/API check ${checks+1}`);checks++;};
 try{
  const [location]:any=await admin.query('SELECT @@datadir directory');assert.ok(String(location[0].directory).includes('/dev/shm/plan187-mariadb/'),'Disposable server required');
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.query(`USE \`${name}\``);await admin.query('SET FOREIGN_KEY_CHECKS=0');
  const [tables]:any=await source.query('SHOW FULL TABLES WHERE Table_type=\'BASE TABLE\'');const names=tables.map((r:any)=>String(Object.values(r)[0]));
  for(const table of names){assert.match(table,/^[a-zA-Z0-9_]+$/);const [ddl]:any=await source.query(`SHOW CREATE TABLE \`${table}\``);await admin.query(ddl[0]['Create Table']);}
  const f=JSON.parse(fs.readFileSync(process.env.PLAN187_FIXTURE_PATH||'/home/ubuntu/aws/.codex-local/plan175-fixtures.json','utf8'));
  const users=[f.users.a.id,f.users.b.id].map(Number),spaceIds=Object.values(f.spaces).map(Number).filter(Number.isSafeInteger);
  const [global]:any=await source.query("SELECT id FROM spaces WHERE slug IN ('global','global-feed') ORDER BY slug='global' DESC LIMIT 1");spaceIds.push(Number(global[0].id));
  const copy=async(table:string,where:string,args:any[]=[])=>{if(!names.includes(table))return;const [rows]:any=await source.query(`SELECT * FROM \`${table}\` WHERE ${where}`,args);if(!rows.length)return;const [definitions]:any=await source.query(`SHOW COLUMNS FROM \`${table}\``);const columns=definitions.filter((c:any)=>!String(c.Extra).includes('GENERATED')).map((c:any)=>c.Field);await admin.query(`INSERT IGNORE INTO \`${table}\` (${columns.map((c:string)=>'`'+c+'`').join(',')}) VALUES ?`,[rows.map((r:any)=>columns.map((c:string)=>r[c]))]);};
  for(const table of ['roles','permissions','role_permissions','cultures','culture_categories','rules','rule_versions','discovery_state','discovery_genres'])await copy(table,'1=1');
  await copy('users','id IN (?)',[users]);await copy('profiles','user_id IN (?)',[users]);await copy('spaces','id IN (?)',[spaceIds]);
  await copy('uploads','user_id IN (?)',[users]);await copy('productions','user_id IN (?)',[users]);
  await copy('space_publications','upload_id IN (SELECT id FROM uploads WHERE user_id IN (?))',[users]);
  for(const table of ['space_memberships','space_members','space_subscriptions','space_bans','user_roles','user_global_roles'])if(names.includes(table)){
   const [columns]:any=await source.query(`SHOW COLUMNS FROM \`${table}\``);if(columns.some((c:any)=>c.Field==='user_id'))await copy(table,'user_id IN (?)',[users]);
  }
  for(const table of ['discovery_spaces','discovery_placements','space_cultures'])await copy(table,'space_id IN (?)',[spaceIds]);
  // Build two synthetic creator streams from existing public test-media metadata only.
  const [media]:any=await source.query(`SELECT MIN(sp.id) publication_id,u.id upload_id,p.id production_id FROM space_publications sp JOIN uploads u ON u.id=sp.upload_id JOIN productions p ON p.id=sp.production_id WHERE sp.space_id=? AND sp.status='published' AND u.status='completed' AND p.ulid IS NOT NULL GROUP BY u.id,p.id ORDER BY MIN(sp.id) LIMIT 2`,[global[0].id]);
  assert.equal(media.length,2,'Two public media fixtures required');
  for(let index=0;index<2;index++){const m=media[index];await copy('uploads','id=?',[m.upload_id]);await copy('productions','id=?',[m.production_id]);await copy('space_publications','id=?',[m.publication_id]);
   await admin.query('UPDATE uploads SET user_id=? WHERE id=?',[users[index],m.upload_id]);await admin.query('UPDATE productions SET user_id=? WHERE id=?',[users[index],m.production_id]);
   await admin.query("UPDATE space_publications SET space_id=?,owner_user_id=?,visibility='inherit',visible_in_space=1,visible_in_global=0,published_at=NOW() WHERE id=?",[index?f.spaces.group:f.spaces.channel,users[index],m.publication_id]);
  }
  process.env.DB_NAME=name;process.env.DB_HOST='127.0.0.1';process.env.DB_PORT=String(port);process.env.DB_USER='root';process.env.DB_PASSWORD='';process.env.NATIVE_SESSIONS_ENABLED='1';process.env.NATIVE_ALLOW_INSECURE_LOOPBACK='1';
  const {getPool}=await import('../src/db');db=getPool();eq((await db.query('SELECT DATABASE() name'))[0][0].name,name);
  const {ensureDiscoverySchema}=await import('../src/features/discovery/schema');await ensureDiscoverySchema(db);
  await db.query('UPDATE discovery_state SET native_home=1,native_destinations=1 WHERE id=1');
  await db.query("UPDATE spaces SET settings=JSON_SET(COALESCE(settings,'{}'),'$.visibility','public') WHERE type IN ('group','channel')");
  if(names.includes('space_bans'))await db.query('DELETE FROM space_bans');await db.query('UPDATE discovery_spaces SET welcome=NULL,entry_enabled=0');
  const clonePublication=async(id:number,spaceId:number,owner:number)=>{
   const [rows]:any=await db.query('SELECT * FROM space_publications WHERE id=?',[id]),row={...rows[0],space_id:spaceId,owner_user_id:owner,visible_in_global:spaceId===Number(global[0].id)?1:0,visible_in_space:1};
   const [columns]:any=await db.query('SHOW COLUMNS FROM space_publications');const names=columns.filter((c:any)=>c.Field!=='id'&&!String(c.Extra).includes('GENERATED')).map((c:any)=>c.Field);
   const [insert]:any=await db.query(`INSERT INTO space_publications (${names.map((c:string)=>'`'+c+'`').join(',')}) VALUES (${names.map(()=>'?').join(',')})`,names.map((c:string)=>row[c]));return Number(insert.insertId);
  };
  await db.query('UPDATE spaces SET owner_user_id=? WHERE id=?',[users[0],f.spaces.personal]);
  const ownGlobal=await clonePublication(Number(media[0].publication_id),Number(global[0].id),users[0]);
  const ownPersonal=await clonePublication(Number(media[0].publication_id),Number(f.spaces.personal),users[0]);
  const otherChannel=await clonePublication(Number(media[1].publication_id),Number(f.spaces.channel),users[1]);
  const token=`nv1_${crypto.randomBytes(32).toString('hex')}`;
  await db.query('INSERT INTO native_sessions(user_id,token_hash,credential_hash,expires_at) SELECT id,?,UNHEX(SHA2(password_hash,256)),DATE_ADD(NOW(),INTERVAL 1 DAY) FROM users WHERE id=?',[crypto.createHash('sha256').update(token).digest(),users[0]]);
  const {buildServer}=await import('../src/app');server=buildServer().listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/api/viewer/v1`;
  const {adaptViewerFeedPage}=await import('../mobile/src/feed/adaptFeed');const {stampResponse}=await import('../mobile/src/auth/accessProof');const {AccessManager}=await import('../mobile/src/auth/accessManager');const manager=new AccessManager(()=>users[0]);
  const call=async(path:string,body?:any,anonymous=false)=>{const ticket=manager.ticket();const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...(anonymous?{}:{authorization:`Bearer ${token}`}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();stampResponse(value,ticket);return {status:response.status,body:value as any};};
  eq((await call('/discovery/config')).body.nativeDestinationsEnabled,true);
  eq((await call('/feed/following',undefined,true)).status,401);
  const [pubs]:any=await db.query(`SELECT sp.id,sp.space_id,u.user_id FROM space_publications sp JOIN uploads u ON u.id=sp.upload_id JOIN spaces s ON s.id=sp.space_id WHERE sp.status='published' AND sp.visible_in_space=1 AND s.type IN ('group','channel') AND s.id<>? AND sp.visibility<>'members' AND u.user_id=? ORDER BY sp.id LIMIT 1`,[global[0].id,users[1]]);
  const [own]:any=await db.query("SELECT sp.id FROM space_publications sp JOIN uploads u ON u.id=sp.upload_id WHERE sp.status='published' AND u.user_id=? ORDER BY sp.id LIMIT 1",[users[0]]);
  assert.ok(pubs.length&&own.length,'Expected retained published fixture media');checks++;
  const publication=pubs[0];
  await db.query('INSERT INTO space_user_follows(follower_user_id,target_user_id,space_id) VALUES(?,?,?)',[users[0],users[1],publication.space_id]);
  const following=await call('/feed/following');eq(following.status,200);const nativeFollowing=adaptViewerFeedPage(following.body,{kind:'following'});manager.seedPage(nativeFollowing);assert.ok(nativeFollowing.items.every(i=>manager.aggregateValid('following',i)));checks++;assert.ok(following.body.items.some((i:any)=>i.publicationId===Number(publication.id)));checks++;
  for(const item of following.body.items){eq(item.creator.id,users[1]);eq(item.spaceId,Number(publication.space_id));eq(item.sourceContext.spaceId,Number(publication.space_id));}
  eq((await call(`/feed/following?publicationIds=${otherChannel}`)).body.items,[]);
  eq(following.body.aggregateAccess.kind,'following');eq(following.body.access.identity.viewerId,users[0]);assert.ok(following.body.sourcePages.length);checks++;
  const creations=await call('/feed/creations');eq(creations.status,200);const nativeCreations=adaptViewerFeedPage(creations.body,{kind:'creations'});manager.seedPage(nativeCreations);assert.ok(nativeCreations.items.every(i=>manager.aggregateValid('creations',i)));checks++;assert.ok(creations.body.items.length);checks++;for(const item of creations.body.items)eq(item.creator.id,users[0]);
  eq(creations.body.items.length,1);eq(creations.body.items[0].publicationId,ownPersonal);
  const creation=creations.body.items.find((i:any)=>i.productionUlid);assert.ok(creation);checks++;
  const contexts=await call(`/feed/creations/publications/${creation.publicationId}/contexts`);eq(contexts.status,200);eq(contexts.body.items.length,3);assert.ok(contexts.body.items.some((i:any)=>i.publicationId===creation.publicationId));checks++;
  eq((await call(`/feed/creations/publications/${publication.id}/contexts`)).status,404);
  const cp={publicationId:creation.publicationId,productionUlid:creation.productionUlid,spaceId:creation.spaceId,positionSeconds:0,userPaused:true};
  eq((await call('/me/feed-checkpoints/creations',{revision:0,checkpoint:cp})).status,200);
  const restored=await call('/me/feed-checkpoints/creations');eq(restored.status,200);eq(restored.body.outcome,'restored');eq(restored.body.checkpoint.userPaused,true);
  eq((await call('/me/feed-checkpoints/creations',{revision:0,checkpoint:cp})).status,409);
  eq((await call('/me/feed-checkpoints/following')).body.outcome,'new');
  const fi=following.body.items[0],fc={publicationId:fi.publicationId,productionUlid:fi.productionUlid,spaceId:fi.spaceId,positionSeconds:0,userPaused:false};
  const races=await Promise.all([call('/me/feed-checkpoints/following',{revision:0,checkpoint:fc}),call('/me/feed-checkpoints/following',{revision:0,checkpoint:fc})]);eq(races.map(r=>r.status).sort(),[200,409]);
  await db.query('INSERT INTO viewer_saved_spaces(user_id,space_id,origin,removed) VALUES(?,?,\'explicit\',0)',[users[0],publication.space_id]);
  const [savedSpace]:any=await db.query('SELECT type FROM spaces WHERE id=?',[publication.space_id]);
  const [templateRows]:any=await db.query('SELECT * FROM spaces WHERE id=?',[f.spaces.group]);const [spaceColumns]:any=await db.query('SHOW COLUMNS FROM spaces');const columnNames=spaceColumns.filter((c:any)=>c.Field!=='id'&&!String(c.Extra).includes('GENERATED')).map((c:any)=>c.Field);
  for(let index=0;index<208;index++){const patch={...templateRows[0],name:`Collection fixture ${index}`,slug:`collection-fixture-${index}`,ulid:crypto.randomBytes(13).toString('hex').toUpperCase(),type:index<205?'channel':'group',owner_user_id:users[0]};
   const [insert]:any=await db.query(`INSERT INTO spaces (${columnNames.map((c:string)=>'`'+c+'`').join(',')}) VALUES (${columnNames.map(()=>'?').join(',')})`,columnNames.map((c:string)=>patch[c]));await db.query("INSERT INTO viewer_saved_spaces(user_id,space_id,origin,removed,updated_at) VALUES(?,?,'explicit',0,?)",[users[0],insert.insertId,index<205?'2026-10-29 00:00:00':'2000-01-01 00:00:00']);
  }
  const firstGroup=await call('/discovery/saved?type=group&limit=1');eq(firstGroup.status,200);eq(firstGroup.body.items.length,1);assert.ok(firstGroup.body.nextCursor);checks++;
  const secondGroupBefore=await call(`/discovery/saved?type=group&limit=1&cursor=${encodeURIComponent(firstGroup.body.nextCursor)}`);eq(secondGroupBefore.status,200);eq(secondGroupBefore.body.items.length,1);
  await db.query('UPDATE viewer_saved_spaces SET removed=1 WHERE user_id=? AND space_id=?',[users[0],firstGroup.body.items[0].id]);
  const secondGroupAfter=await call(`/discovery/saved?type=group&limit=1&cursor=${encodeURIComponent(firstGroup.body.nextCursor)}`);eq(secondGroupAfter.body.items[0].id,secondGroupBefore.body.items[0].id);
  const typed=await call(`/discovery/saved?type=${savedSpace[0].type}&limit=1`);eq(typed.status,200);eq(typed.body.global,undefined);eq(typed.body.personal,undefined);assert.ok(typed.body.items.every((i:any)=>i.type===savedSpace[0].type&&!i.global));checks++;
  const legacy=await call('/discovery/saved');eq(legacy.status,200);assert.ok('global'in legacy.body&&'personal'in legacy.body);checks++;
  eq((await call('/discovery/saved?type=personal')).status,400);eq((await call('/discovery/saved?type=group&cursor='+encodeURIComponent('group:'+Buffer.from(JSON.stringify({time:'2026-99-99 00:00:00',id:1})).toString('base64url')))).status,400);eq((await call('/discovery/saved?type=group&cursor=channel:bad')).status,400);
  await db.query("INSERT INTO suspensions(user_id,target_type,target_id,kind,degree,starts_at,ends_at) VALUES(?,'space',?,'ban',1,NOW(),DATE_ADD(NOW(),INTERVAL 1 DAY))",[users[0],publication.space_id]);
  eq((await call(`/feed/following?publicationIds=${publication.id}`)).body.items,[]);
  eq((await call(`/discovery/saved?type=${savedSpace[0].type}`)).body.items.some((i:any)=>i.id===Number(publication.space_id)),false);
  await db.query('DELETE FROM suspensions');
  await db.query("INSERT INTO discovery_spaces(space_id,listed,welcome,entry_enabled) VALUES(?,0,'New policy',1) ON DUPLICATE KEY UPDATE welcome='New policy',entry_enabled=1",[publication.space_id]);
  const gated=await call('/feed/following');eq(gated.body.items.length,0);eq(gated.body.reviewRequired[0].id,Number(publication.space_id));
  await db.query('UPDATE discovery_spaces SET welcome=NULL,entry_enabled=0');
  await db.query('DELETE FROM space_user_follows WHERE follower_user_id=?',[users[0]]);eq((await call(`/feed/following?publicationIds=${publication.id}`)).body.items,[]);
  const anchored=await call(`/feed/following?anchorPublicationId=${publication.id}`);eq(anchored.status,200);eq(anchored.body.resume.outcome,'unavailable');
  manager.invalidate();
  console.log(JSON.stringify({suite:'isolated real SQL/API',passed:checks,originalDatabaseUnmodified:true,disposableDatabase:true}));
 }finally{try{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));if(db)await db.end();await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);}finally{await Promise.allSettled([admin.end(),source.end()]);}}
}
main().catch(e=>{console.error(JSON.stringify({failed:true,code:e?.code||e?.name,site:e?.stack?.match(/check-aggregate-sql\.ts:\d+:\d+/)?.[0],detail:e?.sqlMessage?.match(/(?:Table '[^']+'|Unknown column '[^']+')/)?.[0],message:e?.name==='ApiError'||e?.message?.startsWith('SQL/API check')?e.message:'Inspect private SQL qualification log/source; credentials are not printed.'}));process.exitCode=1;});
