import { engagementAccess } from './access';
import * as repo from './repo';
import { encodeCursor, type Context, type PageOptions } from './contract';
import { ViewerApiError } from '../native-sessions/service';
const dependencies={access:engagementAccess,...repo};
export function createEngagementService(deps=dependencies) {
  const summary=async(ctx:Context)=>{
    await deps.access(ctx.spaceId,ctx.publicationId,ctx.userId);
    const value=await deps.summary(ctx);
    const capability=await deps.access(ctx.spaceId,ctx.publicationId,ctx.userId);
    return {spaceId:ctx.spaceId,publicationId:ctx.publicationId,likes:value.likes,comments:{...value.comments,...capability}};
  };
  return {
    summary,
    like:async(ctx:Context,liked:boolean)=>{
      await deps.access(ctx.spaceId,ctx.publicationId,ctx.userId);
      return deps.transaction(ctx.publicationId,async db=>{
        await deps.access(ctx.spaceId,ctx.publicationId,ctx.userId,db);
        await deps.setLike(ctx,liked,db);
        return {spaceId:ctx.spaceId,publicationId:ctx.publicationId,likes:(await deps.summary(ctx,db)).likes};
      });
    },
    comments:async(ctx:Context,opts:PageOptions,parentId:number|null=null)=>{
      await deps.access(ctx.spaceId,ctx.publicationId,ctx.userId);
      if(parentId!==null)await deps.parent(ctx,parentId);
      const page=await deps.comments(ctx,opts,parentId);
      // Recheck after the page read; an earlier capability is not a lease.
      const fresh=await deps.access(ctx.spaceId,ctx.publicationId,ctx.userId);
      return {spaceId:ctx.spaceId,publicationId:ctx.publicationId,items:page.items,
        nextCursor:page.last?encodeCursor(ctx,opts.order,page.last.ts,page.last.id):null,comments:{...(await deps.summary(ctx)).comments,...fresh}};
    },
    create:async(ctx:Context,body:string,parentId:number|null=null)=>{
      await deps.access(ctx.spaceId,ctx.publicationId,ctx.userId);
      return deps.transaction(ctx.publicationId,async db=>{
        const capability=await deps.access(ctx.spaceId,ctx.publicationId,ctx.userId,db);
        if(!capability.canComment)throw new ViewerApiError(403,capability.disabledReason!);
        if(parentId!==null)await deps.parent(ctx,parentId,db);
        const item=await deps.insertComment(ctx,body,parentId,db);
        return {spaceId:ctx.spaceId,publicationId:ctx.publicationId,item,comments:{...(await deps.summary(ctx,db)).comments,...capability}};
      });
    },
    likers:async(ctx:Context,opts:PageOptions)=>{
      await deps.access(ctx.spaceId,ctx.publicationId,ctx.userId);const page=await deps.likers(ctx,opts);
      await deps.access(ctx.spaceId,ctx.publicationId,ctx.userId);
      return {items:page.items,nextCursor:page.last?encodeCursor(ctx,'newest',page.last.ts,page.last.id):null};
    },
  };
}
export const engagement=createEngagementService();
