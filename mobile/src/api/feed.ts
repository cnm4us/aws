import type { ApiClient } from './client';
import { adaptFeedPage, adaptViewerFeedPage } from '../feed/adaptFeed';
import type { FeedContext } from '../feed/context';

export async function fetchGlobalFeed(client: Pick<ApiClient,'getJson'>, signal?: AbortSignal, cursor?: string | null) {
  const query = new URLSearchParams({ limit: '20' });
  if (cursor) query.set('cursor', cursor);
  return adaptFeedPage(await client.getJson(`/api/feed/global?${query}`, signal));
}

export async function fetchViewerFeed(client: Pick<ApiClient,'getJson'>,context:FeedContext,signal?:AbortSignal,cursor?:string|null,anchor?:number) {
  const query=new URLSearchParams({limit:'20'});if(cursor)query.set('cursor',cursor);
  if(anchor)query.set('anchorPublicationId',String(anchor));
  const path=context.kind==='global'?'/api/viewer/v1/feed/global':`/api/viewer/v1/spaces/${context.spaceId}/feed`;
  return adaptViewerFeedPage(await client.getJson(`${path}?${query}`,signal),context,anchor);
}
