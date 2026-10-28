import type {OwnReport} from './api';
export type ReportDraft={start:string;end:string;showAll:boolean};
export const REPORT_DRAFT_LIFETIME_MS=15*60*1000;
const empty=():ReportDraft=>({start:'',end:'',showAll:false});
// Owned by one navigator identity/origin/generation. Never persisted or shared between accounts.
export class ReportMemory {
 private markers=new Map<number,{at:number;report?:OwnReport}>();
 private drafts=new Map<string,{at:number;value:ReportDraft}>();
 private uncertain=new Set<number>();private listeners=new Set<()=>void>();private revision=0;
 constructor(private now=()=>performance.now()){}
 getSnapshot=()=>this.revision;
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 private changed(){this.revision++;this.listeners.forEach(fn=>fn());}
 sent=(id:number)=>{const m=this.markers.get(id);return !!m&&this.now()-m.at<60000;};
 seed=(id:number,sent:boolean)=>{if(sent&&!this.sent(id)){this.markers.set(id,{at:this.now()});this.trim();this.changed();}};
 confirm=(id:number,report:OwnReport|null)=>{this.uncertain.delete(id);if(report)this.markers.set(id,{at:this.now(),report});else this.markers.delete(id);this.trim();this.changed();};
 private trim(){while(this.markers.size>200)this.markers.delete(this.markers.keys().next().value!);while(this.uncertain.size>200)this.uncertain.delete(this.uncertain.values().next().value!);}
 markUncertain=(id:number)=>{this.uncertain.add(id);this.trim();this.changed();};
 isUncertain=(id:number)=>this.uncertain.has(id);
 clearUncertain=(id:number)=>{this.uncertain.delete(id);this.changed();};
 draft=(key:string)=>{const d=this.drafts.get(key);return d&&this.now()-d.at<REPORT_DRAFT_LIFETIME_MS?{...d.value}:empty();};
 save=(key:string,value:ReportDraft,verifiedAt:number)=>{const now=this.now(),old=this.drafts.get(key);if(now-verifiedAt>=60000)return;const at=old&&now-old.at<REPORT_DRAFT_LIFETIME_MS?old.at:now;this.drafts.set(key,{at,value:{...value}});while(this.drafts.size>20)this.drafts.delete(this.drafts.keys().next().value!);};
 draftDeadline=(key:string)=>{const draft=this.drafts.get(key);return draft?draft.at+REPORT_DRAFT_LIFETIME_MS:null;};
 clearDraft=(key:string)=>{this.drafts.delete(key);};
 clearDrafts=()=>{this.drafts.clear();};
 clear=()=>{this.drafts.clear();this.markers.clear();this.uncertain.clear();this.changed();};
}
