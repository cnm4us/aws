import { ApiError, type ApiClient } from '../api/client';
export type LaunchDestination={space:{id:number;name:string;type:'group'|'channel'};publicationId:number};
export type LaunchPage={sourcePublicationId:number;productionUlid:string|null;items:LaunchDestination[];nextCursor:string|null};
export type LaunchResolved=Omit<LaunchPage,'items'|'nextCursor'> & LaunchDestination;
const object=(v:unknown):Record<string,unknown>|null=>v!==null && typeof v==='object' && !Array.isArray(v)?v as Record<string,unknown>:null;
const id=(v:unknown):v is number=>typeof v==='number' && Number.isSafeInteger(v) && v>0;
const invalid=()=>new ApiError('The server returned unexpected space destinations. Please try again.');
function destination(v:unknown):LaunchDestination {
  const d=object(v),s=object(d?.space);
  if(!s || !id(s.id)||typeof s.name!=='string'||!s.name.trim()||s.name.length>200||!['group','channel'].includes(String(s.type))||!id(d?.publicationId))throw invalid();
  return {space:{id:s.id,name:s.name,type:s.type as 'group'|'channel'},publicationId:d!.publicationId as number};
}
function source(v:Record<string,unknown>,expectedId:number,expectedUlid:string|null) {
  if(v.sourcePublicationId!==expectedId || !(v.productionUlid===null || typeof v.productionUlid==='string' && /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i.test(v.productionUlid)))throw invalid();
  if(expectedUlid!==null && v.productionUlid!==expectedUlid)throw new ApiError('This video has changed. Return to Global and try again.',404,'publication_not_found');
  return {sourcePublicationId:expectedId,productionUlid:v.productionUlid as string|null};
}
export function adaptLaunchPage(value:unknown,expectedId:number,ulid:string|null):LaunchPage {
  const v=object(value);
  if(!v || !Array.isArray(v.items) || v.items.length>50 || !(v.nextCursor===null || typeof v.nextCursor==='string' && v.nextCursor.length<=512 && /^[\w-]+$/.test(v.nextCursor)))throw invalid();
  const identity=source(v,expectedId,ulid),items=v.items.map(destination);
  if(new Set(items.map(i=>i.space.id)).size!==items.length || !items.length && v.nextCursor!==null)throw invalid();
  return {...identity,items,nextCursor:v.nextCursor as string|null};
}
export function adaptLaunchResolved(value:unknown,expectedId:number,ulid:string|null,spaceId:number):LaunchResolved {
  const v=object(value);if(!v)throw invalid();const d=destination(v);
  if(d.space.id!==spaceId)throw invalid();return {...source(v,expectedId,ulid),...d};
}
export const launchPath=(sourceId:number)=>`/api/viewer/v1/feed/global/publications/${sourceId}/spaces`;
export async function fetchLaunchPage(client:Pick<ApiClient,'getJson'>,sourceId:number,ulid:string|null,signal:AbortSignal,cursor:string|null=null) {
  const query=new URLSearchParams({limit:'20'});if(cursor)query.set('cursor',cursor);
  return adaptLaunchPage(await client.getJson(`${launchPath(sourceId)}?${query}`,signal),sourceId,ulid);
}
export async function resolveLaunch(client:Pick<ApiClient,'getJson'>,sourceId:number,ulid:string|null,spaceId:number,signal?:AbortSignal) {
  return adaptLaunchResolved(await client.getJson(`${launchPath(sourceId)}/${spaceId}`,signal),sourceId,ulid,spaceId);
}
