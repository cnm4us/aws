import { ApiError, type ApiClient } from '../api/client';
import { fetchLaunchPage, resolveLaunch, type LaunchCreator, type LaunchDestination } from './launchApi';
export class LaunchStore {
  private state={creator:null as LaunchCreator|null,loading:true,loadingMore:false,entering:false,items:[] as LaunchDestination[],nextCursor:null as string|null,error:null as string|null,sourceUnavailable:false};
  private listeners=new Set<()=>void>();private request:AbortController|null=null;private visited=new Set<string>();
  private freshUntil=0;private expiry:ReturnType<typeof setTimeout>|undefined;
  constructor(private readonly client:Pick<ApiClient,'getJson'>,readonly sourceId:number,readonly productionUlid:string|null,private readonly unauthorized:()=>void=()=>{},private readonly sourceMissing:()=>void=()=>{},readonly creatorId?:number|null){}
  getSnapshot=()=>this.state;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private publish(patch:Partial<typeof this.state>){this.state={...this.state,...patch};this.listeners.forEach(fn=>fn());}
  cancel=()=>{this.request?.abort();this.request=null;this.publish({entering:false,loading:false,loadingMore:false});};
  clear=()=>{this.cancel();clearTimeout(this.expiry);this.freshUntil=0;this.publish({creator:null,items:[],nextCursor:null});};
  ensureFresh=()=>this.request || performance.now()<this.freshUntil?Promise.resolve():this.refresh();
  refresh=()=>{this.cancel();clearTimeout(this.expiry);this.freshUntil=0;this.visited.clear();this.publish({creator:null,items:[],nextCursor:null,error:null,sourceUnavailable:false});return this.load(null);};
  more=()=>this.request || !this.state.nextCursor?Promise.resolve():this.load(this.state.nextCursor);
  private fail(error:unknown){
    if(error instanceof ApiError && [401,403,404].includes(error.status??0)){clearTimeout(this.expiry);this.freshUntil=0;this.publish({creator:null,items:[],nextCursor:null});}
    if(error instanceof ApiError && error.status===401){this.unauthorized();}
    const sourceUnavailable=error instanceof ApiError && error.code==='publication_not_found';
    this.publish({error:error instanceof Error?error.message:'Cannot load spaces. Try again.',...(sourceUnavailable?{sourceUnavailable:true,creator:null,items:[],nextCursor:null}:{})});
    if(sourceUnavailable)this.sourceMissing();
  }
  private async load(cursor:string|null){
    if(this.request)return;const request=new AbortController();this.request=request;
    this.publish({loading:!cursor,loadingMore:!!cursor,error:null});
    try{
      const page=await fetchLaunchPage(this.client,this.sourceId,this.productionUlid,request.signal,cursor,this.creatorId);
      if(this.request!==request)return;
      if(cursor)this.visited.add(cursor);
      if(page.nextCursor && this.visited.has(page.nextCursor))throw new ApiError('The space list could not advance. Try again.');
      if(!cursor){this.freshUntil=performance.now()+30_000;clearTimeout(this.expiry);
      this.expiry=setTimeout(()=>{this.freshUntil=0;this.publish({creator:null,items:[],nextCursor:null,error:'Space details expired. Refresh to check again.'});},30_000);
      (this.expiry as ReturnType<typeof setTimeout>&{unref?:()=>void}).unref?.();}
      const seen=new Set(this.state.items.map(x=>x.space.id));this.publish({creator:page.creator,items:cursor?[...this.state.items,...page.items.filter(x=>!seen.has(x.space.id))]:page.items,nextCursor:page.nextCursor});
    }catch(e){if(this.request===request)this.fail(e);}
    finally{if(this.request===request){this.request=null;this.publish({loading:false,loadingMore:false});}}
  }
  enter=async(spaceId:number)=>{
    if(performance.now()>=this.freshUntil){this.clear();this.publish({error:'Space details expired. Refresh to check again.'});return null;}
    if(this.request || !this.state.items.some(x=>x.space.id===spaceId))return null;
    const request=new AbortController();this.request=request;this.publish({entering:true,error:null});
    try{
      const result=await resolveLaunch(this.client,this.sourceId,this.productionUlid,spaceId,request.signal,this.creatorId);
      return this.request===request?result:null;
    }catch(e){if(this.request===request)this.fail(e);return null;}
    finally{if(this.request===request){this.request=null;this.publish({entering:false});}}
  };
}
