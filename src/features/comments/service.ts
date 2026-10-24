import { engagement } from '../engagement/service';
import type { PageOptions } from '../engagement/contract';
const legacy=(r:Awaited<ReturnType<typeof engagement.comments>>)=>({...r,items:r.items.map(c=>({id:c.id,userId:c.author.id,displayName:c.author.displayName,body:c.body,createdAt:c.createdAt}))});
export async function create(pubId:number,userId:number,spaceId:number,body:string,parentId:number|null) {
  const r=await engagement.create({publicationId:pubId,userId,spaceId},body,parentId);return {id:r.item.id};
}
export async function listTop(pubId:number,userId:number,spaceId:number,opts:PageOptions) {
  return legacy(await engagement.comments({publicationId:pubId,userId,spaceId},opts));
}
export async function listReplies(pubId:number,userId:number,spaceId:number,parentId:number,opts:PageOptions) {
  return legacy(await engagement.comments({publicationId:pubId,userId,spaceId},opts,parentId));
}
