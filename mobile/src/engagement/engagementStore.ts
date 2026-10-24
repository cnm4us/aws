import type { ApiClient } from '../api/client';
import { loadEngagement,setLike,accessDenied,type Engagement,type EngagementContext } from './api';
export class EngagementStore {
 private state={value:null as Engagement|null,loading:false,busy:false,error:null as string|null};
 private listeners=new Set<()=>void>();private request:AbortController|null=null;private generation=0;private active=false;
 constructor(private readonly client:ApiClient,private readonly ctx:EngagementContext,private readonly denied:(error:Error)=>void){}
 getSnapshot=()=>this.state;
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 private publish(patch:Partial<typeof this.state>){this.state={...this.state,...patch};this.listeners.forEach(fn=>fn());}
 setActive=(active:boolean)=>{if(this.active===active)return;this.active=active;this.cancel();if(active)void this.refresh();};
 private cancel=()=>{this.generation++;this.request?.abort();this.request=null;this.publish({value:null,loading:false,busy:false,error:null});};
 refresh=async()=>{
  if(!this.active||this.state.busy)return;
  const generation=++this.generation,request=new AbortController();this.request?.abort();this.request=request;this.publish({loading:true,error:null});
  try{const value=await loadEngagement(this.client,this.ctx,request.signal);if(this.active&&generation===this.generation)this.publish({value});}
  catch(e){if(this.active&&generation===this.generation){this.publish({error:e instanceof Error?e.message:'Cannot load likes and comments.',value:null});if(accessDenied(e))this.denied(e as Error);}}
  finally{if(generation===this.generation){this.request=null;this.publish({loading:false});}}
 };
 toggle=async()=>{
  if(!this.active||this.state.loading||this.state.busy||!this.state.value)return;
  const generation=this.generation,request=new AbortController();this.request=request;const value=this.state.value;this.publish({busy:true,error:null});
  try{const likes=await setLike(this.client,this.ctx,!value.likes.likedByMe,request.signal);if(this.active&&generation===this.generation)this.publish({value:{...value,likes}});}
  catch(e){if(this.active&&generation===this.generation){this.publish({error:e instanceof Error?e.message:'Cannot update Like.'});if(accessDenied(e)){this.publish({value:null});this.denied(e as Error);}else this.publish({value:null});}}
  finally{if(generation===this.generation){this.request=null;this.publish({busy:false});}}
 };
 dispose=()=>{this.active=false;this.cancel();this.listeners.clear();};
}
