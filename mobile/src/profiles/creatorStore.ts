import { ApiError, type ApiClient } from '../api/client';
import type { FeedContext } from '../feed/context';

export type CreatorView={creator:{id:number;displayName:string;handle:string|null;avatarUrl:string|null;bio:string|null};
  personalEntry:{state:'sign_in_required'|'unavailable'}|{state:'allowed';space:{id:number;ulid:string|null;name:string;slug:string;type:'personal'}}};
const record=(v:unknown):Record<string,unknown>|null=>v!==null && typeof v==='object' && !Array.isArray(v)?v as Record<string,unknown>:null;
const id=(v:unknown)=>typeof v==='number' && Number.isSafeInteger(v) && v>0;
function optionalText(v:unknown,max:number){if(v===null)return null;if(typeof v!=='string')throw new ApiError('Unexpected creator response.');return v.slice(0,max);}
export function adaptCreator(value:unknown,expectedId:number):CreatorView {
  const raw=record(value),creator=record(raw?.creator),entry=record(raw?.personalEntry);
  if(creator?.id!==expectedId || typeof creator.displayName!=='string' || !creator.displayName.trim() || !entry)throw new ApiError('Unexpected creator response.');
  let avatarUrl=optionalText(creator.avatarUrl,2048);
  if(avatarUrl)try{const u=new URL(avatarUrl);if(u.protocol!=='https:'||u.username||u.password)avatarUrl=null;}catch{avatarUrl=null;}
  let personalEntry:CreatorView['personalEntry'];
  if(entry.state==='allowed') {
    const s=record(entry.space);
    if(!s || !id(s.id) || s.type!=='personal' || typeof s.name!=='string' || typeof s.slug!=='string')throw new ApiError('Unexpected personal-space response.');
    personalEntry={state:'allowed',space:{id:s.id as number,name:s.name.slice(0,200),slug:s.slug.slice(0,200),type:'personal',ulid:optionalText(s.ulid,26)}};
  }else if(entry.state==='unavailable'||entry.state==='sign_in_required')personalEntry={state:entry.state};
  else throw new ApiError('Unexpected personal-space response.');
  return {creator:{id:expectedId,displayName:creator.displayName.slice(0,120),handle:optionalText(creator.handle,64),
    avatarUrl,bio:optionalText(creator.bio,2000)},personalEntry};
}

export class CreatorStore {
  private state:{loading:boolean;entering:boolean;view:CreatorView|null;error:string|null;missing:boolean}={loading:true,entering:false,view:null,error:null,missing:false};
  private listeners=new Set<()=>void>();
  private request:AbortController|null=null;
  constructor(private readonly client:Pick<ApiClient,'getJson'>,readonly creatorId:number,private readonly unauthorized:()=>void=()=>{}){}
  getSnapshot=()=>this.state;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private publish(patch:Partial<typeof this.state>){this.state={...this.state,...patch};this.listeners.forEach(fn=>fn());}
  cancel=()=>{this.request?.abort();this.request=null;};
  refresh=()=>this.load(false);
  enter=async():Promise<Extract<FeedContext,{kind:'space'}>|null>=>{
    if(this.request || this.state.view?.personalEntry.state!=='allowed')return null;
    const view=await this.load(true);
    const entry=view?.personalEntry;
    return entry?.state==='allowed'?{kind:'space',spaceId:entry.space.id,name:entry.space.name,type:'personal'}:null;
  };
  private async load(entering:boolean) {
    this.cancel();const request=new AbortController();this.request=request;
    this.publish({loading:!entering,entering,error:null,missing:false,...(!entering?{view:null}:{})});
    try {
      const view=adaptCreator(await this.client.getJson(`/api/viewer/v1/creators/${this.creatorId}`,request.signal),this.creatorId);
      if(this.request!==request || request.signal.aborted)return null;
      this.publish({view,loading:false,entering:false});return view;
    }catch(error){
      if(this.request!==request || request.signal.aborted)return null;
      if(error instanceof ApiError && error.status===401)this.unauthorized();
      this.publish({view:null,loading:false,entering:false,missing:error instanceof ApiError && error.status===404,
        error:error instanceof Error?error.message:'Cannot load the profile. Try again.'});
      return null;
    }finally{if(this.request===request)this.request=null;}
  }
}
