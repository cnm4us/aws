import type { GlobalFeedItem, FeedResponse } from './types';
import { ViewerApiError } from '../native-sessions/service';
import { loadCreators } from '../profiles/viewer';
import { publicationTime } from '../../core/publicationTime';

const id = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value)>0 ? Number(value) : null;
const number = (value: unknown) => value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value)>=0 ? Number(value) : null;
function url(value: unknown): string | null {
  if (typeof value!=='string') return null;
  try {const u=new URL(value);return u.protocol==='https:' && !u.username && !u.password ? u.toString() : null;}catch{return null;}
}
export function serializeViewerVideo(item: GlobalFeedItem) {
  const p=item.publication,u=item.upload || {},owner=item.owner;
  return { publicationId:id(p.id),publishedAt:publicationTime(p.published_at),uploadId:id(p.upload_id),productionUlid:p.production_ulid || null,spaceId:id(p.space_id),
    playbackUrl:url(u.cdn_master),posterUrl:url(u.poster_cdn),
    creator:{id:id(owner?.id),displayName:owner?.displayName?.trim() || null,avatarUrl:null},
    description:typeof u.description==='string' ? u.description : null,
    hasStory:p.has_story===true,storyPreview:typeof p.story_preview==='string'?p.story_preview.slice(0,200):null,hasCaptions:p.has_captions===true,
    width:number(u.width),height:number(u.height),durationSeconds:number(u.duration_seconds) };
}
export function serializeViewerFeed(feed: FeedResponse, context: unknown) {
  return { context,items:feed.items.map(serializeViewerVideo),nextCursor:feed.nextCursor };
}
export async function serializeViewerFeedWithCreators(feed: FeedResponse, context: unknown) {
  const creators = await loadCreators(feed.items.map(item => item.owner?.id ?? 0));
  const result = serializeViewerFeed(feed, context);
  return { ...result, items: result.items.map(item => {
    const creator = item.creator.id ? creators.get(item.creator.id) : null;
    return { ...item, creator: creator ? { id: creator.id, displayName: creator.displayName, avatarUrl: creator.avatarUrl }
      : { id: null, displayName: null, avatarUrl: null } };
  }) };
}
export function parseViewerQuery(query: Record<string,unknown>) {
  const limit=query.limit===undefined?20:Number(query.limit);
  if ((query.limit!==undefined && (typeof query.limit!=='string' || !/^\d+$/.test(query.limit))) || !Number.isInteger(limit) || limit<1 || limit>100)
    throw new ViewerApiError(400,'invalid_query');
  const cursor=query.cursor;
  if (cursor!==undefined && (typeof cursor!=='string' || cursor.length>160 || !/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z)?\|[1-9]\d*$/.test(cursor)
    || !Number.isFinite(Date.parse(cursor.split('|')[0])) || !Number.isSafeInteger(Number(cursor.split('|')[1])))) throw new ViewerApiError(400,'invalid_query');
  const anchor = query.anchorPublicationId;
  if (anchor !== undefined && (typeof anchor !== 'string' || !/^[1-9]\d*$/.test(anchor)
    || !Number.isSafeInteger(Number(anchor)) || cursor !== undefined)) throw new ViewerApiError(400,'invalid_query');
  return {limit,cursor:cursor as string | undefined, ...(anchor === undefined ? {} : { anchorPublicationId: Number(anchor) })};
}
