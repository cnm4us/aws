export type FollowProof = {spaceId:number;publicationId:number;creatorId:number};
export async function contextualFollow(ctx:FollowProof, method:'GET'|'POST'|'DELETE'='GET', csrf?:string|null, signal?:AbortSignal) {
  const response=await fetch(`/api/spaces/${ctx.spaceId}/users/${ctx.creatorId}/follow?publicationId=${ctx.publicationId}`,{
    method,credentials:'same-origin',headers:csrf?{'x-csrf-token':csrf}:{},signal,
  });
  if(!response.ok)throw new Error('Cannot verify Follow status. Refresh and try again.');
  const value=await response.json();
  if(value?.space?.id!==ctx.spaceId || value.publicationId!==ctx.publicationId || value.creatorId!==ctx.creatorId
    || typeof value.following!=='boolean' || typeof value.canFollow!=='boolean'
    || !Number.isSafeInteger(value.followersCount) || value.followersCount<0)throw new Error('Cannot verify Follow status. Refresh and try again.');
  return value as {following:boolean;followersCount:number;canFollow:boolean};
}
