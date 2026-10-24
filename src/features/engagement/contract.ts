import { ViewerApiError } from '../native-sessions/service';
export const positiveId = (value: unknown): number => {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new ViewerApiError(400,'invalid_query');
  return Number(value);
};
export type Context = { spaceId: number; publicationId: number; userId: number };
export type PageOptions = { limit: number; order: 'newest'|'oldest'; cursor: {ts:string;id:number}|null };
export function parsePage(query: Record<string,unknown>, ctx: Context, legacy = false): PageOptions {
  if(Object.keys(query).some(k=>!['limit','cursor','order',...(legacy?['spaceId']:[])].includes(k)))throw new ViewerApiError(400,'invalid_query');
  const limit=query.limit===undefined?20:positiveId(query.limit);
  const order=query.order===undefined?'newest':query.order;
  if(limit>50 || !['newest','oldest'].includes(String(order)) || typeof order!=='string')throw new ViewerApiError(400,'invalid_query');
  let cursor: PageOptions['cursor']=null;
  if(query.cursor!==undefined) {
    try {
      if(typeof query.cursor!=='string' || query.cursor.length>512 || !/^[\w-]+$/.test(query.cursor))throw Error();
      const c=JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8'));
      if(Object.keys(c).sort().join(',')!=='id,order,publicationId,spaceId,ts,userId,v' || c.v!==1 || c.spaceId!==ctx.spaceId || c.publicationId!==ctx.publicationId || c.userId!==ctx.userId || c.order!==order
        || !Number.isSafeInteger(c.id) || c.id<1 || typeof c.ts!=='string' || !/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d{1,6})?$/.test(c.ts) || !Number.isFinite(Date.parse(c.ts)))throw Error();
      cursor={ts:c.ts,id:c.id};
    } catch {throw new ViewerApiError(400,'invalid_query');}
  }
  return {limit,order:order as PageOptions['order'],cursor};
}
export const encodeCursor = (ctx:Context,order:PageOptions['order'],ts:string,id:number) => Buffer.from(JSON.stringify({v:1,...ctx,order,ts,id})).toString('base64url');
export function commentBody(input:unknown,legacy=false):{body:string;parentId:number|null} {
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(k=>!['body',...(legacy?['parentId']:[])].includes(k)))throw new ViewerApiError(400,'invalid_body');
  const value=input as any;
  if(typeof value.body!=='string' || !value.body.trim() || value.body.trim().length>2000 || value.parentId!=null && (!legacy || !Number.isSafeInteger(value.parentId) || value.parentId<1))throw new ViewerApiError(400,'invalid_body');
  return {body:value.body.trim(),parentId:value.parentId??null};
}
export function emptyQuery(query:Record<string,unknown>,legacy=false) {
  if(Object.keys(query).some(k=>!legacy || k!=='spaceId'))throw new ViewerApiError(400,'invalid_query');
}
export function noBody(body:unknown) { if(body!==undefined && (body===null || typeof body!=='object' || Array.isArray(body) || Object.keys(body).length))throw new ViewerApiError(400,'invalid_body'); }
