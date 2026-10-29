import type { PoolConnection } from 'mysql2/promise';
import { getPool, type Queryable } from '../../db';
import { ViewerApiError } from '../native-sessions/service';
import * as spaces from '../spaces/service';
import * as spaceRepo from '../spaces/repo';
import { can } from '../../security/permissions';
import { PERM } from '../../security/perm';
import { publicCulture, readerText, readerRevision, issueReceipt, validReceipt } from './policy';
import { spacePath } from './paths';
import * as feeds from '../feeds/service';

type Db=Queryable;
const rows=async(db:Db,sql:string,args:any[]=[])=>{const [value]=await db.query(sql,args);return value as any[];};
export const positiveId=(v:unknown)=>{const n=Number(v);if(!/^[1-9]\d*$/.test(String(v))||!Number.isSafeInteger(n))throw new ViewerApiError(400,'invalid_query');return n;};
const parse=(v:any)=>{try{return typeof v==='string'?JSON.parse(v):v||{};}catch{return {};}};
export async function config(db:Db=getPool()) {
  const [state]=await rows(db,'SELECT root_home,native_home,native_destinations FROM discovery_state WHERE id=1');
  return {schemaVersion:1,homeEnabled:!!state?.root_home,nativeHomeEnabled:!!state?.native_home,nativeDestinationsEnabled:!!state?.native_destinations};
}
export async function resolveSpace(key:string,userId:number|null,db:Db=getPool()) {
  let value:any;
  if(key==='global')value=await spaceRepo.findGlobalSpaceCandidate(db);
  else if(key==='personal'&&userId)value=await spaceRepo.personalSpaceByOwner(userId,db);
  else if(/^[1-9]\d*$/.test(key))value=(await rows(db,'SELECT * FROM spaces WHERE id=?',[positiveId(key)]))[0];
  else {
    const match=/^(group|channel):(.{1,255})$/.exec(key);
    if(match)value=(await rows(db,'SELECT * FROM spaces WHERE type=? AND slug=?',[match[1],match[2]]))[0];
  }
  if(!value)throw new ViewerApiError(404,'space_not_found');
  const space=await spaces.loadSpaceOrThrow(Number(value.id),db);
  const [listing]=await rows(db,'SELECT * FROM discovery_spaces WHERE space_id=?',[space.id]);
  const globalCandidate=key==='global'?value:await spaceRepo.findGlobalSpaceCandidate(db);
  const global=Number(globalCandidate?.id)===space.id && (['global','global-feed'].includes(globalCandidate.slug)
    || parse(globalCandidate.settings).global===true||parse(globalCandidate.settings).isGlobal===true||parse(globalCandidate.settings).feed==='global');
  if(key==='global'&&!global)throw new ViewerApiError(503,'global_unavailable');
  const view=userId ? global ? !await spaceRepo.isBannedFromSpace(space.id,userId,db) : await spaces.canViewSpaceFeed(space,userId,db) : global;
  if(!global&&!listing?.listed&&!view)throw new ViewerApiError(404,'space_not_found');
  return {space:{...value,...space},listing:listing||{},global,canView:view,requiresSignIn:!userId&&!global};
}
export type SpaceCard={id:number;name:string;slug:string;type:'group'|'channel'|'personal';global:boolean;path:string;description:string|null;artworkUrl:string|null;saved:boolean;requiresSignIn:boolean};
function card(row:any,userId:number|null,global=false):SpaceCard {
  const settings=parse(row.settings);
  return {id:Number(row.id),name:global?'Global':String(row.name),slug:String(row.slug),type:row.type,global,path:spacePath(row,global),
    description:typeof settings.discoveryDescription==='string'?readerText(settings.discoveryDescription).slice(0,500)||null:null,
    artworkUrl:row.artwork_url||`/images/discovery/${global?'global':row.type==='personal'?'personal':row.type==='group'?'group':'channel'}-v1.jpg`,saved:!!row.saved,requiresSignIn:!global&&!userId};
}
export async function directory(userId:number|null,query:{genre?:string;type?:string;cursor?:string;limit?:string},db:Db=getPool()) {
  const limit=query.limit===undefined?20:positiveId(query.limit);if(limit>50)throw new ViewerApiError(400,'invalid_query');
  const offset=query.cursor===undefined?0:Number(query.cursor);if(!Number.isSafeInteger(offset)||offset<0||offset>10000)throw new ViewerApiError(400,'invalid_query');
  if(query.type&&!['group','channel'].includes(query.type))throw new ViewerApiError(400,'invalid_query');
  const genres=await rows(db,'SELECT id,slug,name FROM discovery_genres WHERE published=1 ORDER BY sort_order,id');
  const genre=query.genre?genres.find(g=>g.slug===query.genre):null;
  if(query.genre&&!genre)throw new ViewerApiError(404,'genre_not_found');
  const where=['d.listed=1',"s.type IN ('group','channel')","(s.type <> 'channel' OR s.slug NOT IN ('global','global-feed'))"];
  const args:any[]=[userId||0];
  if(genre){where.push('p.genre_id=?');args.push(genre.id);}
  if(query.type){where.push('s.type=?');args.push(query.type);}
  // Listing is an explicit curator publication. It publishes only the teaser, never feed authority or media.
  const data=await rows(db,`SELECT DISTINCT s.id,s.name,s.slug,s.type,s.settings,d.artwork_url,COALESCE(v.removed=0,0) AS saved
    FROM discovery_spaces d JOIN spaces s ON s.id=d.space_id
    LEFT JOIN viewer_saved_spaces v ON v.space_id=s.id AND v.user_id=?
    ${genre?'JOIN discovery_placements p ON p.space_id=s.id':''}
    WHERE ${where.join(' AND ')} ORDER BY s.name,s.id LIMIT ? OFFSET ?`,[...args,limit+1,offset]);
  return {schemaVersion:1,genres:genres.map(g=>({slug:g.slug,name:g.name})),genre:genre?{slug:genre.slug,name:genre.name}:null,
    items:data.slice(0,limit).map(r=>card(r,userId)),nextCursor:data.length>limit?String(offset+limit):null};
}
export async function home(userId:number|null,db:Db=getPool()) {
  if(userId)await migrateSaved(userId);
  const data=await directory(userId,{limit:'50'},db);
  // Six bounded genre queries avoid a single first-page cap hiding later categories.
  const sections=[];
  for(const genre of data.genres.slice(0,6)) {
    const page=await directory(userId,{genre:genre.slug,limit:'12'},db);
    sections.push({...genre,items:page.items,more:!!page.nextCursor});
  }
  const global=await resolveSpace('global',userId,db);
  return {...await config(db),global:card({...global.space,...global.listing},userId,true),genres:sections,
    recent:userId?await recent(userId,db):[],recentFeeds:userId?await recentFeeds(userId,db):[],signedIn:!!userId};
}
export async function publicPolicy(key:string,userId:number|null,db:Db=getPool()) {
  const resolved=await resolveSpace(key,userId,db),id=resolved.space.id;
  const cultures=await rows(db,`SELECT c.id,c.name,c.description,c.definition_json FROM cultures c
    JOIN space_cultures sc ON sc.culture_id=c.id WHERE sc.space_id=? ORDER BY c.id`,[id]);
  // Actual assigned category policy plus site safety; deliberately excludes Show all/reporting groups.
  const rules=await rows(db,`SELECT DISTINCT r.id,r.slug,r.title,rv.id AS versionId,rv.version,rv.short_description,rv.markdown,
      rv.allowed_examples_markdown,rv.disallowed_examples_markdown FROM rules r
    JOIN rule_versions rv ON rv.id=r.current_version_id
    WHERE r.visibility IN (${userId?"'public','authenticated'":"'public'"}) AND
      (rv.issue_class='global_safety' OR EXISTS (SELECT 1 FROM space_cultures sc JOIN culture_categories cc ON cc.culture_id=sc.culture_id
        WHERE sc.space_id=? AND cc.category_id=r.category_id)) ORDER BY r.id`,[id]);
  const document={name:resolved.global?'Global':String(resolved.space.name),welcome:readerText(resolved.listing.welcome),
    purpose:card(resolved.space,userId,resolved.global).description,
    cultures:cultures.map(publicCulture),rules:rules.map(r=>({id:Number(r.id),slug:String(r.slug),title:readerText(r.title),
      description:readerText(r.short_description),body:readerText(r.markdown),allowed:readerText(r.allowed_examples_markdown),disallowed:readerText(r.disallowed_examples_markdown)}))};
  // Source identifiers are retained for audit; revision reflects reader text, not invisible timestamps/AI edits.
  const manifest={spaceId:id,cultureIds:cultures.map(c=>Number(c.id)),rules:rules.map(r=>({id:Number(r.id),versionId:Number(r.versionId),version:Number(r.version)})),document};
  if(Buffer.byteLength(JSON.stringify(document))>900000)throw new ViewerApiError(503,'space_entry_too_large');
  const revision=readerRevision(document);
  return {...resolved,document,manifest,revision};
}
export async function entry(key:string,userId:number|null,receipt?:string,db:Db=getPool()) {
  const policy=await publicPolicy(key,userId,db);
  let accepted=false;
  if(userId)accepted=!!(await rows(db,'SELECT 1 FROM viewer_space_acknowledgments WHERE user_id=? AND space_id=? AND revision=?',[userId,policy.space.id,policy.revision])).length;
  else if(policy.global) {
    const [state]=await rows(db,'SELECT receipt_secret FROM discovery_state WHERE id=1');
    accepted=validReceipt(receipt,state.receipt_secret,policy.space.id,policy.revision);
  }
  const saved=userId?!!(await rows(db,'SELECT 1 FROM viewer_saved_spaces WHERE user_id=? AND space_id=? AND removed=0',[userId,policy.space.id])).length:false;
  return {schemaVersion:1,signedIn:!!userId,space:card({...policy.space,...policy.listing,saved},userId,policy.global),document:policy.document,revision:policy.revision,
    canView:policy.canView,requiresSignIn:policy.requiresSignIn,requiresAcknowledgment:!!(policy.listing.entry_enabled||readerText(policy.listing.welcome))&&!accepted,
    acknowledgmentEnabled:!!(policy.listing.entry_enabled||readerText(policy.listing.welcome)),enforced:!!policy.listing.entry_enabled,accepted};
}
async function transaction<T>(run:(conn:PoolConnection)=>Promise<T>):Promise<T> {
  const conn=await getPool().getConnection();
  try {await conn.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');await conn.beginTransaction();const result=await run(conn);await conn.commit();return result;}
  catch(e){await conn.rollback();throw e;}finally{conn.release();}
}
export async function accept(key:string,userId:number|null,revision:unknown) {
  if(typeof revision!=='string'||!/^[a-f0-9]{64}$/.test(revision))throw new ViewerApiError(400,'invalid_body');
  return transaction(async db=>{
    const policy=await publicPolicy(key,userId,db);
    if(!policy.canView)throw new ViewerApiError(policy.requiresSignIn?401:403,policy.requiresSignIn?'auth_required':'forbidden');
    if(revision!==policy.revision)throw new ViewerApiError(409,'space_entry_changed');
    await db.query('INSERT IGNORE INTO space_entry_documents (space_id,revision,manifest) VALUES (?,?,?)',[policy.space.id,revision,JSON.stringify(policy.manifest)]);
    if(userId)await db.query(`INSERT INTO viewer_space_acknowledgments (user_id,space_id,revision,manifest) VALUES (?,?,?,?)
      ON DUPLICATE KEY UPDATE revision=VALUES(revision),manifest=VALUES(manifest),accepted_at=CURRENT_TIMESTAMP`,[userId,policy.space.id,revision,JSON.stringify(policy.manifest)]);
    const [state]=userId?[]:await rows(db,'SELECT receipt_secret FROM discovery_state WHERE id=1');
    return {ok:true,revision,...(!userId?{receipt:issueReceipt(state.receipt_secret,policy.space.id,revision)}:{})};
  });
}
export async function requireEntry(spaceId:number|null,userId:number|null,receipt?:string) {
  // Fast path: legacy clients/unconfigured spaces do not perform policy work or acquire a new gate.
  const db=getPool();
  const id=spaceId??Number((await spaceRepo.findGlobalSpaceCandidate(db))?.id);
  if(!id)return;
  const [state]=await rows(db,'SELECT entry_enabled FROM discovery_spaces WHERE space_id=?',[id]);
  if(!state?.entry_enabled)return;
  const current=await entry(String(id),userId,receipt,db);
  if(!current.canView)throw new ViewerApiError(current.requiresSignIn?401:403,current.requiresSignIn?'auth_required':'forbidden');
  if(current.requiresAcknowledgment)throw new ViewerApiError(428,'space_acknowledgment_required');
}
export async function migrateSaved(userId:number) {
  // Ledger and tombstones make this one-time, including simultaneous first opens on two devices.
  if((await rows(getPool(),'SELECT 1 FROM viewer_discovery_migrations WHERE user_id=?',[userId])).length)return;
  const mine=await spaces.getMySpaces(userId);
  const eligible:number[]=[];
  for(const item of [...mine.groups,...mine.channels])if(item.id!==mine.global?.id&&await spaces.canViewSpaceFeed(await spaces.loadSpaceOrThrow(item.id),userId))eligible.push(item.id);
  await transaction(async db=>{
    const [ledger]=await db.query('INSERT IGNORE INTO viewer_discovery_migrations (user_id) VALUES (?)',[userId]);
    if(!(ledger as any).affectedRows)return;
    for(const id of eligible)await db.query("INSERT IGNORE INTO viewer_saved_spaces (user_id,space_id,origin) VALUES (?,?,'legacy')",[userId,id]);
  });
}
export async function saved(userId:number) {
  await migrateSaved(userId);
  const db=getPool(),mine=await spaces.getMySpaces(userId);
  const fixedIds=[mine.global?.id,mine.personal?.id].filter(Boolean);
  const fixedArtwork=new Map((fixedIds.length?await rows(db,'SELECT space_id,artwork_url FROM discovery_spaces WHERE space_id IN (?)',[fixedIds]):[]).map(row=>[Number(row.space_id),row.artwork_url]));
  const data=await rows(db,`SELECT s.*,d.artwork_url,1 AS saved FROM viewer_saved_spaces v JOIN spaces s ON s.id=v.space_id
    LEFT JOIN discovery_spaces d ON d.space_id=s.id WHERE v.user_id=? AND v.removed=0 ORDER BY v.updated_at DESC,s.id LIMIT 200`,[userId]);
  const allowed=[];
  for(const row of data)if(row.id!==mine.global?.id&&row.type!=='personal'&&await spaces.canViewSpaceFeed(row,userId,db))allowed.push(card(row,userId));
  return {schemaVersion:1,global:mine.global?card({...mine.global,artwork_url:fixedArtwork.get(Number(mine.global.id))},userId,true):null,personal:mine.personal?card({...mine.personal,artwork_url:fixedArtwork.get(Number(mine.personal.id))},userId):null,items:allowed};
}
/** Typed saved pages retain the legacy unfiltered saved() contract above. */
export async function savedDirectory(userId:number,query:{type?:unknown;cursor?:unknown;limit?:unknown},db:Db=getPool()) {
  if(!['group','channel'].includes(String(query.type)))throw new ViewerApiError(400,'invalid_query');
  const type=query.type as 'group'|'channel',limit=query.limit===undefined?20:positiveId(query.limit);if(limit>50)throw new ViewerApiError(400,'invalid_query');
  let after:{time:string;id:number}|null=null;
  if(query.cursor!==undefined){try{const text=String(query.cursor);if(!text.startsWith(type+':')||text.length>250)throw Error();const c=JSON.parse(Buffer.from(text.slice(type.length+1),'base64url').toString());if(!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(c.time)||!Number.isSafeInteger(c.id)||c.id<=0)throw Error();const parsed=Date.parse(c.time.replace(' ','T')+'Z');if(!Number.isFinite(parsed)||new Date(parsed).toISOString().slice(0,19).replace('T',' ')!==c.time)throw Error();after=c;}catch{throw new ViewerApiError(400,'invalid_query');}}
  await migrateSaved(userId);const global=await spaceRepo.findGlobalSpaceCandidate(db),items:SpaceCard[]=[];let scanned=0,more=true;
  while(items.length<limit&&scanned<500&&more){
    const tail=after?' AND (v.updated_at<? OR (v.updated_at=? AND s.id<?))':'';
    const data=await rows(db,`SELECT s.*,d.artwork_url,DATE_FORMAT(v.updated_at,'%Y-%m-%d %H:%i:%s') AS saved_at,1 AS saved FROM viewer_saved_spaces v JOIN spaces s ON s.id=v.space_id
      LEFT JOIN discovery_spaces d ON d.space_id=s.id WHERE v.user_id=? AND v.removed=0 AND s.type=? AND s.id<>? ${tail}
      ORDER BY v.updated_at DESC,s.id DESC LIMIT 50`,[userId,type,global?.id||0,...(after?[after.time,after.time,after.id]:[])]);
    more=data.length===50;
    for(let index=0;index<data.length;index++){const row=data[index];after={time:String(row.saved_at),id:Number(row.id)};scanned++;if(await spaces.canViewSpaceFeed(row,userId,db))items.push(card(row,userId));if(items.length===limit){more=index<data.length-1||more;break;}}
  }
  return {schemaVersion:1,items,nextCursor:more&&after?`${type}:${Buffer.from(JSON.stringify(after)).toString('base64url')}`:null,genre:null};
}
export async function save(key:string,userId:number,remove:boolean) {
  const {space,global}=await resolveSpace(key,userId);
  if(global||space.type==='personal')throw new ViewerApiError(400,'fixed_space');
  await migrateSaved(userId);
  await getPool().query(`INSERT INTO viewer_saved_spaces (user_id,space_id,origin,removed) VALUES (?,?,'explicit',?)
    ON DUPLICATE KEY UPDATE removed=VALUES(removed),origin='explicit',updated_at=CURRENT_TIMESTAMP`,[userId,space.id,remove?1:0]);
  return {ok:true,saved:!remove};
}
export async function recent(userId:number,db:Db=getPool()) {
  const data=await rows(db,`SELECT s.*,d.artwork_url,r.revision,r.publication_id,r.production_ulid,r.position_seconds,r.user_paused,
    UNIX_TIMESTAMP(r.visited_at)*1000 AS visitedAt FROM viewer_recent_spaces r JOIN spaces s ON s.id=r.space_id
    LEFT JOIN discovery_spaces d ON d.space_id=s.id WHERE r.user_id=? AND r.visited_at>NOW()-INTERVAL 90 DAY
    ORDER BY r.visited_at DESC,r.space_id DESC LIMIT 30`,[userId]);
  const global=await spaceRepo.findGlobalSpaceCandidate(db),items=[];
  for(const row of data) {
    const isGlobal=Number(global?.id)===Number(row.id);
    const allowed=isGlobal?!await spaceRepo.isBannedFromSpace(Number(row.id),userId,db):await spaces.canViewSpaceFeed(row,userId,db);
    if(allowed)items.push({...card(row,userId,isGlobal),visitedAt:Number(row.visitedAt)});
  }
  return items;
}
export async function resume(key:string,userId:number) {
  const {space,global,canView}=await resolveSpace(key,userId);if(!canView)throw new ViewerApiError(403,'forbidden');
  const [state]=await rows(getPool(),`SELECT revision,publication_id,production_ulid,position_seconds,user_paused FROM viewer_recent_spaces
    WHERE user_id=? AND space_id=? AND visited_at>NOW()-INTERVAL 90 DAY`,[userId,space.id]);
  if(!state)return {revision:0,checkpoint:null,outcome:'new'};
  if(!state.publication_id)return {revision:Number(state.revision),checkpoint:null,outcome:'new'};
  const opts={userId,publicationId:Number(state.publication_id),limit:1};
  const page=global?await feeds.getGlobalFeed(opts):await feeds.getSpaceFeed(space.id,opts);
  const item=page.items.find(i=>i.publication.id===Number(state.publication_id));
  const duration=Number((item as any)?.upload?.duration_seconds||0);
  if(!item||String(item.publication.production_ulid||'')!==state.production_ulid||(duration>0&&state.position_seconds>duration))
    return {revision:Number(state.revision),checkpoint:null,outcome:'unavailable'};
  return {revision:Number(state.revision),outcome:'restored',checkpoint:{publicationId:Number(state.publication_id),productionUlid:state.production_ulid,
    positionSeconds:Number(state.position_seconds),userPaused:!!state.user_paused}};
}
export async function visit(key:string,userId:number,body:any) {
  const {space,global,canView}=await resolveSpace(key,userId);if(!canView)throw new ViewerApiError(403,'forbidden');
  const revision=Number(body?.revision);if(!Number.isSafeInteger(revision)||revision<0)throw new ViewerApiError(400,'invalid_body');
  let checkpoint:any=null;
  if(body.checkpoint!=null) {
    const c=body.checkpoint,pub=positiveId(c.publicationId),position=Number(c.positionSeconds);
    if(!Number.isFinite(position)||position<0||position>86400*30||typeof c.userPaused!=='boolean'||typeof c.productionUlid!=='string'||!/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(c.productionUlid))throw new ViewerApiError(400,'invalid_body');
    const opts={publicationId:pub,limit:1,userId};
    const page=global?await feeds.getGlobalFeed(opts):await feeds.getSpaceFeed(space.id,opts);
    const item=page.items.find(i=>i.publication.id===pub);
    if(!item||String(item.publication.production_ulid||'')!==c.productionUlid)throw new ViewerApiError(409,'resume_unavailable');
    checkpoint={...c,positionSeconds:position};
  }
  return transaction(async db=>{
    await db.query('DELETE FROM viewer_recent_spaces WHERE user_id=? AND visited_at<NOW()-INTERVAL 90 DAY',[userId]);
    const current=(await rows(db,'SELECT revision FROM viewer_recent_spaces WHERE user_id=? AND space_id=? FOR UPDATE',[userId,space.id]))[0];
    if(Number(current?.revision||0)!==revision)throw new ViewerApiError(409,'resume_conflict');
    if(current) {
      if(checkpoint)await db.query(`UPDATE viewer_recent_spaces SET revision=revision+1,publication_id=?,production_ulid=?,position_seconds=?,user_paused=?,visited_at=CURRENT_TIMESTAMP(3) WHERE user_id=? AND space_id=?`,[checkpoint.publicationId,checkpoint.productionUlid,checkpoint.positionSeconds,checkpoint.userPaused?1:0,userId,space.id]);
      else await db.query('UPDATE viewer_recent_spaces SET revision=revision+1,visited_at=CURRENT_TIMESTAMP(3) WHERE user_id=? AND space_id=?',[userId,space.id]);
    }else await db.query(`INSERT INTO viewer_recent_spaces (user_id,space_id,publication_id,production_ulid,position_seconds,user_paused) VALUES (?,?,?,?,?,?)`,[userId,space.id,checkpoint?.publicationId||null,checkpoint?.productionUlid||null,checkpoint?.positionSeconds||0,checkpoint?.userPaused?1:0]);
    await db.query('DELETE FROM viewer_recent_spaces WHERE user_id=? AND visited_at<NOW()-INTERVAL 90 DAY',[userId]);
    await db.query(`DELETE FROM viewer_recent_spaces WHERE user_id=? AND space_id NOT IN
      (SELECT space_id FROM (SELECT space_id FROM viewer_recent_spaces WHERE user_id=? ORDER BY visited_at DESC,space_id DESC LIMIT 30) keep_recent)`,[userId,userId]);
    return {ok:true,revision:revision+1};
  });
}
export async function assertEditor(userId:number,spaceId?:number,curator=false) {
  if(await can(userId,PERM.VIDEO_DELETE_ANY))return;
  if(!curator&&spaceId&&await can(userId,PERM.SPACE_MANAGE,{spaceId}))return;
  throw new ViewerApiError(403,'forbidden');
}
export async function editor(key:string,userId:number) {
  const resolved=await resolveSpace(key,userId);await assertEditor(userId,resolved.space.id);
  const genres=await rows(getPool(),'SELECT id,slug,name,published,sort_order FROM discovery_genres ORDER BY sort_order,id');
  const placements=await rows(getPool(),'SELECT genre_id FROM discovery_placements WHERE space_id=?',[resolved.space.id]);
  return {config:await config(),space:{id:resolved.space.id,name:resolved.space.name},draft:resolved.listing.draft||'',welcome:resolved.listing.welcome||'',listed:!!resolved.listing.listed,
    artworkUrl:resolved.listing.artwork_url||'',entryEnabled:!!resolved.listing.entry_enabled,genres,genreIds:placements.map(p=>Number(p.genre_id)),curator:await can(userId,PERM.VIDEO_DELETE_ANY),policy:await entry(String(resolved.space.id),userId)};
}
export async function updateEditor(key:string,userId:number,body:any) {
  const {space}=await resolveSpace(key,userId);await assertEditor(userId,space.id);
  if(!body||!['draft','publish','placement'].includes(body.action))throw new ViewerApiError(400,'invalid_body');
  if(body.action==='placement') {
    await assertEditor(userId,space.id,true);
    if(space.type==='personal'&&body.listed===true)throw new ViewerApiError(400,'personal_not_listable');
    const ids=body.genreIds;if(!Array.isArray(ids)||ids.length>20)throw new ViewerApiError(400,'invalid_body');
    const genreIds=[...new Set(ids.map(positiveId))];
    const artwork=String(body.artworkUrl||'');if(artwork&&!/^\/(?:images|assets)\/[a-zA-Z0-9/_\-.]+$/.test(artwork))throw new ViewerApiError(400,'invalid_artwork');
    if(typeof body.listed!=='boolean')throw new ViewerApiError(400,'invalid_body');
    await transaction(async db=>{
      if(genreIds.length&&(await rows(db,`SELECT id FROM discovery_genres WHERE id IN (${genreIds.map(()=>'?')})`,genreIds)).length!==genreIds.length)throw new ViewerApiError(400,'invalid_body');
      await db.query(`INSERT INTO discovery_spaces (space_id,listed,artwork_url,updated_by) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE listed=VALUES(listed),artwork_url=VALUES(artwork_url),updated_by=VALUES(updated_by)`,[space.id,body.listed?1:0,artwork||null,userId]);
      await db.query('DELETE FROM discovery_placements WHERE space_id=?',[space.id]);
      for(const id of genreIds)await db.query('INSERT INTO discovery_placements (genre_id,space_id) VALUES (?,?)',[id,space.id]);
    });
  }else {
    if(typeof body.text!=='string'||body.text.length>12000)throw new ViewerApiError(400,'invalid_body');
    const text=readerText(body.text);
    if(body.action==='publish') {
      if(typeof body.entryEnabled!=='boolean')throw new ViewerApiError(400,'invalid_body');
      // Enabling is a deliberate curator rollout, after both clients qualify. Authors can publish text without enabling.
      if(body.entryEnabled)await assertEditor(userId,space.id,true);
      const policy=await publicPolicy(String(space.id),userId);
      if(body.entryEnabled&&(!text||policy.document.cultures.some(c=>!c.configured||!c.summary)))throw new ViewerApiError(409,'space_editorial_incomplete');
      await getPool().query(`INSERT INTO discovery_spaces (space_id,draft,welcome,entry_enabled,updated_by) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE draft=VALUES(draft),welcome=VALUES(welcome),entry_enabled=VALUES(entry_enabled),updated_by=VALUES(updated_by)`,[space.id,text,text,body.entryEnabled?1:0,userId]);
    }else await getPool().query(`INSERT INTO discovery_spaces (space_id,draft,updated_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE draft=VALUES(draft),updated_by=VALUES(updated_by)`,[space.id,text,userId]);
  }
  return editor(key,userId);
}
export async function updateGenre(userId:number,body:any) {
  await assertEditor(userId,undefined,true);
  if(!body||typeof body.name!=='string'||!body.name.trim()||body.name.length>100||typeof body.slug!=='string'||! /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body.slug)||body.slug.length>80||typeof body.published!=='boolean'||!Number.isInteger(body.sortOrder)||Math.abs(body.sortOrder)>10000)throw new ViewerApiError(400,'invalid_body');
  await getPool().query(`INSERT INTO discovery_genres (slug,name,published,sort_order) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),published=VALUES(published),sort_order=VALUES(sort_order)`,[body.slug,readerText(body.name),body.published?1:0,body.sortOrder]);
  return {ok:true};
}

export async function updateConfig(userId:number,body:any) {
  await assertEditor(userId,undefined,true);
  if(typeof body?.homeEnabled!=='boolean'||typeof body?.nativeHomeEnabled!=='boolean')throw new ViewerApiError(400,'invalid_body');
  await getPool().query('UPDATE discovery_state SET root_home=?,native_home=? WHERE id=1',[body.homeEnabled?1:0,body.nativeHomeEnabled?1:0]);
  return config();
}

export async function recentFeeds(userId:number,db:Db=getPool()) {
 return (await rows(db,"SELECT feed_kind,UNIX_TIMESTAMP(visited_at)*1000 AS visitedAt FROM viewer_feed_checkpoints WHERE user_id=? AND visited_at>NOW()-INTERVAL 90 DAY ORDER BY visited_at DESC LIMIT 2",[userId])).map(row=>({kind:row.feed_kind,visitedAt:Number(row.visitedAt)}));
}
