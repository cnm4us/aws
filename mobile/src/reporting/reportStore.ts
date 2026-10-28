import {ApiError,type ApiClient} from '../api/client';
import {VerifiedRefresh,verificationClock} from '../auth/verifiedRefresh';
import {loadReportOptions,loadReportDetail,sendReport,reportDenied,parseReportTime,type ReportTarget,type ReportOptions,type ReportDetail,type ReportInput} from './api';
import {ReportMemory,type ReportDraft} from './reportMemory';
export type SelectedReportRule={groupId:number;ruleId:number;title:string};
const expiredTimes='Your time edits expired. Go Back and review the video segment before reporting.';
export class ReportStore {
 private state={options:null as ReportOptions|null,detail:null as ReportDetail|null,selected:null as SelectedReportRule|null,draft:null as ReportDraft|null,authorized:false,checking:false,sending:false,loadingDetail:false,error:null as string|null,uncertain:false,needsTimeReview:false,pendingInput:null as ReportInput|null};
 private active=false;private disposed=false;private detailRequest:AbortController|null=null;private write:AbortController|null=null;private listeners=new Set<()=>void>();private verifiedAt=0;private draftTimer:ReturnType<typeof setTimeout>|undefined;
 private detailDeadline:number|null=null;private detailRenew:ReturnType<typeof setTimeout>|undefined;private detailExpiry:ReturnType<typeof setTimeout>|undefined;
 private verification:VerifiedRefresh<ReportOptions>;private proofs=new WeakMap<ReportOptions,number>();private lastOptions:ReportOptions|null=null;
 constructor(private client:ApiClient,private target:ReportTarget,private memory:ReportMemory,private key:string,private denied:(error:Error)=>void,private sent:()=>void,private now=verificationClock){
  this.verification=new VerifiedRefresh(async signal=>{const at=this.now(),value=await loadReportOptions(client,target,signal);this.proofs.set(value,at);return {value,verifiedAt:at};},
   {protected:true,retainOnTransientError:true,now,onError:e=>{if(reportDenied(e))this.denied(e);}});
  this.verification.subscribe(()=>{
   const v=this.verification.getSnapshot();
   if(!v.value){
    this.cancel();if(v.error)this.memory.clearDraft(this.key);
    this.publish({options:null,detail:null,selected:null,draft:null,authorized:false,checking:v.checking,error:v.error?.message??null});
   }else{
    this.verifiedAt=this.proofs.get(v.value)??0;
    if(this.lastOptions!==v.value){
     const selected=this.state.selected;
     if(selected&&!this.mapped(v.value,selected.groupId,selected.ruleId)){
      this.clearDetailWork();this.publish({detail:null,loadingDetail:false,error:'This rule is currently unavailable. Go Back to explore other reasons.'});
     }
     this.lastOptions=v.value;if(!this.write||v.value.myReport)this.memory.confirm(target.publicationId,v.value.myReport);
    }
    this.publish({options:v.value,authorized:true,checking:v.checking,draft:this.state.draft??this.memory.draft(key),uncertain:this.memory.isUncertain(target.publicationId)});this.armDraftExpiry();
   }
  });
 }
 getSnapshot=()=>this.state;
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 private publish(patch:Partial<typeof this.state>){this.state={...this.state,...patch};this.listeners.forEach(fn=>fn());}
 private mapped(options:ReportOptions,groupId:number,ruleId:number){return options.groups.find(g=>g.id===groupId)?.rules.find(r=>r.id===ruleId);}
 private optionsFresh(){return this.active&&this.state.authorized&&this.state.options!==null&&this.now()-this.verifiedAt<60000;}
 private cancel(){clearTimeout(this.draftTimer);this.clearDetailWork();if(this.write&&!this.state.options?.reportedByMe)this.memory.markUncertain(this.target.publicationId);this.write?.abort();this.write=null;this.state={...this.state,sending:false,loadingDetail:false,pendingInput:null};}
 private expireDraft=()=>{
  const changed=!!(this.state.draft?.start.trim()||this.state.draft?.end.trim());this.memory.clearDraft(this.key);
  if(this.active)this.publish({draft:this.memory.draft(this.key),needsTimeReview:this.state.needsTimeReview||changed,error:changed?expiredTimes:this.state.error});
 };
 private armDraftExpiry(){clearTimeout(this.draftTimer);const deadline=this.memory.draftDeadline(this.key);if(deadline!==null)this.draftTimer=setTimeout(this.expireDraft,Math.max(0,deadline-this.now()));}
 setActive=(active:boolean)=>{if(this.disposed||this.active===active)return;this.active=active;this.verification.setActive(active,true);};
 retry=()=>{if(this.active&&!this.state.sending)void this.verification.refresh(!!this.state.options);};
 edit=(patch:Partial<ReportDraft>)=>{
  if(!this.optionsFresh()||this.state.selected||this.state.sending||this.state.options?.reportedByMe)return;
  const draft={...this.state.draft!,...patch};this.memory.save(this.key,draft,this.verifiedAt);this.armDraftExpiry();this.publish({draft,error:null,needsTimeReview:false});
 };
 private clearDetailWork(){clearTimeout(this.detailRenew);clearTimeout(this.detailExpiry);this.detailRequest?.abort();this.detailRequest=null;this.detailDeadline=null;}
 back=()=>{this.clearDetailWork();this.publish({selected:null,detail:null,loadingDetail:false,error:this.state.needsTimeReview?expiredTimes:null});};
 retryDetail=()=>{const selected=this.state.selected;if(selected)void this.detail(selected.groupId,selected.ruleId);};
 detail=async(groupId:number,ruleId:number,quiet=false)=>{
  if(!this.optionsFresh()||this.state.sending)return;
  const rule=this.mapped(this.state.options!,groupId,ruleId);if(!rule)return;
  if(quiet&&(this.state.selected?.groupId!==groupId||this.state.selected.ruleId!==ruleId))return;
  const startedAt=this.now();
  const expire=()=>{this.clearDetailWork();this.publish({detail:null,loadingDetail:false,error:'Explanation verification expired. Retry or go Back.'});};
  if(quiet&&startedAt>=(this.detailDeadline??0)){expire();return;}
  if(!quiet){
   this.clearDetailWork();const fromList=!this.state.selected;
   this.publish({selected:{groupId,ruleId,title:rule.title},needsTimeReview:fromList?false:this.state.needsTimeReview});
  }
  this.detailRequest?.abort();const request=new AbortController();this.detailRequest=request;
  this.publish({loadingDetail:!quiet,error:this.state.needsTimeReview?expiredTimes:this.rangeError(),...(!quiet?{detail:null}:{})});
  if(!quiet){this.detailDeadline=startedAt+60000;this.detailExpiry=setTimeout(expire,60000);}
  try{
   const detail=await loadReportDetail(this.client,this.target,groupId,ruleId,request.signal);
   if(!this.optionsFresh()||request.signal.aborted||this.state.selected?.groupId!==groupId||this.state.selected.ruleId!==ruleId)return;
   if(!this.mapped(this.state.options!,groupId,ruleId)){expire();return;}
   if(this.now()>=(this.detailDeadline??0)||this.now()-startedAt>=60000){expire();return;}
   clearTimeout(this.detailRenew);clearTimeout(this.detailExpiry);this.detailDeadline=startedAt+60000;
   this.detailExpiry=setTimeout(expire,Math.max(0,this.detailDeadline-this.now()));
   this.detailRenew=setTimeout(()=>{void this.detail(groupId,ruleId,true);},Math.max(0,startedAt+45000-this.now()));
   this.publish({detail});
  }catch(e){if(this.active&&!request.signal.aborted){
   if(reportDenied(e)){this.verification.setActive(false);this.denied(e as Error);}
   else if(quiet&&!(e instanceof ApiError&&e.status===404)&&this.state.detail&&this.now()<(this.detailDeadline??0)){
    this.detailRenew=setTimeout(()=>{void this.detail(groupId,ruleId,true);},5000);
   }else{this.clearDetailWork();this.publish({detail:null,loadingDetail:false,error:e instanceof Error?e.message:'Cannot load explanation.'});}
  }}finally{if(this.detailRequest===request){this.detailRequest=null;this.publish({loadingDetail:false});}}
 };
 private rangeInput(){
  const draft=this.state.draft!,start=parseReportTime(draft.start),end=parseReportTime(draft.end);
  if(start!==null&&end!==null&&end<start)throw new Error('End must be at or after Start.');
  if(this.state.options?.durationSeconds!==null&&[start,end].some(n=>n!==null&&n>Math.floor(this.state.options!.durationSeconds!)))throw new Error('Times must be within this video’s duration.');
  return {reportedStartSeconds:start,reportedEndSeconds:end};
 }
 private rangeError(){try{this.rangeInput();return null;}catch(e){return `${(e as Error).message} Go Back to edit the video segment.`;}}
 canSubmit=()=>{
  const {selected,detail,options}=this.state;
  if(!this.state.draft||this.rangeError())return false;
  return !!(this.optionsFresh()&&selected&&detail&&options&&!options.reportedByMe&&!this.state.sending&&!this.memory.isUncertain(this.target.publicationId)&&!this.state.needsTimeReview&&this.state.draft&&this.now()<(this.detailDeadline??0)&&detail.groupId===selected.groupId&&detail.ruleId===selected.ruleId&&this.mapped(options,selected.groupId,selected.ruleId));
 };
 sendSelected=async()=>{const s=this.state.selected;if(s)await this.send(s.groupId,s.ruleId);};
 send=async(groupId:number,ruleId?:number)=>{
  if(!this.canSubmit()||this.state.selected?.groupId!==groupId||this.state.selected.ruleId!==ruleId)return;
  // A delayed JS timer cannot make expired range edits actionable.
  const deadline=this.memory.draftDeadline(this.key);if(deadline!==null&&this.now()>=deadline){this.expireDraft();return;}
  const options=this.state.options!,input:ReportInput={userFacingRuleId:groupId,ruleId,...this.rangeInput()};
  const request=new AbortController();this.write=request;this.memory.markUncertain(this.target.publicationId);this.publish({sending:true,error:null,pendingInput:input});
  try{
   const report=await sendReport(this.client,this.target,input,request.signal);
   if(!this.active||request.signal.aborted)return;
   this.memory.confirm(this.target.publicationId,report);this.memory.clearDraft(this.key);this.publish({options:{...options,reportedByMe:true,myReport:report},draft:null,uncertain:false});this.sent();
  }catch(e){
   if(!this.active||request.signal.aborted)return;
   const definite=e instanceof ApiError&&e.status!==undefined&&e.status>=400&&e.status<500;
   if(definite&&!(e.status===409&&e.code==='already_reported'))this.memory.clearUncertain(this.target.publicationId);
   this.publish({error:e instanceof Error?e.message:'Cannot send report.',uncertain:this.memory.isUncertain(this.target.publicationId)});
   if(definite){this.write=null;this.publish({sending:false,pendingInput:null});}
   if(reportDenied(e)){this.verification.setActive(false);this.denied(e as Error);}
   else if(!definite||e instanceof ApiError&&e.code==='already_reported'){
    const reconciled=await this.verification.refresh(true);if(reconciled&&this.active&&this.state.options?.reportedByMe){this.memory.clearDraft(this.key);this.sent();}
   }else if(e instanceof ApiError&&['rule_not_allowed','no_resolvable_rule','invalid_user_facing_rule_id'].includes(e.code??''))void this.verification.refresh(true);
  }finally{if(this.write===request){this.write=null;this.publish({sending:false,pendingInput:null});}}
 };
 clearDraft=()=>{this.memory.clearDraft(this.key);};
 dispose=()=>{this.active=false;this.disposed=true;this.verification.dispose();this.cancel();this.listeners.clear();};
}
