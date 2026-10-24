import { ApiError,type ApiClient } from '../api/client';
import { VerifiedRefresh,verificationClock } from '../auth/verifiedRefresh';
import { loadEngagement,loadComments,createComment,accessDenied,type Engagement,type EngagementContext,type Comment,type CommentSummary } from './api';
export class CommentsStore {
 private state={authorized:false,checking:false,summary:null as CommentSummary|null,items:[] as Comment[],posted:null as Comment|null,
  nextCursor:null as string|null,order:'newest' as 'newest'|'oldest',loading:false,sending:false,draft:'',error:null as string|null,uncertain:false,reconciled:false};
 private active=false;private generation=0;private page:AbortController|null=null;private write:AbortController|null=null;private cursors=new Set<string>();private listeners=new Set<()=>void>();
 private verification:VerifiedRefresh<Engagement>;
 constructor(private readonly client:ApiClient,private readonly ctx:EngagementContext,verify:(signal:AbortSignal)=>Promise<void>,private readonly denied:(error:Error)=>void,now=verificationClock){
  this.verification=new VerifiedRefresh(async signal=>{const verifiedAt=now();await verify(signal);return {value:await loadEngagement(client,ctx,signal),verifiedAt};},
   {protected:true,now,onError:error=>{if(accessDenied(error))this.denied(error);}});
  this.verification.subscribe(()=>{
   const v=this.verification.getSnapshot(),wasAuthorized=this.state.authorized;
   if(!v.value){this.cancelWork();this.publish({authorized:false,checking:v.checking,summary:null,items:[],posted:null,nextCursor:null,draft:'',uncertain:false,reconciled:false,error:v.error?.message??null});}
   else{this.publish({authorized:true,checking:v.checking,summary:v.value.comments});if(!wasAuthorized&&this.active)void this.reload();}
  });
 }
 getSnapshot=()=>this.state;
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 private publish(patch:Partial<typeof this.state>){this.state={...this.state,...patch};this.listeners.forEach(fn=>fn());}
 private cancelWork(){this.generation++;this.page?.abort();this.write?.abort();this.page=null;this.write=null;this.cursors.clear();this.state={...this.state,loading:false,sending:false};}
 setActive=(active:boolean)=>{if(this.active===active)return;this.active=active;this.verification.setActive(active,true);};
 retry=()=>{if(!this.active)return;this.verification.setActive(false);this.verification.setActive(true,true);};
 setDraft=(draft:string)=>{if(this.active&&this.state.authorized&&!this.state.sending)this.publish({draft:draft.slice(0,2000)});};
 private failed(error:unknown){if(accessDenied(error)){this.verification.setActive(false);this.publish({error:(error as Error).message});this.denied(error as Error);}}
 reload=()=>this.load(false);
 more=()=>this.load(true);
 sort=(order:'newest'|'oldest')=>{if(this.state.sending||this.state.order===order)return;this.publish({order});void this.reload();};
 private load=async(more:boolean)=>{
  if(!this.active||!this.state.authorized||this.state.sending||more&&(this.state.loading||!this.state.nextCursor||this.state.items.length>=200))return;
  const cursor=more?this.state.nextCursor:null;if(more&&this.cursors.has(cursor!)){this.publish({error:'Cannot load more comments. Refresh the list.',nextCursor:null});return;}
  this.page?.abort();const request=new AbortController(),generation=++this.generation;this.page=request;
  if(!more)this.cursors.clear();this.publish({loading:true,error:null,...(!more?{items:[],nextCursor:null}:{})});
  try{
   const value=await loadComments(this.client,this.ctx,this.state.order,cursor,request.signal);
   if(!this.active||generation!==this.generation||request.signal.aborted)return;
   if(value.nextCursor&&(value.nextCursor===cursor||this.cursors.has(value.nextCursor)))throw new ApiError('Cannot load more comments. Refresh the list.');
   if(cursor)this.cursors.add(cursor);
   const items=[...(more?this.state.items:[]),...value.items].filter((item,index,all)=>all.findIndex(c=>c.id===item.id)===index).slice(0,200);
   this.publish({items,nextCursor:value.nextCursor,summary:value.comments,reconciled:this.state.uncertain||this.state.reconciled});
  }catch(e){if(this.active&&generation===this.generation&&!request.signal.aborted){this.publish({error:e instanceof Error?e.message:'Cannot load comments.'});this.failed(e);}}
  finally{if(generation===this.generation){this.page=null;this.publish({loading:false});}}
 };
 send=async()=>{
  if(!this.active||!this.state.authorized||!this.state.summary?.canComment||this.state.sending||this.state.loading||!this.state.draft.trim()||this.state.uncertain&&!this.state.reconciled)return;
  const body=this.state.draft.trim(),generation=this.generation,request=new AbortController();this.write=request;this.publish({sending:true,error:null});
  try{
   const result=await createComment(this.client,this.ctx,body,request.signal);
   if(this.active&&generation===this.generation&&!request.signal.aborted)this.publish({posted:result.item,summary:result.comments,draft:'',uncertain:false,reconciled:false});
  }catch(e){
   if(this.active&&generation===this.generation&&!request.signal.aborted){
    const definite=e instanceof ApiError&&e.status!==undefined&&e.status>=400&&e.status<500;
    this.publish({error:e instanceof Error?e.message:'Cannot send comment.',uncertain:!definite,reconciled:false});
    if(e instanceof ApiError&&['comments_disabled','comment_forbidden'].includes(e.code??''))this.publish({summary:this.state.summary?{...this.state.summary,canComment:false,disabledReason:e.code as 'comments_disabled'|'comment_forbidden'}:null});
    this.failed(e);
   }
  }finally{if(generation===this.generation){this.write=null;this.publish({sending:false});}}
 };
 dispose=()=>{this.active=false;this.verification.dispose();this.cancelWork();this.listeners.clear();};
}
