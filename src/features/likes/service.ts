import { engagement } from '../engagement/service';
import type { PageOptions } from '../engagement/contract';
export async function getPublicationLikesSummary(publicationId:number,userId:number,spaceId:number) {
  const r=await engagement.summary({publicationId,userId,spaceId});return {count:r.likes.count,liked:r.likes.likedByMe};
}
export async function likePublication(publicationId:number,userId:number,spaceId:number) {
  const r=await engagement.like({publicationId,userId,spaceId},true);return {count:r.likes.count,liked:r.likes.likedByMe};
}
export async function unlikePublication(publicationId:number,userId:number,spaceId:number) {
  const r=await engagement.like({publicationId,userId,spaceId},false);return {count:r.likes.count,liked:r.likes.likedByMe};
}
export const listPublicationLikers=(publicationId:number,userId:number,spaceId:number,opts:PageOptions)=>engagement.likers({publicationId,userId,spaceId},opts);
