import { ApiError, type ApiClient } from '../api/client';
import { fetchLaunchPage, resolveLaunch, type LaunchCreator, type LaunchDestination,type LaunchResolved } from './launchApi';
export class LaunchStore {
  private state={creator:null as LaunchCreator|null,loading:true,loadingMore:false,entering:false,items:[] as LaunchDestination[],nextCursor:null as string|null,error:null as string|null,sourceUnavailable:false};
  private listeners=new Set<()=>void>();private request:AbortController|null=null;private visited=new Set<string>();
  private entries=new Map<number,{request:AbortController;pending:Promise<LaunchResolved>;value?:LaunchResolved}>();private enterGeneration=0;
  private freshUntil=0;private expiry:ReturnType<typeof setTimeout>|undefined;
  constructor(private readonly client:Pick<ApiClient,'getJson'>,readonly sourceId:number,readonly productionUlid:string|null,private readonly unauthorized:()=>void=()=>{},private readonly sourceMissing:()=>void=()=>{},readonly creatorId?:number|null,private acceptEntry?:(result:LaunchResolved)=>boolean){}
  getSnapshot=()=>this.state;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private publish(patch:Partial<typeof this.state>){this.state={...this.state,...patch};this.listeners.forEach(fn=>fn());}
  cancel=()=>{this.enterGeneration++;for(const e of this.entries.values())if(!e.value)e.request.abort();this.request?.abort();this.request=null;this.publish({entering:false,loading:false,loadingMore:false});};
  clear=()=>{this.cancel();for(const e of this.entries.values())e.request.abort();this.entries.clear();clearTimeout(this.expiry);this.freshUntil=0;this.publish({creator:null,items:[],nextCursor:null});};
  ensureFresh=()=>this.request || performance.now()<this.freshUntil?Promise.resolve():this.refresh();
  refresh=()=>{this.clear();clearTimeout(this.expiry);this.freshUntil=0;this.visited.clear();this.publish({creator:null,items:[],nextCursor:null,error:null,sourceUnavailable:false});return this.load(null);};
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
  prepareEntries=(ids:number[])=>{
    if(!this.acceptEntry||performance.now()>=this.freshUntil)return;
    for(const id of ids.slice(0,2))if(this.state.items.some(i=>i.space.id===id))void this.entry(id).catch(()=>{});
  };
  private entry=(spaceId:number):Promise<LaunchResolved>=>{
    const old=this.entries.get(spaceId);
    if(old?.value&&this.acceptEntry?.(old.value))return Promise.resolve(old.value);
    if(old&&!old.value&&!old.request.signal.aborted)return old.pending;
    old?.request.abort();this.entries.delete(spaceId);
    while(this.entries.size>=2){const key=this.entries.keys().next().value!;this.entries.get(key)?.request.abort();this.entries.delete(key);}
    const request=new AbortController();
    const record={request,pending:null as unknown as Promise<LaunchResolved>,value:undefined as LaunchResolved|undefined};
    record.pending=resolveLaunch(this.client,this.sourceId,this.productionUlid,spaceId,request.signal,this.creatorId,!!this.acceptEntry).then(result=>{
      if(request.signal.aborted)throw Error('Cancelled');
      if(this.acceptEntry&&!this.acceptEntry(result))throw new ApiError('Access confirmation expired. Try again.');
      record.value=result;return result;
    }).catch(error=>{if(this.entries.get(spaceId)===record)this.entries.delete(spaceId);
      if(!this.state.entering&&!request.signal.aborted&&error instanceof ApiError&&(error.status===401||error.code==='publication_not_found'))this.fail(error);throw error;
    });
    this.entries.set(spaceId,record);return record.pending;
  };
  enter=async(spaceId:number)=>{
    if(performance.now()>=this.freshUntil){this.clear();this.publish({error:'Space details expired. Refresh to check again.'});return null;}
    if(this.request || this.state.entering || !this.state.items.some(x=>x.space.id===spaceId))return null;
    const generation=++this.enterGeneration;this.publish({entering:true,error:null});
    try{return await this.entry(spaceId).then(result=>generation===this.enterGeneration?result:null);}
    catch(error){if(generation===this.enterGeneration)this.fail(error);return null;}
    finally{if(generation===this.enterGeneration)this.publish({entering:false});}
  };
}
