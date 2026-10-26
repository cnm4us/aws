import type { ApiClient } from '../api/client';
import { VerifiedRefresh,verificationClock } from '../auth/verifiedRefresh';
import { loadFollow,setFollow,followDenied,type FollowProof,type FollowSummary } from './api';
export class FollowStore {
 private state={summary:null as FollowSummary|null,authorized:false,checking:false,busy:false,error:null as string|null,uncertain:false};
 private active=false;private generation=0;private revision=0;private write:AbortController|null=null;private listeners=new Set<()=>void>();
 private verification:VerifiedRefresh<{summary:FollowSummary;revision:number}>;
 constructor(private readonly client:ApiClient,private readonly ctx:FollowProof,verify:(signal:AbortSignal)=>Promise<void>,private readonly denied:(e:Error)=>void,now=verificationClock){
  this.verification=new VerifiedRefresh(async signal=>{
   const verifiedAt=now(),revision=this.revision;await verify(signal);
   return {value:{summary:await loadFollow(client,ctx,signal),revision},verifiedAt};
  },{protected:true,retainOnTransientError:true,now,onError:e=>{if(followDenied(e))this.denied(e);}});
  this.verification.subscribe(()=>{
   const v=this.verification.getSnapshot();
   if(!v.value){this.generation++;this.write?.abort();this.write=null;this.publish({summary:null,authorized:false,checking:v.checking,busy:false,error:v.error?.message??null});}
   else if(v.value.revision===this.revision && !this.state.busy)this.publish({summary:v.value.summary,authorized:true,checking:v.checking,error:null,uncertain:false});
   else this.publish({checking:v.checking});
  });
 }
 getSnapshot=()=>this.state;
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 private publish(patch:Partial<typeof this.state>){this.state={...this.state,...patch};this.listeners.forEach(fn=>fn());}
 setActive=(active:boolean)=>{if(this.active===active)return;this.active=active;this.verification.setActive(active,true);};
 retry=()=>{if(!this.active||this.state.busy)return;this.verification.setActive(false);this.verification.setActive(true,true);};
 toggle=()=>this.update(!this.state.summary?.following);
 follow=()=>this.update(true);
 private update=async(following:boolean)=>{
  const before=this.state.summary;
  if(!this.active || !this.state.authorized || !before?.canFollow || this.state.busy || before.following===following)return;
  const generation=this.generation,request=new AbortController();this.write=request;this.revision++;this.publish({busy:true,error:null});
  try{
   const summary=await setFollow(this.client,this.ctx,following,request.signal);
   if(this.active && this.state.authorized && this.generation===generation && !request.signal.aborted)this.publish({summary,busy:false,uncertain:false});
  }catch(e){
   if(this.active&&this.generation===generation&&!request.signal.aborted){
    this.verification.setActive(false);
    this.publish({summary:null,authorized:false,busy:false,error:e instanceof Error?e.message:'Cannot update Follow.',uncertain:!followDenied(e)});
    if(followDenied(e))this.denied(e as Error);
   }
  }finally{if(this.generation===generation){this.write=null;this.publish({busy:false});}}
 };
 dispose=()=>{this.active=false;this.verification.dispose();this.write?.abort();this.generation++;this.listeners.clear();};
}
