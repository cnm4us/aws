import type { FeedVideoItem } from '../feed/types';
import type { FeedContext } from '../feed/context';
import { ApiError } from '../api/client';
export type RequestEvidence={startedAt:number;wallStartedAt:number;epoch:number};
const evidence=new WeakMap<object,RequestEvidence>();
export function stampResponse(value:unknown,ticket:RequestEvidence) {if(value&&typeof value==='object')evidence.set(value,ticket);}
export const responseEvidence=(value:unknown)=>value&&typeof value==='object'?evidence.get(value):undefined;
export type AccessProof=RequestEvidence & {viewerId?:number;identityUntil?:number;spaceId?:number;spaceUntil?:number;
 publications:Array<{item:FeedVideoItem;until:number}>;publicUntil?:number;publicIds:number[]};
const object=(v:unknown):Record<string,any>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:null;
const duration=(v:unknown)=>typeof v==='number'&&Number.isInteger(v)&&v>=0&&v<=60000;
export function adaptAccess(value:unknown,items:FeedVideoItem[]=[],context?:FeedContext,ticket=responseEvidence(value)):AccessProof|undefined {
 const a=object(object(value)?.access);if(!a||!ticket)return undefined;
 const invalid=()=>new ApiError('The server returned invalid access confirmation.');
 if(a.version!==1||!Array.isArray(a.publicationViews)||a.publicationViews.length>100)throw invalid();
 const p:AccessProof={...ticket,publications:[],publicIds:[]};
 if(a.identity!==undefined){if(!object(a.identity)||!Number.isSafeInteger(a.identity.viewerId)||a.identity.viewerId<=0||!duration(a.identity.remainingMs))throw invalid();
  p.viewerId=a.identity.viewerId;p.identityUntil=ticket.startedAt+a.identity.remainingMs;}
 if(a.spaceView!==undefined){if(context?.kind!=='space'||!object(a.spaceView)||a.spaceView.spaceId!==context.spaceId||!duration(a.spaceView.remainingMs)||p.identityUntil===undefined)throw invalid();
  p.spaceId=context.spaceId;p.spaceUntil=Math.min(p.identityUntil,ticket.startedAt+a.spaceView.remainingMs);}
 for(const row of a.publicationViews){const item=items.find(i=>i.publicationId===row?.publicationId);
  if(!item||!object(row)||row.spaceId!==p.spaceId||row.uploadId!==item.uploadId||row.productionUlid!==item.productionUlid||row.creatorId!==item.creator.id
   ||!duration(row.remainingMs)||p.spaceUntil===undefined||p.publications.some(p=>p.item.publicationId===item.publicationId))throw invalid();
  p.publications.push({item,until:Math.min(p.spaceUntil,ticket.startedAt+row.remainingMs)});
 }
 if(a.publicView!==undefined){if(context?.kind!=='global'||!object(a.publicView)||!duration(a.publicView.remainingMs)||!Array.isArray(a.publicView.publicationIds)
  ||a.publicView.publicationIds.length>100||new Set(a.publicView.publicationIds).size!==a.publicView.publicationIds.length
  ||a.publicView.publicationIds.some((id:unknown)=>!items.some(i=>i.publicationId===id)))throw invalid();
  p.publicUntil=ticket.startedAt+a.publicView.remainingMs;p.publicIds=a.publicView.publicationIds;
 }
 return p;
}
export const itemKey=(i:FeedVideoItem)=>JSON.stringify([i.spaceId,i.publicationId,i.uploadId,i.productionUlid,i.creator.id,i.playbackUrl]);

export function adaptIdentity(value:unknown) {
 const a=object(object(value)?.access);if(!a)return undefined;
 return adaptAccess({access:{version:a.version,identity:a.identity,publicationViews:[]}},[],undefined,responseEvidence(value));
}

export const accessScope=(path:string):import('../diagnostics/playbackDiagnostics').AccessDiagnostic['scope']=>
 path.includes('/session')?'identity':path.includes('/playback-access')?'publication':path.includes('/creator-follow')||path.includes('/creator-recognition')?'follow':
 path.includes('/comments')?'comments':path.includes('/story')||path.includes('/captions.vtt')?'text':path.includes('/publications/')&&path.includes('/spaces')?'entry':
 path.includes('/feed/global')?'public':path.includes('/spaces/')?'space':'profile';
