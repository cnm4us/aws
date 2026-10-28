import { ApiError, type ApiClient } from '../api/client';
export type ReportContext = {kind:'global'} | {kind:'space';spaceId:number};
export type ReportTarget = {context:ReportContext;publicationId:number};
export type ReportRule = {id:number;slug:string;title:string;shortDescription:string|null;isDefault:boolean};
export type ReportGroup = {id:number;label:string;shortDescription:string|null;rules:ReportRule[]};
export type OwnReport = {ruleId:number;ruleTitle:string|null;ruleSlug:string|null;userFacingRuleId:number|null;userFacingRuleLabel:string|null;reportedStartSeconds:number|null;reportedEndSeconds:number|null;createdAt:string};
export type ReportOptions = ReportTarget & {spaceId:number;reportedByMe:boolean;myReport:OwnReport|null;groups:ReportGroup[];initialGroupIds:number[];durationSeconds:number|null};
export type ReportBlock = {kind:'heading'|'paragraph'|'list'|'quote'|'code';text:string;links:{label:string;href:string}[]};
export type ReportDetail = {groupId:number;ruleId:number;version:number;title:string;description:ReportBlock[];allowed:ReportBlock[];disallowed:ReportBlock[]};
export type ReportInput = {userFacingRuleId:number;ruleId?:number;reportedStartSeconds:number|null;reportedEndSeconds:number|null};
const object=(v:unknown):Record<string,any>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw invalid();return v as Record<string,any>;};
const invalid=()=>new ApiError('The server returned unexpected reporting information. Please try again.');
const id=(v:unknown):number=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<1)throw invalid();return v;};
const text=(v:unknown,max=2000):string=>{if(typeof v!=='string'||v.length>max)throw invalid();return v;};
const nullable=(v:unknown,max=2000)=>v===null?null:text(v,max);
const seconds=(v:unknown):number|null=>{if(v===null)return null;if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>2147483647)throw invalid();return v;};
function identity(value:unknown,target:ReportTarget) {
 const v=object(value),context=object(v.context);
 if(context.kind!==target.context.kind||v.publicationId!==target.publicationId||target.context.kind==='space'&&(context.spaceId!==target.context.spaceId||v.spaceId!==target.context.spaceId))throw invalid();
 id(v.spaceId);return v;
}
function own(value:unknown):OwnReport {
 const v=object(value);const start=seconds(v.reportedStartSeconds),end=seconds(v.reportedEndSeconds);
 if(start!==null&&end!==null&&end<start)throw invalid();
 const createdAt=text(v.createdAt,40);if(!Number.isFinite(Date.parse(createdAt.replace(' ','T')+(/(?:Z|[+-]\d\d:\d\d)$/.test(createdAt)?'':'Z'))))throw invalid();
 return {ruleId:id(v.ruleId),ruleTitle:nullable(v.ruleTitle),ruleSlug:nullable(v.ruleSlug,200),userFacingRuleId:v.userFacingRuleId===null?null:id(v.userFacingRuleId),userFacingRuleLabel:nullable(v.userFacingRuleLabel),reportedStartSeconds:start,reportedEndSeconds:end,createdAt};
}
function status(value:unknown,target:ReportTarget) {
 const v=identity(value,target);if(typeof v.reportedByMe!=='boolean'||v.reportedByMe!==(v.myReport!==null))throw invalid();
 return {spaceId:v.spaceId,reportedByMe:v.reportedByMe,myReport:v.myReport===null?null:own(v.myReport)};
}
export function adaptReportOptions(value:unknown,target:ReportTarget):ReportOptions {
 const v=identity(value,target),state=status(v,target);
 if(!Array.isArray(v.groups)||v.groups.length>100||!Array.isArray(v.initialGroupIds)||v.initialGroupIds.length>100)throw invalid();
 const groups:ReportGroup[]=v.groups.map((value:unknown)=>{const g=object(value);if(!Array.isArray(g.rules)||g.rules.length>100)throw invalid();
  const rules:ReportRule[]=g.rules.map((value:unknown)=>{const r=object(value);if(typeof r.isDefault!=='boolean')throw invalid();return {id:id(r.id),slug:text(r.slug,200),title:text(r.title),shortDescription:nullable(r.shortDescription),isDefault:r.isDefault};});
  if(new Set(rules.map(r=>r.id)).size!==rules.length)throw invalid();
  return {id:id(g.id),label:text(g.label),shortDescription:nullable(g.shortDescription),rules};});
 const initialGroupIds=v.initialGroupIds.map(id);if(new Set(groups.map(g=>g.id)).size!==groups.length||new Set(initialGroupIds).size!==initialGroupIds.length||initialGroupIds.some((id:number)=>!groups.some(g=>g.id===id)))throw invalid();
 if(!(v.durationSeconds===null||typeof v.durationSeconds==='number'&&Number.isFinite(v.durationSeconds)&&v.durationSeconds>=0))throw invalid();
 return {...target,...state,groups,initialGroupIds,durationSeconds:v.durationSeconds};
}
export function adaptReportDetail(value:unknown,target:ReportTarget,groupId:number,ruleId:number):ReportDetail {
 const v=identity(value,target);if(v.groupId!==groupId||v.ruleId!==ruleId)throw invalid();
 const blocks=(value:unknown):ReportBlock[]=>{if(!Array.isArray(value)||value.length>1000)throw invalid();return value.map(raw=>{const b=object(raw);if(!['heading','paragraph','list','quote','code'].includes(b.kind)||!Array.isArray(b.links)||b.links.length>100)throw invalid();
  return {kind:b.kind,text:text(b.text,65536),links:b.links.map((raw:unknown)=>{const l=object(raw),href=text(l.href,4000);let u:URL;try{u=new URL(href,'https://report.invalid');}catch{throw invalid();}
   if(!(href.startsWith('https://')||href.startsWith('/')&&!href.startsWith('//'))||u.protocol!=='https:'||u.username||u.password)throw invalid();return {label:text(l.label),href};})};});};
 return {groupId,ruleId,version:id(v.version),title:text(v.title),description:blocks(v.description),allowed:blocks(v.allowed),disallowed:blocks(v.disallowed)};
}
export const reportPath=(target:ReportTarget)=>(target.context.kind==='global'?'/api/viewer/v1/feed/global':`/api/viewer/v1/spaces/${target.context.spaceId}`)+`/publications/${target.publicationId}`;
export const loadReportOptions=async(client:ApiClient,target:ReportTarget,signal:AbortSignal)=>adaptReportOptions(await client.getJson(reportPath(target)+'/reporting/options',signal),target);
export const loadReportDetail=async(client:ApiClient,target:ReportTarget,groupId:number,ruleId:number,signal:AbortSignal)=>adaptReportDetail(await client.getJson(reportPath(target)+`/reporting/groups/${groupId}/rules/${ruleId}`,signal),target,groupId,ruleId);
export const sendReport=async(client:ApiClient,target:ReportTarget,input:ReportInput,signal:AbortSignal)=>{
 const result=status(await client.postJson(reportPath(target)+'/report',input,signal),target);if(!result.reportedByMe||!result.myReport)throw invalid();return result.myReport;
};
export const reportDenied=(error:unknown)=>error instanceof ApiError&&(error.status===401||error.status===403||error.status===404&&error.code!=='report_rule_unavailable');
export function parseReportTime(value:string):number|null {
 if(!value.trim())return null;
 if(!/^\d{1,10}:\d{2}(?::\d{2})?$/.test(value.trim()))throw new Error('Use minutes:seconds or hours:minutes:seconds.');
 const parts=value.trim().split(':').map(Number);if(parts.slice(1).some(n=>n>59))throw new Error('Seconds and minutes after hours must be below 60.');
 const n=parts.reduce((a,b)=>a*60+b,0);if(!Number.isSafeInteger(n)||n>2147483647)throw new Error('This time is too large.');return n;
}
export const formatReportTime=(seconds:number)=>{const n=Math.max(0,Math.floor(seconds));return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;};
