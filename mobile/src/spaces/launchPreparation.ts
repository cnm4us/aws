import type { ApiClient } from '../api/client';
import type { FeedVideoItem } from '../feed/types';
import { LaunchStore } from './launchStore';

// Exactly one selected source, scoped to a navigator's API/account generation.
export class LaunchPreparation {
  private current:LaunchStore|null=null;
  constructor(private client:Pick<ApiClient,'getJson'>,private unauthorized:()=>void){}
  get=(sourceId:number,productionUlid:string|null,creatorId:number|null)=>{
    if(this.current?.sourceId!==sourceId || this.current.productionUlid!==productionUlid || this.current.creatorId!==creatorId){
      this.clear();this.current=new LaunchStore(this.client,sourceId,productionUlid,this.unauthorized,undefined,creatorId);
    }
    return this.current;
  };
  prepare=(item:FeedVideoItem)=>{if(!item.creator.id || !item.productionUlid)return;void this.get(item.publicationId,item.productionUlid,item.creator.id).ensureFresh();};
  clear=()=>{this.current?.clear();this.current=null;};
}
