import {isAggregate,type SourceContext} from './context';
import {itemKey,responseEvidence} from '../auth/accessProof';
import { adaptAccess } from '../auth/accessProof';
import { ApiError } from '../api/client';
import type { FeedPage, FeedVideoItem } from './types';
import type { FeedContext } from './context';
import { publicationTime } from '../content/publicationTime';

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function id(value: unknown): number | null {
  const number = positiveNumber(value);
  return number !== null && Number.isSafeInteger(number) ? number : null;
}

function text(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) || null : null;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? value : null;
  } catch { return null; }
}

export function adaptFeedPage(value: unknown): FeedPage {
  const page = record(value);
  if (!page || !Array.isArray(page.items) ||
    !(page.nextCursor === null || typeof page.nextCursor === 'string')) {
    throw new ApiError('The server returned an unexpected feed. Please try again.');
  }

  const items: FeedVideoItem[] = [];
  const seen = new Set<number>();
  for (const entry of page.items) {
    const row = record(entry);
    const publication = record(row?.publication);
    const publicationId = id(publication?.id);
    if (!publicationId || seen.has(publicationId)) continue;
    seen.add(publicationId);
    const upload = record(row?.upload);
    const owner = record(row?.owner);
    const orientationPoster = upload?.orientation === 'portrait'
      ? upload.poster_portrait_cdn
      : upload?.orientation === 'landscape' ? upload.poster_landscape_cdn : null;
    items.push({
      publicationId,
      publishedAt: publicationTime(publication?.published_at, true),
      uploadId: id(upload?.id),
      productionUlid: text(publication?.production_ulid, 26),
      spaceId: id(publication?.space_id),
      playbackUrl: httpsUrl(upload?.cdn_master),
      posterUrl: httpsUrl(upload?.poster_cdn) ?? httpsUrl(orientationPoster),
      creator: {
        id: id(owner?.id),
        displayName: text(owner?.displayName, 120) ?? 'Creator',
        avatarUrl: httpsUrl(owner?.avatarUrl),
      },
      description: text(upload?.description, 2000),
      width: positiveNumber(upload?.width),
      height: positiveNumber(upload?.height),
      durationSeconds: positiveNumber(upload?.duration_seconds),
    });
  }
  return { items, nextCursor: page.nextCursor || null };
}

export function adaptViewerFeedPage(value: unknown, expected: FeedContext, anchor?:number): FeedPage {
  const page=record(value),context=record(page?.context),space=record(context?.space);
  if (!page || !Array.isArray(page.items) || !(page.nextCursor===null || typeof page.nextCursor==='string') ||
    context?.kind!==expected.kind || (expected.kind==='space' && space?.id!==expected.spaceId)) {
    throw new ApiError('The server returned an unexpected feed. Please try again.');
  }
  const items: FeedVideoItem[]=[];const seen=new Set<number>();
  for(const value of page.items) {
    const row=record(value),publicationId=id(row?.publicationId);if(!row || !publicationId || seen.has(publicationId))continue;
    if(expected.kind==='space' && row.spaceId!==expected.spaceId)throw new ApiError('The feed context changed. Please try again.');
    if(row.reportedByMe!==undefined && typeof row.reportedByMe!=='boolean')throw new ApiError('The server returned unexpected report status. Please try again.');
    seen.add(publicationId);const creator=record(row.creator);
    items.push({publicationId,publishedAt:publicationTime(row.publishedAt),uploadId:id(row.uploadId),spaceId:id(row.spaceId),productionUlid:text(row.productionUlid,26),
      playbackUrl:httpsUrl(row.playbackUrl),posterUrl:httpsUrl(row.posterUrl),
      creator:{id:id(creator?.id),displayName:text(creator?.displayName,120)??'Creator',avatarUrl:httpsUrl(creator?.avatarUrl)},
      reportedByMe:row.reportedByMe===true,hasStory:row.hasStory===true,storyPreview:text(row.storyPreview,200),hasCaptions:row.hasCaptions===true,
      ...(isAggregate(expected)?{sourceContext:adaptSource(row.sourceContext,row.spaceId)}:{}),description:text(row.description,2000),width:positiveNumber(row.width),height:positiveNumber(row.height),durationSeconds:positiveNumber(row.durationSeconds)});
  }
  const aggregate=isAggregate(expected)?adaptAggregate(value,page,items,expected.kind):{};
  if(anchor!==undefined) {
    const resume=record(page.resume);
    if(!resume || resume.requestedPublicationId!==anchor || !['restored','unavailable'].includes(String(resume.outcome))
      || (resume.outcome==='restored' ? resume.restoredPublicationId!==anchor || !items.some(i=>i.publicationId===anchor) : resume.restoredPublicationId!==null))
      throw new ApiError('The server returned an unexpected return position. Please try again.');
    return {...aggregate,...(adaptAccess(value,items,expected)?{access:adaptAccess(value,items,expected)}:{}),items,nextCursor:page.nextCursor || null,resume:{requestedPublicationId:anchor,restoredPublicationId:resume.restoredPublicationId as number|null,outcome:resume.outcome as 'restored'|'unavailable'}};
  }
  return {...aggregate,...(adaptAccess(value,items,expected)?{access:adaptAccess(value,items,expected)}:{}),items,nextCursor:page.nextCursor || null};
}

function adaptSource(raw:unknown,spaceId:unknown):SourceContext {
 const c=record(raw) as any;if(c?.kind==='global')return {kind:'global'};
 if(c?.kind!=='space'||!id(c.spaceId)||c.spaceId!==spaceId||!['personal','group','channel'].includes(c.type)||typeof c.name!=='string'||c.name.length>255)throw new ApiError('The video source is invalid.');
 return {kind:'space',spaceId:c.spaceId,name:c.name,type:c.type};
}
function adaptAggregate(value:unknown,page:Record<string,any>,items:FeedVideoItem[],kind:'following'|'creations') {
 const a=record(page.aggregateAccess) as any,ticket=responseEvidence(value);
 if(!ticket||a?.version!==1||a.kind!==kind||!Number.isSafeInteger(a.viewerId)||a.viewerId<=0||!Number.isInteger(a.remainingMs)||a.remainingMs<0||a.remainingMs>60000||!Array.isArray(a.publicationIds)||a.publicationIds.length!==items.length||new Set(a.publicationIds).size!==items.length||items.some(i=>!a.publicationIds.includes(i.publicationId))||!Array.isArray(page.sourcePages)||page.sourcePages.length>100)throw new ApiError('The aggregate access confirmation is invalid.');
 const identity=adaptAccess(value,items,{kind});if(!identity||identity.viewerId!==a.viewerId||identity.identityUntil===undefined)throw new ApiError('The aggregate identity changed.');
 const sourceProofs:import('../auth/accessProof').AccessProof[]=[],covered=new Set<number>();
 for(const source of page.sourcePages){const raw=record(source),c=record(raw?.context) as any;const context:SourceContext=c?.kind==='global'?{kind:'global'}:adaptSource({kind:'space',spaceId:c?.space?.id,name:c?.space?.name,type:c?.space?.type},c?.space?.id);
  if(!raw||!Array.isArray(raw.items))throw new ApiError('The source feed is invalid.');
  const selected=raw.items.map((r:any)=>{const item=items.find(i=>i.publicationId===r?.publicationId);if(!item||!r.creator||itemKey(r as FeedVideoItem)!==itemKey(item))throw new ApiError('The source media identity does not match.');return item;});
  for(const item of selected){if(covered.has(item.publicationId)||JSON.stringify(item.sourceContext)!==JSON.stringify(context))throw new ApiError('The source confirmation does not match.');covered.add(item.publicationId);}
  const proof=adaptAccess(raw,selected,context,ticket);if(!proof||proof.viewerId!==a.viewerId)throw new ApiError('The source authority changed.');sourceProofs.push(proof);
 }
 if(covered.size!==items.length)throw new ApiError('A source confirmation is missing.');
 return {sourceProofs,aggregateAccess:{kind,until:Math.min(identity.identityUntil,ticket.startedAt+a.remainingMs),publications:items},reviewRequired:Array.isArray(page.reviewRequired)?page.reviewRequired.filter((r:any)=>id(r.id)&&typeof r.name==='string'&&r.name.length<=255&&['personal','group','channel'].includes(r.type)).slice(0,100):[]};
}
