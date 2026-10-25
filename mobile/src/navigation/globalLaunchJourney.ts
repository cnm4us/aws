import type { FeedCheckpoint } from './viewerJourney';
import type { LaunchResolved } from '../spaces/launchApi';
import type { FeedContext } from '../feed/context';
import type { FeedPage } from '../feed/types';
import { ApiError } from '../api/client';
export type LaunchEntry={publicationId:number;productionUlid:string|null;positionSeconds:number;userPaused:boolean;spaceId:number;creatorId?:number};
export type LaunchOrigin=FeedCheckpoint & {productionUlid:string|null;creatorId?:number|null};
export class GlobalLaunchJourney {
  private state={generation:0,origin:null as LaunchOrigin|null,destination:null as LaunchResolved|null,sourceUnavailable:false};
  private listeners=new Set<()=>void>();
  getSnapshot=()=>this.state;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private publish(patch:Partial<typeof this.state>){this.state={...this.state,...patch};this.listeners.forEach(fn=>fn());}
  open=(origin:LaunchOrigin)=>{this.publish({generation:this.state.generation+1,origin,destination:null,sourceUnavailable:false});return this.state.generation;};
  enter=(result:LaunchResolved,generation:number):{context:FeedContext;entry:LaunchEntry}|null=>{
    const origin=this.state.origin;
    if(!origin || generation!==this.state.generation || origin.publicationId!==result.sourcePublicationId || origin.productionUlid!==null && origin.productionUlid!==result.productionUlid || origin.creatorId!==undefined && origin.creatorId!==result.creator.id)return null;
    this.publish({destination:result});
    return {context:{kind:'space',spaceId:result.space.id,name:result.space.name,type:result.space.type},entry:{publicationId:result.publicationId,productionUlid:result.productionUlid,spaceId:result.space.id,creatorId:result.creator.id,
      positionSeconds:origin.productionUlid!==null && origin.productionUlid===result.productionUlid?origin.positionSeconds:0,userPaused:origin.userPaused}};
  };
  missing=(generation:number)=>{if(generation===this.state.generation)this.publish({sourceUnavailable:true});};
  originFor=(apiOrigin:string,authGeneration:number)=>this.state.origin?.apiOrigin===apiOrigin && this.state.origin.authGeneration===authGeneration?this.state.origin:null;
  reset=()=>this.publish({generation:this.state.generation+1,origin:null,destination:null,sourceUnavailable:false});
}
export function validateLaunchEntry(page:FeedPage,entry:LaunchEntry):FeedPage {
  const item=page.items.find(i=>i.publicationId===entry.publicationId);
  if(page.resume?.outcome!=='restored' || page.resume.restoredPublicationId!==entry.publicationId || !item || item.spaceId!==entry.spaceId || entry.productionUlid!==null && item.productionUlid!==entry.productionUlid || entry.creatorId!==undefined && item.creator.id!==entry.creatorId)
    throw new ApiError('This video is no longer available in this space. Choose another space or return to Global.',404,'launch_target_unavailable');
  return page;
}
export function validateOriginProduction(page:FeedPage,origin:FeedCheckpoint & {productionUlid?:string|null}):FeedPage {
  if(origin.productionUlid && page.resume?.outcome==='restored' && page.items.find(i=>i.publicationId===origin.publicationId)?.productionUlid!==origin.productionUlid)
    return {...page,resume:{requestedPublicationId:origin.publicationId!,restoredPublicationId:null,outcome:'unavailable'}};
  return page;
}
