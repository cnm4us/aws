import { ApiError, type ApiClient } from '../api/client';
export type EngagementContext={spaceId:number;publicationId:number};
export type Likes={count:number;likedByMe:boolean};
export type CommentSummary={count:number;hasCommentedByMe:boolean;canComment:boolean;disabledReason:'comments_disabled'|'comment_forbidden'|null};
export type Engagement=EngagementContext & {likes:Likes;comments:CommentSummary};
export type Comment={id:number;body:string;createdAt:string;author:{id:number;displayName:string};isMine:boolean};
export type CommentPage=EngagementContext & {items:Comment[];nextCursor:string|null;comments:CommentSummary};
export type CreatedComment=EngagementContext & {item:Comment;comments:CommentSummary};
const object=(v:unknown):Record<string,any>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:null;
const count=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const id=(v:unknown):v is number=>count(v)&&v>0;
const invalid=()=>new ApiError('The server returned unexpected comments or likes. Please try again.');
const context=(value:unknown,expected:EngagementContext)=>{const v=object(value);if(!v||v.spaceId!==expected.spaceId||v.publicationId!==expected.publicationId)throw invalid();return v;};
function likes(value:unknown):Likes {const v=object(value);if(!v||!count(v.count)||typeof v.likedByMe!=='boolean')throw invalid();return {count:v.count,likedByMe:v.likedByMe};}
function summary(value:unknown):CommentSummary {
 const v=object(value);if(!v||!count(v.count)||typeof v.hasCommentedByMe!=='boolean'||typeof v.canComment!=='boolean'
   || !(v.disabledReason===null||['comments_disabled','comment_forbidden'].includes(v.disabledReason)) || v.canComment!==(v.disabledReason===null))throw invalid();
 return {count:v.count,hasCommentedByMe:v.hasCommentedByMe,canComment:v.canComment,disabledReason:v.disabledReason};
}
function comment(value:unknown):Comment {
 const v=object(value),a=object(v?.author);
 if(!v||!id(v.id)||typeof v.body!=='string'||!v.body.trim()||v.body.length>2000||typeof v.createdAt!=='string'||v.createdAt.length>40||!Number.isFinite(Date.parse(v.createdAt.replace(' ','T')+(/(?:Z|[+-]\d\d:\d\d)$/.test(v.createdAt)?'':'Z')))
   ||!a||!id(a.id)||typeof a.displayName!=='string'||!a.displayName.trim()||a.displayName.length>1000||typeof v.isMine!=='boolean')throw invalid();
 return {id:v.id,body:v.body,createdAt:v.createdAt,author:{id:a.id,displayName:a.displayName},isMine:v.isMine};
}
export function adaptEngagement(value:unknown,expected:EngagementContext):Engagement {const v=context(value,expected);return {...expected,likes:likes(v.likes),comments:summary(v.comments)};}
export function adaptLikes(value:unknown,expected:EngagementContext):Likes {return likes(context(value,expected).likes);}
export function adaptComments(value:unknown,expected:EngagementContext):CommentPage {
 const v=context(value,expected);if(!Array.isArray(v.items)||v.items.length>50||!(v.nextCursor===null||typeof v.nextCursor==='string'&&v.nextCursor.length<=512&&/^[\w-]+$/.test(v.nextCursor)))throw invalid();
 const items=v.items.map(comment);if(new Set(items.map(c=>c.id)).size!==items.length||!items.length&&v.nextCursor!==null)throw invalid();
 return {...expected,items,nextCursor:v.nextCursor,comments:summary(v.comments)};
}
export function adaptCreated(value:unknown,expected:EngagementContext):CreatedComment {const v=context(value,expected);return {...expected,item:comment(v.item),comments:summary(v.comments)};}
export const engagementPath=(ctx:EngagementContext)=>`/api/viewer/v1/spaces/${ctx.spaceId}/publications/${ctx.publicationId}`;
export const loadEngagement=async(client:ApiClient,ctx:EngagementContext,signal:AbortSignal)=>adaptEngagement(await client.getJson(engagementPath(ctx)+'/engagement',signal),ctx);
export const setLike=async(client:ApiClient,ctx:EngagementContext,liked:boolean,signal:AbortSignal)=>adaptLikes(await(liked?client.postJson(engagementPath(ctx)+'/like',undefined,signal):client.deleteJson(engagementPath(ctx)+'/like',signal)),ctx);
export const loadComments=async(client:ApiClient,ctx:EngagementContext,order:'newest'|'oldest',cursor:string|null,signal:AbortSignal)=>{
 const params=new URLSearchParams({limit:'20',order});if(cursor)params.set('cursor',cursor);
 return adaptComments(await client.getJson(engagementPath(ctx)+'/comments?'+params,signal),ctx);
};
export const createComment=async(client:ApiClient,ctx:EngagementContext,body:string,signal:AbortSignal)=>adaptCreated(await client.postJson(engagementPath(ctx)+'/comments',{body},signal),ctx);
export const accessDenied=(error:unknown)=>error instanceof ApiError&&([401,404].includes(error.status??0)||error.status===403&&!['comments_disabled','comment_forbidden'].includes(error.code??''));
