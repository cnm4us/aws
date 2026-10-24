import { getPool, type Queryable } from '../../db';
import { ViewerApiError } from '../native-sessions/service';
import type { Context, PageOptions } from './contract';
export type Comment = {id:number;body:string;createdAt:string;author:{id:number;displayName:string};isMine:boolean};
const count = (v:unknown) => { const n=Number(v);if(!Number.isSafeInteger(n)||n<0)throw new ViewerApiError(503,'service_unavailable');return n; };
export const mapComment = (r:any,userId:number):Comment => ({id:count(r.id),body:String(r.body),createdAt:String(r.created_at),author:{id:count(r.user_id),displayName:String(r.display_name||'Viewer')},isMine:Number(r.user_id)===userId});
export async function transaction<T>(publicationId:number,work:(db:Queryable)=>Promise<T>):Promise<T> {
  const db=await getPool().getConnection();
  try {
    await db.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await db.beginTransaction();
    const [rows]=await db.query('SELECT id FROM space_publications WHERE id=? FOR UPDATE',[publicationId]);
    if(!(rows as any[]).length)throw new ViewerApiError(404,'publication_not_found');
    const result=await work(db);await db.commit();return result;
  }catch(error){await db.rollback();throw error;}finally{db.release();}
}
export async function summary(ctx:Context,db:Queryable=getPool()) {
  const [rows]=await db.query(`SELECT sp.likes_count,sp.comments_count,
    EXISTS(SELECT 1 FROM publication_likes pl WHERE pl.publication_id=sp.id AND pl.user_id=?) AS liked,
    EXISTS(SELECT 1 FROM publication_comments pc WHERE pc.publication_id=sp.id AND pc.user_id=? AND pc.status='visible' AND pc.deleted_at IS NULL) AS commented
    FROM space_publications sp WHERE sp.id=? AND sp.space_id=?`,[ctx.userId,ctx.userId,ctx.publicationId,ctx.spaceId]);
  const r=(rows as any[])[0];if(!r)throw new ViewerApiError(404,'publication_not_found');
  return {likes:{count:count(r.likes_count),likedByMe:!!Number(r.liked)},comments:{count:count(r.comments_count),hasCommentedByMe:!!Number(r.commented)}};
}
export async function setLike(ctx:Context,liked:boolean,db:Queryable) {
  const [r]=liked?await db.query('INSERT IGNORE INTO publication_likes (publication_id,user_id) VALUES (?,?)',[ctx.publicationId,ctx.userId])
    :await db.query('DELETE FROM publication_likes WHERE publication_id=? AND user_id=?',[ctx.publicationId,ctx.userId]);
  if((r as any).affectedRows===1)await db.query('UPDATE space_publications SET likes_count=GREATEST(likes_count + ?,0) WHERE id=?',[liked?1:-1,ctx.publicationId]);
}
export async function parent(ctx:Context,id:number,db:Queryable=getPool()) {
  const [rows]=await db.query("SELECT id FROM publication_comments WHERE id=? AND publication_id=? AND parent_id IS NULL AND status='visible' AND deleted_at IS NULL",[id,ctx.publicationId]);
  if(!(rows as any[]).length)throw new ViewerApiError(404,'publication_not_found');
}
export async function insertComment(ctx:Context,body:string,parentId:number|null,db:Queryable) {
  const [r]=await db.query("INSERT INTO publication_comments (publication_id,user_id,parent_id,body,status) VALUES (?,?,?,?,'visible')",[ctx.publicationId,ctx.userId,parentId,body]);
  await db.query('UPDATE space_publications SET comments_count=comments_count+1 WHERE id=?',[ctx.publicationId]);
  const [rows]=await db.query('SELECT pc.id,pc.user_id,pc.body,pc.created_at,u.display_name FROM publication_comments pc JOIN users u ON u.id=pc.user_id WHERE pc.id=?',[(r as any).insertId]);
  return mapComment((rows as any[])[0],ctx.userId);
}
export async function comments(ctx:Context,opts:PageOptions,parentId:number|null=null,db:Queryable=getPool()) {
  const params:any[]=[ctx.publicationId];
  const where=["pc.publication_id=?","pc.status='visible'",'pc.deleted_at IS NULL',parentId===null?'pc.parent_id IS NULL':'pc.parent_id=?'];
  if(parentId!==null)params.push(parentId);
  const operator=opts.order==='oldest'?'>':'<',direction=opts.order==='oldest'?'ASC':'DESC';
  if(opts.cursor){where.push(`(pc.created_at ${operator} ? OR (pc.created_at=? AND pc.id ${operator} ?))`);params.push(opts.cursor.ts,opts.cursor.ts,opts.cursor.id);}
  const [rows]=await db.query(`SELECT pc.id,pc.user_id,pc.body,pc.created_at,u.display_name FROM publication_comments pc JOIN users u ON u.id=pc.user_id
    WHERE ${where.join(' AND ')} ORDER BY pc.created_at ${direction},pc.id ${direction} LIMIT ?`,[...params,opts.limit+1]);
  const raw=rows as any[],items=raw.slice(0,opts.limit).map(r=>mapComment(r,ctx.userId));
  const last=raw.length>opts.limit?raw[opts.limit-1]:null;
  return {items,last:last?{ts:String(last.created_at),id:Number(last.id)}:null};
}
export async function likers(ctx:Context,opts:PageOptions) {
  const params:any[]=[ctx.publicationId];let where='pl.publication_id=?';
  if(opts.cursor){where+=' AND (pl.created_at < ? OR (pl.created_at=? AND pl.user_id < ?))';params.push(opts.cursor.ts,opts.cursor.ts,opts.cursor.id);}
  const [rows]=await getPool().query(`SELECT pl.user_id,pl.created_at,u.display_name FROM publication_likes pl JOIN users u ON u.id=pl.user_id WHERE ${where} ORDER BY pl.created_at DESC,pl.user_id DESC LIMIT ?`,[...params,opts.limit+1]);
  const raw=rows as any[],items=raw.slice(0,opts.limit).map(r=>({userId:Number(r.user_id),displayName:String(r.display_name||'Viewer'),createdAt:String(r.created_at)}));
  const last=raw.length>opts.limit?raw[opts.limit-1]:null;
  return {items,last:last?{ts:String(last.created_at),id:Number(last.user_id)}:null};
}
