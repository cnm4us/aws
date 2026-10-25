import { ApiError, type ApiClient } from '../api/client';
export type FollowProof={spaceId:number;publicationId:number;creatorId:number;generation:number;visitId:number};
export type FollowSummary={space:{id:number;name:string;type:'group'|'channel'};publicationId:number;creatorId:number;
 following:boolean;followingElsewhere:boolean;followersCount:number;canFollow:boolean;disabledReason:null|'self'};
export function adaptFollow(raw:any,ctx:FollowProof):FollowSummary {
 if(!raw || raw.space?.id!==ctx.spaceId || !['group','channel'].includes(raw.space.type) || typeof raw.space.name!=='string' || raw.space.name.length>200
   || raw.publicationId!==ctx.publicationId || raw.creatorId!==ctx.creatorId || typeof raw.following!=='boolean' || typeof raw.followingElsewhere!=='boolean'
   || !Number.isSafeInteger(raw.followersCount) || raw.followersCount<0 || typeof raw.canFollow!=='boolean'
   || (raw.canFollow?raw.disabledReason!==null:raw.disabledReason!=='self'||raw.following||raw.followingElsewhere)) throw new ApiError('Unexpected Follow response.');
 return {space:{id:ctx.spaceId,name:raw.space.name,type:raw.space.type},publicationId:ctx.publicationId,creatorId:ctx.creatorId,
  following:raw.following,followingElsewhere:raw.followingElsewhere,followersCount:raw.followersCount,canFollow:raw.canFollow,disabledReason:raw.disabledReason};
}
const path=(ctx:FollowProof)=>`/api/viewer/v1/spaces/${ctx.spaceId}/publications/${ctx.publicationId}/creator-follow`;
export const loadFollow=async(client:ApiClient,ctx:FollowProof,signal:AbortSignal)=>adaptFollow(await client.getJson(path(ctx),signal),ctx);
export const setFollow=async(client:ApiClient,ctx:FollowProof,following:boolean,signal:AbortSignal)=>adaptFollow(
 await (following?client.postJson(path(ctx),undefined,signal):client.deleteJson(path(ctx),signal)),ctx);
export const followDenied=(e:unknown)=>e instanceof ApiError && [401,403,404].includes(e.status??0);

export function adaptRecognition(raw:any,publicationId:number,creatorId:number) {
 if(!raw || raw.publicationId!==publicationId || raw.creatorId!==creatorId || typeof raw.followingInSpaces!=='boolean')
  throw new ApiError('Cannot verify creator recognition.');
 return {followingInSpaces:raw.followingInSpaces as boolean};
}
export const loadRecognition=async(client:ApiClient,publicationId:number,creatorId:number,signal:AbortSignal)=>
 adaptRecognition(await client.getJson(`/api/viewer/v1/feed/global/publications/${publicationId}/creator-recognition`,signal),publicationId,creatorId);
