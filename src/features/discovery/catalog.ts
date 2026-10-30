import {createHash} from 'node:crypto';
import {getPool,type Queryable} from '../../db';
import {ViewerApiError} from '../native-sessions/service';
import * as discovery from './service';
import * as spaces from '../spaces/service';
import {can} from '../../security/permissions';
import {PERM} from '../../security/perm';
import {assignDefaultMemberRoles} from '../../services/spaceMembership';
import * as payments from '../payments/service';
import {readerText} from './policy';

type Db=Queryable;
const read=async(db:Db,sql:string,args:any[]=[])=>{const [rows]=await db.query(sql,args);return rows as any[];};
const settings=(v:any)=>{try{return typeof v==='string'?JSON.parse(v):v||{};}catch{return {};}};
export const modes=['existing','open_group','free_channel','paid_channel','invitation'] as const;
export type Mode=typeof modes[number];
export function options(raw:any,type:string){
 const v=settings(raw).viewerEntry;if(!v||!modes.includes(v.mode))return {mode:'existing' as Mode,price:null};
 if(v.mode==='open_group'&&type!=='group'||['free_channel','paid_channel'].includes(v.mode)&&type!=='channel')return {mode:'existing' as Mode,price:null};
 const p=v.price;const price=v.mode==='paid_channel'&&p&&Number.isSafeInteger(p.amountCents)&&p.amountCents>0&&p.amountCents<=100000000&&/^[A-Z]{3}$/.test(p.currency)&&['month','year'].includes(p.interval)?{amountCents:p.amountCents,currency:p.currency,interval:p.interval}:null;
 return {mode:v.mode as Mode,price};
}
const relation=`EXISTS(SELECT 1 FROM user_space_roles u WHERE u.user_id=? AND u.space_id=s.id)`;
const subscription=`EXISTS(SELECT 1 FROM space_subscriptions sub WHERE sub.user_id=? AND sub.space_id=s.id AND sub.status='active' AND (sub.ended_at IS NULL OR sub.ended_at>NOW()))`;
const invitation=`EXISTS(SELECT 1 FROM space_invitations i WHERE i.invitee_user_id=? AND i.space_id=s.id AND i.status='pending')`;
const ordinarySpace="s.slug NOT IN ('global','global-feed') AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.settings,'$.global')),'false')<>'true' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.settings,'$.isGlobal')),'false')<>'true' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.settings,'$.feed')),'')<>'global'";
const isGlobal=(row:any)=>['global','global-feed'].includes(row.slug)||settings(row.settings).global===true||settings(row.settings).isGlobal===true||settings(row.settings).feed==='global';
const ban=`EXISTS(SELECT 1 FROM suspensions b WHERE b.user_id=? AND b.kind='ban' AND (b.starts_at IS NULL OR b.starts_at<=NOW()) AND (b.ends_at IS NULL OR b.ends_at>=NOW()) AND (b.target_type='site' OR (b.target_type='space' AND b.target_id=s.id)))`;
function select(userId:number|null){const id=userId||0;return {sql:`SELECT s.*,d.artwork_url,COALESCE(d.listed,0) listed,COALESCE(v.removed=0,0) saved,${relation} member,${subscription} subscribed,${invitation} invited,${ban} banned FROM spaces s LEFT JOIN discovery_spaces d ON d.space_id=s.id LEFT JOIN viewer_saved_spaces v ON v.space_id=s.id AND v.user_id=?`,args:[id,id,id,id,id]};}
function metadata(row:any,userId:number|null,admin:boolean){
 const owner=!!userId&&Number(row.owner_user_id)===userId,member=!!row.member,subscribed=!!row.subscribed,banned=!!row.banned;
 const known=owner||member||subscribed||!!row.invited,discoverable=!!row.listed||known&&!banned;
 const policy=options(row.settings,row.type),view=!!userId&&!banned&&(admin||owner||member||subscribed||spaces.settingsAllowPublicView(settings(row.settings)));
 const action=view?'enter':!userId?'sign_in':banned?'unavailable':policy.mode==='open_group'?'join':policy.mode==='free_channel'?'subscribe_free':policy.mode==='paid_channel'?'purchase_deferred':row.invited?'accept_invitation':'invitation';
 const label=banned?'Unavailable':owner?'Owner':subscribed&&row.type==='channel'?'Subscribed':member?(row.type==='group'?'Joined':'Member access'):view?'Access available':policy.mode==='paid_channel'?'Subscription required':policy.mode==='free_channel'?'Free subscription':policy.mode==='open_group'?'Join to watch':row.invited?'Invitation pending':policy.mode==='invitation'||settings(row.settings).membership==='invite'?'Invitation required':'Access required';
 return {discoverable,availability:{canView:view,label,action,mode:policy.mode,price:policy.price},known};
}
async function cardRows(ids:number[],userId:number|null,db:Db){if(!ids.length)return [];const q=select(userId);return read(db,`${q.sql} WHERE s.id IN (?)`,[...q.args,ids]);}
export async function enrich(cards:any[],userId:number|null,db:Db=getPool()){
 const data=new Map((await cardRows(cards.map(c=>c.id),userId,db)).map(r=>[Number(r.id),r]));const admin=!!userId&&await can(userId,PERM.VIDEO_DELETE_ANY,{checker:undefined});
 return cards.map(c=>{const row=data.get(c.id);return row?{...c,saved:!!row.saved,...(!c.global&&c.type!=='personal'?{availability:metadata(row,userId,admin).availability}:{})}:c;});
}
const scopeKey=(parts:unknown[])=>createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,24);
function cursor(raw:unknown,scope:string){if(raw===undefined)return 0;if(typeof raw!=='string'||raw.length>250)throw new ViewerApiError(400,'invalid_query');try{const c=JSON.parse(Buffer.from(raw,'base64url').toString());if(c.scope!==scope||!Number.isSafeInteger(c.offset)||c.offset<0||c.offset>Number.MAX_SAFE_INTEGER)throw Error();return c.offset;}catch{throw new ViewerApiError(400,'invalid_query');}}
export async function catalog(userId:number|null,query:any,db:Db=getPool()){
 if(Object.keys(query).some(k=>!['type','q','genre','payment','cursor','limit'].includes(k))||Object.values(query).some(v=>typeof v!=='string'))throw new ViewerApiError(400,'invalid_query');
 if(query.type&&!['group','channel'].includes(query.type))throw new ViewerApiError(400,'invalid_query');
 if(query.payment&&!['free','paid'].includes(query.payment))throw new ViewerApiError(400,'invalid_query');
 const limit=query.limit===undefined?20:discovery.positiveId(query.limit);if(limit>50)throw new ViewerApiError(400,'invalid_query');
 const term:string=(query.q||'').trim();if(term.length>80)throw new ViewerApiError(400,'invalid_query');
 const scope=scopeKey([userId,query.type||'',query.genre||'',term,query.payment||'']),offset=cursor(query.cursor,scope),q=select(userId),id=userId||0;
 const where=[`s.type IN ('group','channel')`,ordinarySpace,`s.id<>COALESCE((SELECT id FROM spaces WHERE slug IN ('global','global-feed') ORDER BY slug='global' DESC LIMIT 1),0)`,
 `(COALESCE(d.listed,0)=1 OR (NOT ${ban} AND (s.owner_user_id=? OR ${relation} OR ${subscription} OR ${invitation})))`];
 const args:any[]=[...q.args,id,id,id,id,id];
 where.push('s.id>?');args.push(offset);
 if(query.type){where.push('s.type=?');args.push(query.type);}
 if(query.payment){where.push("JSON_UNQUOTE(JSON_EXTRACT(s.settings,'$.viewerEntry.mode'))=?");args.push(query.payment==='free'?'free_channel':'paid_channel');}
 let genre=null;if(query.genre){const [g]=await read(db,'SELECT slug,name FROM discovery_genres WHERE slug=? AND published=1',[query.genre]);if(!g)throw new ViewerApiError(404,'genre_not_found');genre=g;where.push('EXISTS(SELECT 1 FROM discovery_placements p JOIN discovery_genres g ON g.id=p.genre_id WHERE p.space_id=s.id AND g.slug=? AND g.published=1)');args.push(query.genre);}
 if(term){where.push("(s.name LIKE ? ESCAPE '=' OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.settings,'$.discoveryDescription')),'') LIKE ? ESCAPE '=')");const pattern='%'+term.replace(/[=%_]/g,c=>'='+c)+'%';args.push(pattern,pattern);}
 const data=await read(db,`${q.sql} WHERE ${where.join(' AND ')} ORDER BY s.id LIMIT ?`,[...args,limit+1]);
 const cards=data.slice(0,limit).map(r=>discovery.card(r,userId));return {schemaVersion:2,items:await enrich(cards,userId,db),genre,nextCursor:data.length>limit?Buffer.from(JSON.stringify({scope,offset:Number(data[limit-1].id)})).toString('base64url'):null};
}
async function independentSaves(userId:number){await getPool().query('INSERT IGNORE INTO viewer_discovery_migrations(user_id) VALUES(?)',[userId]);}
export async function home(userId:number|null){if(userId)await independentSaves(userId);const value=await discovery.home(userId);return {...value,schemaVersion:2,recent:await enrich(value.recent,userId),genres:await Promise.all(value.genres.map(async g=>({...g,items:await enrich(g.items,userId)})))};}
export async function collections(userId:number,query:any,db:Db=getPool()){
 if(!['group','channel','all'].includes(query.type)||Object.keys(query).some(k=>!['type','cursor'].includes(k)))throw new ViewerApiError(400,'invalid_query');
 await independentSaves(userId);const scope=scopeKey(['saved',userId,query.type]);
 let after:{time:string;id:number}|null=null;
 if(query.cursor!==undefined){try{if(typeof query.cursor!=='string'||query.cursor.length>250)throw Error();const c=JSON.parse(Buffer.from(query.cursor,'base64url').toString());if(c.scope!==scope||!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(c.time)||!Number.isSafeInteger(c.id)||c.id<=0)throw Error();if(new Date(c.time.replace(' ','T')+'Z').toISOString().slice(0,19).replace('T',' ')!==c.time)throw Error();after=c;}catch{throw new ViewerApiError(400,'invalid_query');}}
 const type=query.type==='all'?"COALESCE(s.type,v.space_type) IN ('group','channel')":'COALESCE(s.type,v.space_type)=?';
 const rows=await read(db,`SELECT v.space_id,COALESCE(s.type,v.space_type) actual_type,DATE_FORMAT(v.updated_at,'%Y-%m-%d %H:%i:%s') saved_at FROM viewer_saved_spaces v LEFT JOIN spaces s ON s.id=v.space_id WHERE v.user_id=? AND v.removed=0 AND ${type} AND (s.id IS NULL OR (${ordinarySpace})) ${after?'AND (v.updated_at<? OR (v.updated_at=? AND v.space_id<?))':''} ORDER BY v.updated_at DESC,v.space_id DESC LIMIT 21`,[userId,...(query.type==='all'?[]:[query.type]),...(after?[after.time,after.time,after.id]:[])]);
 const details=new Map((await cardRows(rows.slice(0,20).map(r=>Number(r.space_id)),userId,db)).map(r=>[Number(r.id),r]));const admin=await can(userId,PERM.VIDEO_DELETE_ANY);
 const items=rows.slice(0,20).map(r=>{const row=details.get(Number(r.space_id));const status=row?metadata(row,userId,admin):null;
  if(row&&status?.discoverable)return {...discovery.card({...row,saved:1},userId),availability:status.availability};
  return {id:Number(r.space_id),name:'Unavailable space',slug:'unavailable',type:r.actual_type,global:false,path:`/${r.actual_type==='group'?'groups':'channels'}/unavailable`,description:null,artworkUrl:null,saved:true,requiresSignIn:false,unavailable:true};});
 const last=rows[Math.min(20,rows.length)-1];
 const fixed=query.type==='all'?await discovery.saved(userId):null;
 return {schemaVersion:2,items,genre:null,nextCursor:rows.length>20?Buffer.from(JSON.stringify({scope,time:last.saved_at,id:Number(last.space_id)})).toString('base64url'):null,...(fixed?{global:fixed.global,personal:fixed.personal}:{})};
}
export async function save(key:string,userId:number,saved:boolean){
 const id=discovery.positiveId(key),db=getPool();
 if(!saved){await db.query("UPDATE viewer_saved_spaces SET removed=1,origin='explicit',updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND space_id=?",[userId,id]);return {ok:true,saved:false};}
 const row=(await cardRows([id],userId,db))[0];if(!row||!['group','channel'].includes(row.type)||isGlobal(row)||!metadata(row,userId,await can(userId,PERM.VIDEO_DELETE_ANY)).discoverable)throw new ViewerApiError(404,'space_not_found');
 await independentSaves(userId);await db.query(`INSERT INTO viewer_saved_spaces(user_id,space_id,space_type,origin,removed) VALUES(?,?,?,'explicit',0) ON DUPLICATE KEY UPDATE removed=0,space_type=VALUES(space_type),origin='explicit',updated_at=CURRENT_TIMESTAMP`,[userId,id,row.type]);return {ok:true,saved:true};
}
export async function entry(key:string,userId:number|null,receipt?:string){
 const value=await discovery.entry(key,userId,receipt,getPool(),true),[space]=await enrich([value.space],userId);return {...value,schemaVersion:1,space};
}
export async function enroll(key:string,userId:number,body:any){
 if(!body||typeof body.acknowledge!=='boolean'||typeof body.revision!=='string'||!/^[a-f0-9]{64}$/.test(body.revision))throw new ViewerApiError(400,'invalid_body');
 const db=await getPool().getConnection();try{await db.beginTransaction();const id=discovery.positiveId(key);await db.query('SELECT id FROM spaces WHERE id=? FOR UPDATE',[id]);const policy=await discovery.publicPolicy(key,userId,db,true);if(policy.global||!['group','channel'].includes(policy.space.type))throw new ViewerApiError(400,'enrollment_unavailable');
  const row=(await cardRows([id],userId,db))[0],state=metadata(row,userId,await can(userId,PERM.VIDEO_DELETE_ANY));if(!state.discoverable||row.banned)throw new ViewerApiError(403,'forbidden');
  const mode=options(row.settings,row.type).mode;if(!['open_group','free_channel'].includes(mode)&&!row.invited)throw new ViewerApiError(403,'enrollment_unavailable');
  if(policy.revision!==body.revision)throw new ViewerApiError(409,'space_entry_changed');
  const required=!!(policy.listing.entry_enabled||readerText(policy.listing.welcome));const [ack]=await read(db,'SELECT 1 FROM viewer_space_acknowledgments WHERE user_id=? AND space_id=? AND revision=?',[userId,id,policy.revision]);if(required&&!ack&&!body.acknowledge)throw new ViewerApiError(428,'space_acknowledgment_required');
  if(row.invited){await db.query("UPDATE space_invitations SET status='accepted',responded_at=NOW() WHERE space_id=? AND invitee_user_id=? AND status='pending'",[id,userId]);await assignDefaultMemberRoles(db,policy.space,userId);}
  else if(mode==='open_group')await assignDefaultMemberRoles(db,policy.space,userId);
  else {await db.query("INSERT IGNORE INTO space_subscriptions(user_id,space_id,tier,status) VALUES(?,?,'free','active')",[userId,id]);await db.query("UPDATE space_subscriptions SET tier='free',status='active',ended_at=NULL WHERE user_id=? AND space_id=? AND (status<>'active' OR ended_at<=NOW())",[userId,id]);}
  if(body.acknowledge){await db.query('INSERT IGNORE INTO space_entry_documents(space_id,revision,manifest) VALUES(?,?,?)',[id,policy.revision,JSON.stringify(policy.manifest)]);await db.query('INSERT IGNORE INTO viewer_space_acknowledgments(user_id,space_id,revision,manifest) VALUES(?,?,?,?)',[userId,id,policy.revision,JSON.stringify(policy.manifest)]);}
  await db.commit();return {ok:true};
 }catch(e){await db.rollback();throw e;}finally{db.release();}
}
export async function subscriptions(userId:number,cursorValue?:string){
 const db=getPool(),scope=scopeKey(['subscriptions',userId]),offset=cursor(cursorValue,scope);
 const data=await read(db,`SELECT sub.space_id,CASE WHEN sub.status='active' AND sub.ended_at IS NOT NULL AND sub.ended_at<=NOW() THEN 'expired' ELSE sub.status END status,sub.tier,sub.ended_at,s.name,s.type FROM space_subscriptions sub JOIN spaces s ON s.id=sub.space_id WHERE sub.user_id=? AND s.type='channel' AND ${ordinarySpace} AND s.id>? ORDER BY s.id LIMIT 21`,[userId,offset]);
 const q=select(userId),all=await cardRows(data.slice(0,20).map(r=>Number(r.space_id)),userId,db),details=new Map(all.map(r=>[Number(r.id),r])),admin=await can(userId,PERM.VIDEO_DELETE_ANY);
 const items=data.slice(0,20).map(r=>{const row=details.get(Number(r.space_id)),meta=row?metadata(row,userId,admin):null;return {id:Number(r.space_id),name:meta?.discoverable?r.name:'Unavailable channel',status:r.status,kind:r.tier==='free'?'Free subscription':'Existing channel access',validUntil:r.ended_at,space:row&&meta?.discoverable?{...discovery.card(row,userId),availability:meta.availability}:null};});
 const state=cursorValue?JSON.parse(Buffer.from(cursorValue,'base64url').toString()):null,paymentId=state?.paymentId??0;if(!Number.isSafeInteger(paymentId)||paymentId<0)throw new ViewerApiError(400,'invalid_query');
 const support=await read(db,`SELECT p.id,p.status,p.provider,p.amount_cents,p.currency,p.pending_action,COALESCE(c.status='enabled',0) provider_enabled FROM payment_subscriptions p LEFT JOIN payment_provider_configs c ON c.provider=p.provider AND c.mode=p.mode WHERE p.user_id=? AND p.id>? ORDER BY p.id LIMIT 21`,[userId,paymentId]);
 return {items,nextCursor:data.length>20||support.length>20?Buffer.from(JSON.stringify({scope,offset:data.length?Number(data[Math.min(data.length,20)-1].space_id):offset,paymentId:support.length?Number(support[Math.min(support.length,20)-1].id):paymentId})).toString('base64url'):null,support:support.slice(0,20).map(s=>({id:Number(s.id),status:s.status,provider:s.provider,amountCents:s.amount_cents===null?null:Number(s.amount_cents),currency:s.currency,pendingAction:s.pending_action,canCancel:s.status==='active'&&!s.pending_action&&!!s.provider_enabled})),purchasesAvailable:false};
}
export async function cancelSubscription(userId:number,id:string){return payments.requestSubscriptionAction({userId,subscriptionId:discovery.positiveId(id),action:'cancel'});}

export async function updateOptions(key:string,userId:number,body:any){
 const {space,global}=await discovery.resolveSpace(key,userId);await discovery.assertEditor(userId,space.id);
 if(global||space.type==='personal'||!body||!modes.includes(body.mode)||body.mode==='open_group'&&space.type!=='group'||['free_channel','paid_channel'].includes(body.mode)&&space.type!=='channel')throw new ViewerApiError(400,'invalid_entry_options');
 const value={mode:body.mode,price:body.price??null};if(body.mode!=='paid_channel'&&value.price!==null||value.price!==null&&options({viewerEntry:value},space.type).price===null)throw new ViewerApiError(400,'invalid_entry_options');
 await getPool().query("UPDATE spaces SET settings=JSON_SET(COALESCE(settings,'{}'),'$.viewerEntry',JSON_EXTRACT(?,'$')) WHERE id=?",[JSON.stringify(value),space.id]);return {ok:true};
}
