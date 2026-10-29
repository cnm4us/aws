import {Router} from 'express';
import {getPool} from '../../db';
import {resolveViewer,ViewerApiError} from '../native-sessions/service';
import {sendViewerError} from '../../routes/native-session';
import {kind} from './model';
import {aggregatePage,creationContexts} from './service';
export function createAggregateRouter(){
 const router=Router();
 router.get('/feed/creations/publications/:publicationId/contexts',async(req,res)=>{try{const principal=(await resolveViewer(req,true))!;const id=Number(req.params.publicationId);if(!/^[1-9]\d*$/.test(req.params.publicationId)||!Number.isSafeInteger(id)||Object.keys(req.query).length)throw new ViewerApiError(400,'invalid_query');res.json(await creationContexts(id,principal,res.locals.accessStartedAt??Date.now()));}catch(e){sendViewerError(res,e);}});

 for(const feed of ['following','creations']as const)router.get(`/feed/${feed}`,async(req,res)=>{
  try{const principal=(await resolveViewer(req,true))!;
   if(Object.keys(req.query).some(k=>!['cursor','limit','anchorPublicationId','publicationIds'].includes(k))||Object.values(req.query).some(v=>typeof v!=='string'))throw new ViewerApiError(400,'invalid_query');
   if(req.query.publicationIds&&Object.keys(req.query).length!==1)throw new ViewerApiError(400,'invalid_query');
   res.json(await aggregatePage(feed,principal,req.query as any,res.locals.accessStartedAt??Date.now()));
  }catch(e){sendViewerError(res,e);}
 });
 router.get('/me/feed-checkpoints/:kind',async(req,res)=>{try{
  const principal=(await resolveViewer(req,true))!,feed=kind(req.params.kind);
  if(Object.keys(req.query).length)throw new ViewerApiError(400,'invalid_query');
  const [rows]=await getPool().query('SELECT * FROM viewer_feed_checkpoints WHERE user_id=? AND feed_kind=? AND visited_at>NOW()-INTERVAL 90 DAY',[principal.viewer.id,feed]);const row=(rows as any[])[0];
  if(!row)return res.json({revision:0,checkpoint:null,outcome:'new'});
  const page=await aggregatePage(feed,principal,{publicationIds:String(row.publication_id)},res.locals.accessStartedAt??Date.now());
  const item=page.items.find(i=>i.publicationId===Number(row.publication_id)&&i.spaceId===Number(row.space_id)&&i.productionUlid===row.production_ulid&&(!i.durationSeconds||Number(row.position_seconds)<=i.durationSeconds));
  res.json({revision:Number(row.revision),outcome:item?'restored':'unavailable',checkpoint:item?{publicationId:item.publicationId,productionUlid:item.productionUlid,spaceId:item.spaceId,positionSeconds:Number(row.position_seconds),userPaused:!!row.user_paused}:null});
 }catch(e){sendViewerError(res,e);}});
 router.post('/me/feed-checkpoints/:kind',async(req,res)=>{let db;try{
  const principal=(await resolveViewer(req,true))!,feed=kind(req.params.kind),body=req.body,c=body?.checkpoint;
  const origin=req.get('Origin');if(origin&&!req.headers.authorization&&new URL(origin).host!==req.get('host'))throw new ViewerApiError(403,'csrf_invalid');
  if(!Number.isSafeInteger(body?.revision)||body.revision<0||!c||!Number.isSafeInteger(c.publicationId)||c.publicationId<=0||!Number.isSafeInteger(c.spaceId)||c.spaceId<=0||!Number.isFinite(c.positionSeconds)||c.positionSeconds<0||c.positionSeconds>2592000||typeof c.userPaused!=='boolean'||typeof c.productionUlid!=='string'||!/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(c.productionUlid))throw new ViewerApiError(400,'invalid_body');
  const page=await aggregatePage(feed,principal,{publicationIds:String(c.publicationId)},res.locals.accessStartedAt??Date.now());
  if(!page.items.some(i=>i.publicationId===c.publicationId&&i.spaceId===c.spaceId&&i.productionUlid===c.productionUlid&&(!i.durationSeconds||c.positionSeconds<=i.durationSeconds)))throw new ViewerApiError(409,'resume_unavailable');
  db=await getPool().getConnection();await db.beginTransaction();
  const [rows]=await db.query('SELECT revision FROM viewer_feed_checkpoints WHERE user_id=? AND feed_kind=? FOR UPDATE',[principal.viewer.id,feed]);const current=(rows as any[])[0];
  if(Number(current?.revision??0)!==body.revision)throw new ViewerApiError(409,'resume_conflict');
  await db.query(`INSERT INTO viewer_feed_checkpoints(user_id,feed_kind,revision,publication_id,production_ulid,space_id,position_seconds,user_paused) VALUES (?,?,?,?,?,?,?,?)
   ON DUPLICATE KEY UPDATE revision=VALUES(revision),publication_id=VALUES(publication_id),production_ulid=VALUES(production_ulid),space_id=VALUES(space_id),position_seconds=VALUES(position_seconds),user_paused=VALUES(user_paused),visited_at=CURRENT_TIMESTAMP(3)`,[principal.viewer.id,feed,body.revision+1,c.publicationId,c.productionUlid,c.spaceId,c.positionSeconds,c.userPaused?1:0]);
  await db.query('DELETE FROM viewer_feed_checkpoints WHERE user_id=? AND visited_at<NOW()-INTERVAL 90 DAY',[principal.viewer.id]);await db.commit();res.json({ok:true,revision:body.revision+1});
 }catch(e){if(db)await db.rollback();if(['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT','ER_DUP_ENTRY'].includes(String((e as any)?.code)))sendViewerError(res,new ViewerApiError(409,'resume_conflict'));else sendViewerError(res,e);}finally{db?.release();}});
 return router;
}
