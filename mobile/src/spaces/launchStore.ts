import { ApiError, type ApiClient } from '../api/client';
import { fetchLaunchPage, resolveLaunch, type LaunchDestination } from './launchApi';
export class LaunchStore {
  private state={loading:true,loadingMore:false,entering:false,items:[] as LaunchDestination[],nextCursor:null as string|null,error:null as string|null,sourceUnavailable:false};
  private listeners=new Set<()=>void>();private request:AbortController|null=null;private visited=new Set<string>();
  constructor(private readonly client:Pick<ApiClient,'getJson'>,readonly sourceId:number,readonly productionUlid:string|null,private readonly unauthorized:()=>void=()=>{},private readonly sourceMissing:()=>void=()=>{}){}
  getSnapshot=()=>this.state;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private publish(patch:Partial<typeof this.state>){this.state={...this.state,...patch};this.listeners.forEach(fn=>fn());}
  cancel=()=>{this.request?.abort();this.request=null;this.publish({entering:false,loading:false,loadingMore:false});};
  refresh=()=>{this.cancel();this.visited.clear();this.publish({items:[],nextCursor:null,error:null,sourceUnavailable:false});return this.load(null);};
  more=()=>this.request || !this.state.nextCursor?Promise.resolve():this.load(this.state.nextCursor);
  private fail(error:unknown){
    if(error instanceof ApiError && error.status===401){this.publish({items:[],nextCursor:null});this.unauthorized();}
    const sourceUnavailable=error instanceof ApiError && error.code==='publication_not_found';
    this.publish({error:error instanceof Error?error.message:'Cannot load spaces. Try again.',...(sourceUnavailable?{sourceUnavailable:true,items:[],nextCursor:null}:{})});
    if(sourceUnavailable)this.sourceMissing();
  }
  private async load(cursor:string|null){
    if(this.request)return;const request=new AbortController();this.request=request;
    this.publish({loading:!cursor,loadingMore:!!cursor,error:null});
    try{
      const page=await fetchLaunchPage(this.client,this.sourceId,this.productionUlid,request.signal,cursor);
      if(this.request!==request)return;
      if(cursor)this.visited.add(cursor);
      if(page.nextCursor && this.visited.has(page.nextCursor))throw new ApiError('The space list could not advance. Try again.');
      const seen=new Set(this.state.items.map(x=>x.space.id));this.publish({items:cursor?[...this.state.items,...page.items.filter(x=>!seen.has(x.space.id))]:page.items,nextCursor:page.nextCursor});
    }catch(e){if(this.request===request)this.fail(e);}
    finally{if(this.request===request){this.request=null;this.publish({loading:false,loadingMore:false});}}
  }
  enter=async(spaceId:number)=>{
    if(this.request || !this.state.items.some(x=>x.space.id===spaceId))return null;
    const request=new AbortController();this.request=request;this.publish({entering:true,error:null});
    try{
      const result=await resolveLaunch(this.client,this.sourceId,this.productionUlid,spaceId,request.signal);
      return this.request===request?result:null;
    }catch(e){if(this.request===request)this.fail(e);return null;}
    finally{if(this.request===request){this.request=null;this.publish({entering:false});}}
  };
}
