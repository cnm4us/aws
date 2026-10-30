/** Isolated SQL/API qualification. Only a uniquely named disposable database is mutated. */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {once} from 'node:events';
import assert from 'node:assert/strict';
async function main(){
 const original=process.env.DB_NAME||'aws';assert.match(original,/^[a-zA-Z0-9_]+$/);
 const name=`${original}_plan188_qa_${Date.now()}`;assert.notEqual(name,original);
 const source=mysql.createPool({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',database:original,connectionLimit:2});
 const port=Number(process.env.PLAN188_QA_PORT);assert.ok(Number.isInteger(port)&&port>1024&&port!==Number(process.env.DB_PORT||3306),'Disposable QA port required');
 const admin=mysql.createPool({host:'127.0.0.1',port,user:'root',password:'',connectionLimit:1,dateStrings:true});
 let server:any,db:any;let checks=0;
 const eq=(a:unknown,b:unknown)=>{assert.deepEqual(a,b,`SQL/API check ${checks+1}`);checks++;};
 try{
  const [location]:any=await admin.query('SELECT @@datadir directory');assert.ok(String(location[0].directory).includes('/dev/shm/plan188-mariadb/'),'Disposable server required');
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.query(`USE \`${name}\``);await admin.query('SET FOREIGN_KEY_CHECKS=0');
  const [tables]:any=await source.query('SHOW FULL TABLES WHERE Table_type=\'BASE TABLE\'');const names=tables.map((r:any)=>String(Object.values(r)[0]));
  for(const table of names){assert.match(table,/^[a-zA-Z0-9_]+$/);const [ddl]:any=await source.query(`SHOW CREATE TABLE \`${table}\``);await admin.query(ddl[0]['Create Table']);}
  const f=JSON.parse(fs.readFileSync(process.env.PLAN188_FIXTURE_PATH||'/home/ubuntu/aws/.codex-local/plan175-fixtures.json','utf8'));
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
  await db.query("INSERT INTO viewer_saved_spaces(user_id,space_id,origin,removed,updated_at) VALUES(?,?,'explicit',1,'2000-01-01 00:00:00')",[users[0],f.spaces.channel]);
  const {ensureDiscoverySchema}=await import('../src/features/discovery/schema');await ensureDiscoverySchema(db);
  const [retained]:any=await db.query("SELECT DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s') changed,removed,space_type FROM viewer_saved_spaces WHERE user_id=? AND space_id=?",[users[0],f.spaces.channel]);eq(retained[0].changed,'2000-01-01 00:00:00');eq(retained[0].removed,1);eq(retained[0].space_type,'channel');await db.query('DELETE FROM viewer_saved_spaces WHERE user_id=? AND space_id=?',[users[0],f.spaces.channel]);
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

  // Plan188: source, subscription and shortcut state are independent.
  const createSpace=async(name:string,type='channel',mode='existing',listed=true)=>{
   const patch={...templateRows[0],name,slug:'qa-'+crypto.randomBytes(8).toString('hex'),ulid:crypto.randomBytes(13).toString('hex').toUpperCase(),type,owner_user_id:users[1],settings:JSON.stringify({visibility:'members_only',membership:'invite',viewerEntry:{mode,price:mode==='paid_channel'?{amountCents:500,currency:'USD',interval:'month'}:null}})};
   const [insert]:any=await db.query(`INSERT INTO spaces (${columnNames.map((c:string)=>'`'+c+'`').join(',')}) VALUES (${columnNames.map(()=>'?').join(',')})`,columnNames.map((c:string)=>patch[c]));
   const id=Number(insert.insertId);const {assignDefaultAdminRoles}=await import('../src/services/spaceMembership');const {loadSpaceOrThrow}=await import('../src/features/spaces/service');await assignDefaultAdminRoles(db,await loadSpaceOrThrow(id),users[1]);if(listed)await db.query('INSERT INTO discovery_spaces(space_id,listed) VALUES(?,1)',[id]);return id;
  };
  const {adaptCard,adaptEntry}=await import('../mobile/src/discovery/api');
  const flaggedGlobal=await createSpace('QA special global');await db.query("UPDATE spaces SET settings=JSON_SET(settings,'$.isGlobal',JSON_EXTRACT('true','$')) WHERE id=?",[flaggedGlobal]);eq((await call('/discovery/catalog?q=QA%20special')).body.items.length,0);eq((await call(`/discovery/save-v2/${flaggedGlobal}`,{saved:true})).status,404);
  const paid=await createSpace('QA paid channel','channel','paid_channel');
  const paidSearch=await call('/discovery/catalog?type=channel&q=QA%20paid');eq(paidSearch.status,200);eq(paidSearch.body.items.length,1);const pc=adaptCard(paidSearch.body.items[0]);eq(pc.id,paid);eq(pc.availability?.canView,false);eq(pc.availability?.action,'purchase_deferred');eq(pc.availability?.price?.amountCents,500);
  const anonymous=await call('/discovery/catalog?type=channel&q=QA%20paid',undefined,true);eq(anonymous.status,200);eq(anonymous.body.items[0].availability.action,'sign_in');
  eq((await call('/discovery/catalog?type=channel&q=QA%25')).body.items.length,0);
  eq((await call('/discovery/catalog?type=invalid')).status,400);
  const subCount=async()=>Number((await db.query('SELECT COUNT(*) n FROM space_subscriptions WHERE user_id=?',[users[0]]))[0][0].n),beforeSubs=await subCount();
  eq((await call(`/discovery/save-v2/${paid}`,{saved:true})).status,200);eq(await subCount(),beforeSubs);
  const savedPaid=await call('/discovery/collections?type=channel');eq(savedPaid.status,200);assert.ok(savedPaid.body.items.some((r:any)=>r.id===paid&&r.saved&&!r.availability.canView));checks++;
  eq((await call(`/spaces/${paid}/feed`)).status,403);eq((await call(`/discovery/enroll/${paid}`,{revision:'a'.repeat(64),acknowledge:false})).status,403);
  const paidEntry=await call(`/discovery/entry-v2/${paid}`);eq(paidEntry.status,200);eq(adaptEntry(paidEntry.body).space.availability?.action,'purchase_deferred');
  const privateSpace=await createSpace('QA private related','channel','existing',false);
  eq((await call('/discovery/catalog?type=channel&q=QA%20private')).body.items.length,0);
  const {assignDefaultMemberRoles}=await import('../src/services/spaceMembership');const {loadSpaceOrThrow}=await import('../src/features/spaces/service');await assignDefaultMemberRoles(db,await loadSpaceOrThrow(privateSpace),users[0]);
  eq((await call('/discovery/catalog?type=channel&q=QA%20private')).body.items[0].id,privateSpace);eq((await call('/discovery/catalog?type=channel&q=QA%20private',undefined,true)).body.items.length,0);
  await call(`/discovery/save-v2/${privateSpace}`,{saved:true});await call(`/discovery/save-v2/${privateSpace}`,{saved:false});eq((await call('/discovery/catalog?type=channel&q=QA%20private')).body.items[0].saved,false);eq((await call(`/spaces/${privateSpace}/feed`)).status,200);
  const page=await call('/discovery/catalog?type=channel&limit=1');eq(page.status,200);assert.ok(page.body.nextCursor);checks++;eq((await call('/discovery/catalog?type=channel&limit=1&q=changed&cursor='+encodeURIComponent(page.body.nextCursor))).status,400);
  const deleted=await createSpace('QA removable deleted');await call(`/discovery/save-v2/${deleted}`,{saved:true});await db.query('DELETE FROM spaces WHERE id=?',[deleted]);const deletedPage=await call('/discovery/collections?type=channel');const gone=deletedPage.body.items.find((r:any)=>r.id===deleted);assert.ok(gone?.unavailable&&gone.name==='Unavailable space');checks++;eq(adaptCard(gone).unavailable,true);eq((await call(`/discovery/save-v2/${deleted}`,{saved:false})).status,200);
  const free=await createSpace('QA free channel','channel','free_channel');await db.query("UPDATE discovery_spaces SET welcome='Read before entering' WHERE space_id=?",[free]);const entry=await call(`/discovery/entry-v2/${free}`);eq(entry.status,200);eq(entry.body.canView,false);eq(entry.body.space.availability.action,'subscribe_free');eq(entry.body.requiresAcknowledgment,true);
  eq((await call(`/discovery/enroll/${free}`,{revision:entry.body.revision,acknowledge:false})).status,428);eq((await call(`/discovery/enroll/${free}`,{revision:entry.body.revision,acknowledge:true})).status,200);eq((await call(`/discovery/enroll/${free}`,{revision:entry.body.revision,acknowledge:true})).status,200);
  const freeEntry=await call(`/discovery/entry-v2/${free}`);eq(freeEntry.body.canView,true);eq(freeEntry.body.requiresAcknowledgment,false);eq(freeEntry.body.space.saved,false);eq((await call(`/spaces/${free}/feed`)).status,200);
  const subs=await call('/discovery/subscriptions');eq(subs.status,200);assert.ok(subs.body.items.some((r:any)=>r.id===free&&r.kind==='Free subscription'&&!r.space.saved));checks++;eq(subs.body.purchasesAvailable,false);eq((await call('/discovery/subscriptions',undefined,true)).status,401);eq((await call('/discovery/subscriptions/999999999/cancel',{})).status,404);
  const group=await createSpace('QA open group','group','open_group');const ge=await call(`/discovery/entry-v2/${group}`);eq((await call(`/discovery/enroll/${group}`,{revision:ge.body.revision,acknowledge:false})).status,200);eq((await call(`/discovery/entry-v2/${group}`)).body.space.saved,false);
  const [privilege]:any=await db.query("SELECT 1 FROM user_space_roles u JOIN roles r ON r.id=u.role_id WHERE u.user_id=? AND u.space_id=? AND r.name IN ('space_admin','group_admin')",[users[0],group]);eq(privilege.length,0);
  const invited=await createSpace('QA invitation','group','invitation',false);await db.query("INSERT INTO space_invitations(space_id,invitee_user_id,inviter_user_id,status) VALUES(?,?,?,'pending')",[invited,users[0],users[1]]);const ie=await call(`/discovery/entry-v2/${invited}`);eq(ie.status,200);eq(ie.body.space.availability.action,'accept_invitation');eq((await call(`/discovery/enroll/${invited}`,{revision:ie.body.revision,acknowledge:false})).status,200);eq((await call(`/discovery/entry-v2/${invited}`)).body.canView,true);
  const {options}=await import('../src/features/discovery/catalog');eq(options({viewerEntry:{mode:'paid_channel',price:{amountCents:-1,currency:'USD',interval:'month'}}},'channel').price,null);

  const catalogDomain=await import('../src/features/discovery/catalog');
  await assert.rejects(()=>catalogDomain.updateOptions(String(paid),users[0],{mode:'free_channel',price:null}),(e:any)=>e.status===403);checks++;
  await catalogDomain.updateOptions(String(paid),users[1],{mode:'paid_channel',price:{amountCents:700,currency:'USD',interval:'year'}});eq((await call(`/discovery/entry-v2/${paid}`)).body.space.availability.price.interval,'year');
  await assert.rejects(()=>catalogDomain.updateOptions(String(group),users[1],{mode:'free_channel',price:null}),(e:any)=>e.status===400);checks++;
  const afterSave=await call('/discovery/recent-v2');eq(afterSave.status,200);
  await db.query("INSERT INTO payment_provider_configs(provider,mode,status,donate_enabled,subscribe_enabled,credentials_json) VALUES('paypal','sandbox','enabled',0,1,'{}')");
  const supportIds:number[]=[];for(let n=0;n<22;n++){const [insert]:any=await db.query("INSERT INTO payment_subscriptions(provider,mode,provider_subscription_id,status,user_id,currency) VALUES('paypal','sandbox',?,'active',?,'USD')",['I-TEST-QA-'+n,users[0]]);supportIds.push(Number(insert.insertId));}
  const supportPage=await call('/discovery/subscriptions');eq(supportPage.status,200);eq(supportPage.body.support.length,20);assert.ok(supportPage.body.nextCursor);checks++;eq(supportPage.body.support[0].canCancel,true);
  const moreSupport=await call('/discovery/subscriptions?cursor='+encodeURIComponent(supportPage.body.nextCursor));eq(moreSupport.status,200);eq(moreSupport.body.support.length,2);eq(moreSupport.body.nextCursor,null);
  const savedBeforeCancel=(await call('/discovery/collections?type=all')).body.items.map((r:any)=>r.id);
  eq((await call(`/discovery/subscriptions/${supportIds[0]}/cancel`,{})).status,200);eq((await call('/discovery/subscriptions')).body.support[0].pendingAction,'cancel');eq((await call('/discovery/collections?type=all')).body.items.map((r:any)=>r.id),savedBeforeCancel);
  const [other]:any=await db.query("INSERT INTO payment_subscriptions(provider,mode,provider_subscription_id,status,user_id,currency) VALUES('paypal','sandbox','I-TEST-QA-OTHER','active',?,'USD')",[users[1]]);eq((await call(`/discovery/subscriptions/${other.insertId}/cancel`,{})).status,404);
  await db.query('DELETE FROM viewer_discovery_migrations WHERE user_id=?',[users[1]]);eq(Number((await db.query('SELECT COUNT(*) n FROM viewer_saved_spaces WHERE user_id=?',[users[1]]))[0][0].n),0);await catalogDomain.home(users[1]);eq(Number((await db.query('SELECT COUNT(*) n FROM viewer_saved_spaces WHERE user_id=?',[users[1]]))[0][0].n),0);
  const paidFilter=(await call('/discovery/catalog?payment=paid&q=QA')).body.items;eq(paidFilter.length,1);eq(paidFilter[0].id,paid);const freeFilter=(await call('/discovery/catalog?payment=free&q=QA')).body.items;eq(freeFilter.length,1);eq(freeFilter[0].id,free);
  let browserChecks=0;
  if(process.env.PLAN188_WEB==='1'){
   await db.query('UPDATE discovery_state SET native_catalog=1 WHERE id=1');
   const {chromium}=await import('playwright');const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
   try{const context=await browser.newContext({extraHTTPHeaders:{authorization:`Bearer ${token}`},viewport:{width:390,height:844}});const page=await context.newPage();const browserErrors:string[]=[],responses:{path:string;status:number}[]=[];page.on('pageerror',e=>browserErrors.push(e.message));page.on('response',async r=>{responses.push({path:new URL(r.url()).pathname,status:r.status()});if(r.status()>=500&&new URL(r.url()).pathname.startsWith('/app/assets/'))fs.writeFileSync('.codex-local/plan188-browser-asset-error.txt',await r.text(),{mode:0o600});});
    const host=base.replace('/api/viewer/v1','');await context.route('**/*',async route=>{if(new URL(route.request().url()).origin===host){const headers={...route.request().headers()};delete headers.origin;await route.continue({headers});}else await route.continue();});await page.goto(host+'/channels?q=QA%20paid');try{await page.getByRole('heading',{name:'Channels',exact:true}).waitFor({timeout:8000});}catch(e){fs.writeFileSync('.codex-local/plan188-browser-diagnostics.json',JSON.stringify({browserErrors,responses}),{mode:0o600});fs.writeFileSync('.codex-local/plan188-browser-failure.txt',await page.locator('body').innerText(),{mode:0o600});await page.screenshot({path:'.codex-local/plan188-browser-failure.png',fullPage:true});throw e;}browserChecks++;
    const paidCard=page.locator(`[data-space-id="${paid}"]`);await paidCard.getByRole('checkbox').waitFor();assert.equal(await paidCard.getByRole('checkbox').isChecked(),true);browserChecks++;
    try{await paidCard.getByRole('checkbox').click();await page.getByRole('status').filter({hasText:'Removed'}).waitFor({timeout:8000});}catch(e){fs.writeFileSync('.codex-local/plan188-browser-save-diagnostics.json',JSON.stringify({browserErrors,responses,body:await page.locator('body').innerText(),error:String(e)}),{mode:0o600});throw e;}browserChecks++;eq(await subCount(),beforeSubs+1);
    await paidCard.getByRole('link',{name:'Open QA paid channel',exact:true}).click();await page.getByRole('heading',{name:'QA paid channel',exact:true}).waitFor();await page.getByText('Purchases are not available yet.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Enter space',exact:true}).count(),0);assert.equal(await page.locator('video').count(),0);browserChecks+=3;
    await page.getByRole('button',{name:'Save to Your Spaces',exact:true}).click();await page.getByRole('button',{name:'Remove from Your Spaces',exact:true}).waitFor();browserChecks++;
    await page.getByRole('link',{name:'Your Spaces',exact:true}).click();await page.locator(`[data-space-id="${paid}"]`).waitFor();browserChecks++;assert.equal(await page.locator(`[data-space-id="${paid}"]`).getByRole('checkbox').isChecked(),true);browserChecks++;
    await page.getByRole('link',{name:'Browse Channels',exact:true}).click();await page.getByRole('textbox',{name:'Search spaces',exact:true}).fill('QA private');await page.getByRole('button',{name:'Search',exact:true}).click();await page.locator(`[data-space-id="${privateSpace}"]`).waitFor();browserChecks++;assert.equal(await page.locator(`[data-space-id="${paid}"]`).count(),0);browserChecks++;
    await page.screenshot({path:'tests/runs/build/plan_188/web-browse-related.png',fullPage:true});
    await page.goto(host+'/discover');await page.getByRole('link',{name:'Browse Groups',exact:true}).waitFor();await page.getByRole('link',{name:'Browse Channels',exact:true}).waitFor();browserChecks+=2;
    await context.close();
   }finally{await browser.close();}
  }
  console.log(JSON.stringify({suite:'isolated discovery/aggregate SQL/API',passed:checks,browserChecks,originalDatabaseUnmodified:true,disposableDatabase:true}));
 }finally{try{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));if(db)await db.end();await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);}finally{await Promise.allSettled([admin.end(),source.end()]);}}
}
main().catch(e=>{console.error(JSON.stringify({failed:true,code:e?.code||e?.name,site:e?.stack?.match(/check-discovery-catalog-sql\.ts:\d+:\d+/)?.[0],detail:e?.sqlMessage?.match(/(?:Table '[^']+'|Unknown column '[^']+')/)?.[0],message:e?.name==='ApiError'||e?.message?.startsWith('SQL/API check')?e.message:'Inspect private SQL qualification log/source; credentials are not printed.'}));process.exitCode=1;});
