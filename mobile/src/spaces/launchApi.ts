import { adaptViewerFeedPage } from '../feed/adaptFeed';
import { stampResponse,responseEvidence } from '../auth/accessProof';
import type { FeedPage } from '../feed/types';
import { ApiError, type ApiClient } from '../api/client';
export type LaunchCreator={id:number;displayName:string;avatarUrl:string|null;bio:string|null};
export type LaunchDestination={space:{id:number;name:string;type:'group'|'channel';description:string|null};publicationId:number};
export type LaunchPage={sourcePublicationId:number;productionUlid:string|null;creator:LaunchCreator;items:LaunchDestination[];nextCursor:string|null};
export type LaunchResolved=Omit<LaunchPage,'items'|'nextCursor'> & LaunchDestination & {entry?:FeedPage};
const object=(v:unknown):Record<string,unknown>|null=>v!==null && typeof v==='object' && !Array.isArray(v)?v as Record<string,unknown>:null;
const id=(v:unknown):v is number=>typeof v==='number' && Number.isSafeInteger(v) && v>0;
const invalid=()=>new ApiError('The server returned unexpected space destinations. Please try again.');
function destination(v:unknown):LaunchDestination {
  const d=object(v),s=object(d?.space);
  if(!s || !id(s.id)||typeof s.name!=='string'||!s.name.trim()||s.name.length>200||!['group','channel'].includes(String(s.type))||!id(d?.publicationId)||!(s.description===null||typeof s.description==='string'&&s.description.length<=500))throw invalid();
  return {space:{id:s.id,name:s.name,type:s.type as 'group'|'channel',description:s.description as string|null},publicationId:d!.publicationId as number};
}
export function adaptLaunchCreator(value:unknown,expectedCreatorId?:number|null):LaunchCreator {
  const c=object(value);
  if(!c || !id(c.id) || typeof c.displayName!=='string' || !c.displayName.trim() || c.displayName.length>120
    || !(c.bio===null || typeof c.bio==='string'&&c.bio.length<=2000)
    || !(c.avatarUrl===null || typeof c.avatarUrl==='string'&&c.avatarUrl.length<=2048))throw invalid();
  if(expectedCreatorId!==undefined && c.id!==expectedCreatorId)throw new ApiError('This video has changed. Return to Global and try again.',404,'publication_not_found');
  let avatarUrl=c.avatarUrl as string|null;
  if(avatarUrl)try{const u=new URL(avatarUrl);if(u.protocol!=='https:'||u.username||u.password)avatarUrl=null;}catch{avatarUrl=null;}
  return {id:c.id,displayName:c.displayName,avatarUrl,bio:c.bio as string|null};
}
function source(v:Record<string,unknown>,expectedId:number,expectedUlid:string|null,expectedCreatorId?:number|null) {
  if(v.sourcePublicationId!==expectedId || !(v.productionUlid===null || typeof v.productionUlid==='string' && /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i.test(v.productionUlid)))throw invalid();
  if(expectedUlid!==null && v.productionUlid!==expectedUlid)throw new ApiError('This video has changed. Return to Global and try again.',404,'publication_not_found');
  return {sourcePublicationId:expectedId,productionUlid:v.productionUlid as string|null,creator:adaptLaunchCreator(v.creator,expectedCreatorId)};
}
export function adaptLaunchPage(value:unknown,expectedId:number,ulid:string|null,creatorId?:number|null):LaunchPage {
  const v=object(value);
  if(!v || !Array.isArray(v.items) || v.items.length>50 || !(v.nextCursor===null || typeof v.nextCursor==='string' && v.nextCursor.length<=512 && /^[\w-]+$/.test(v.nextCursor)))throw invalid();
  const identity=source(v,expectedId,ulid,creatorId),items=v.items.map(destination);
  if(new Set(items.map(i=>i.space.id)).size!==items.length || !items.length && v.nextCursor!==null)throw invalid();
  return {...identity,items,nextCursor:v.nextCursor as string|null};
}
export function adaptLaunchResolved(value:unknown,expectedId:number,ulid:string|null,spaceId:number,creatorId?:number|null):LaunchResolved {
  const v=object(value);if(!v)throw invalid();const d=destination(v);
  if(d.space.id!==spaceId)throw invalid();
  let entry:FeedPage|undefined;
  if(v.entry!==undefined){const ticket=responseEvidence(value);if(ticket)stampResponse(v.entry,ticket);
    entry=adaptViewerFeedPage(v.entry,{kind:'space',spaceId,name:d.space.name,type:d.space.type},d.publicationId);
    const item=entry.items.find(i=>i.publicationId===d.publicationId);
    if(!item||item.productionUlid!==v.productionUlid||item.creator.id!==object(v.creator)?.id)throw invalid();
  }
  return {...source(v,expectedId,ulid,creatorId),...d,...(entry?{entry}:{})};
}
export const launchPath=(sourceId:number)=>`/api/viewer/v1/feed/global/publications/${sourceId}/spaces`;
export async function fetchLaunchPage(client:Pick<ApiClient,'getJson'>,sourceId:number,ulid:string|null,signal:AbortSignal,cursor:string|null=null,creatorId?:number|null) {
  const query=new URLSearchParams({limit:'20'});if(cursor)query.set('cursor',cursor);
  return adaptLaunchPage(await client.getJson(`${launchPath(sourceId)}?${query}`,signal),sourceId,ulid,creatorId);
}
export async function resolveLaunch(client:Pick<ApiClient,'getJson'>,sourceId:number,ulid:string|null,spaceId:number,signal?:AbortSignal,creatorId?:number|null,includeEntry=false) {
  return adaptLaunchResolved(await client.getJson(`${launchPath(sourceId)}/${spaceId}${includeEntry?'?include=entry':''}`,signal),sourceId,ulid,spaceId,creatorId);
}
