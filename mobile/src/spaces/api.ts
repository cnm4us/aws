import type { ApiClient } from '../api/client';
import { ApiError } from '../api/client';
export type SpaceSummary={id:number;ulid:string|null;name:string;slug:string;type:'personal'|'group'|'channel';relationship:'owner'|'admin'|'member'|'subscriber';subscribed:boolean};
export type MySpaces={personal:SpaceSummary|null;groups:SpaceSummary[];channels:SpaceSummary[]};
function space(value:unknown):SpaceSummary {
  const s=value as SpaceSummary | null;
  if(!s || !Number.isSafeInteger(s.id) || s.id<=0 || typeof s.name!=='string' || typeof s.slug!=='string'
    || !(s.ulid===null || typeof s.ulid==='string') || !['personal','group','channel'].includes(s.type)
    || !['owner','admin','member','subscriber'].includes(s.relationship) || typeof s.subscribed!=='boolean')throw new ApiError('The server returned an unexpected space list.');
  return {id:s.id,ulid:s.ulid,name:s.name.slice(0,128),slug:s.slug,type:s.type,relationship:s.relationship,subscribed:s.subscribed};
}
export function adaptMySpaces(value:unknown):MySpaces {
  const data=value as MySpaces|null;
  if(!data || !Array.isArray(data.groups) || !Array.isArray(data.channels) || data.personal===undefined)throw new ApiError('The server returned an unexpected space list.');
  return {personal:data.personal===null?null:space(data.personal),groups:data.groups.map(space),channels:data.channels.map(space)};
}
export async function fetchMySpaces(client:Pick<ApiClient,'getJson'>,signal?:AbortSignal) {return adaptMySpaces(await client.getJson('/api/viewer/v1/me/spaces',signal));}
