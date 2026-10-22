import type { FeedContext } from '../feed/context';

export type PlaybackCheckpoint={publicationId:number|null;positionSeconds:number;userPaused:boolean};
export type FeedCheckpoint=PlaybackCheckpoint & {apiOrigin:string;authGeneration:number;journeyGeneration:number;context:FeedContext};
export type JourneySnapshot={generation:number;origin:FeedCheckpoint|null;creatorId:number|null;destinationActive:boolean};

// One origin survives a bounded creator detour. No player, token, URL or feed
// page belongs here; the navigator hands off all native leases before context replacement.
export class ViewerJourney {
  private state:JourneySnapshot={generation:0,origin:null,creatorId:null,destinationActive:false};
  private listeners=new Set<()=>void>();
  getSnapshot=()=>this.state;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private publish(patch:Partial<JourneySnapshot>){this.state={...this.state,...patch};this.listeners.forEach(fn=>fn());}
  open=(creatorId:number,origin:Omit<FeedCheckpoint,'journeyGeneration'>)=>{
    if(!Number.isSafeInteger(creatorId)||creatorId<=0)return;
    const generation=this.state.generation+1;
    this.publish({generation,creatorId,destinationActive:false,origin:this.state.origin??{...origin,journeyGeneration:generation}});
  };
  enter=(creatorId:number,generation:number)=>{
    if(this.state.creatorId!==creatorId || this.state.generation!==generation || !this.state.origin)return false;
    this.publish({destinationActive:true});return true;
  };
  backToProfile=()=>{this.publish({destinationActive:false});};
  originFor=(apiOrigin:string,authGeneration:number)=>{
    const origin=this.state.origin;
    return origin?.apiOrigin===apiOrigin && origin.authGeneration===authGeneration?origin:null;
  };
  reset=()=>this.publish({generation:this.state.generation+1,origin:null,creatorId:null,destinationActive:false});
}
