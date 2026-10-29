import {contextKey,type FeedContext} from '../feed/context';
import type {FeedCheckpoint} from './viewerJourney';
export type SavedFeedCheckpoint=FeedCheckpoint&{uploadId:number|null;productionUlid:string|null;creatorId:number|null};
// Scalar-only, bounded and owned by one API/account generation in the navigator.
export class FeedCheckpoints{
  private entries=new Map<string,SavedFeedCheckpoint>();
  constructor(private readonly apiOrigin:string,private readonly authGeneration:number,private readonly limit=16){}
  save(checkpoint:SavedFeedCheckpoint){
    if(checkpoint.apiOrigin!==this.apiOrigin||checkpoint.authGeneration!==this.authGeneration||!checkpoint.publicationId||!Number.isFinite(checkpoint.positionSeconds))return;
    const key=contextKey(checkpoint.context);this.entries.delete(key);
    const context:FeedContext=checkpoint.context.kind==='space'?{kind:'space',spaceId:checkpoint.context.spaceId,name:checkpoint.context.name,type:checkpoint.context.type}:{kind:checkpoint.context.kind};
    this.entries.set(key,{context,apiOrigin:this.apiOrigin,authGeneration:this.authGeneration,journeyGeneration:checkpoint.journeyGeneration,
      publicationId:checkpoint.publicationId,positionSeconds:Math.max(0,checkpoint.positionSeconds),userPaused:checkpoint.userPaused,
      uploadId:checkpoint.uploadId,productionUlid:checkpoint.productionUlid,creatorId:checkpoint.creatorId});
    while(this.entries.size>this.limit)this.entries.delete(this.entries.keys().next().value!);
  }
  take(context:FeedContext){const key=contextKey(context),value=this.entries.get(key);if(!value)return;
    this.entries.delete(key);this.entries.set(key,value);return {...value,context};}
  clear(context:FeedContext){this.entries.delete(contextKey(context));}
}
