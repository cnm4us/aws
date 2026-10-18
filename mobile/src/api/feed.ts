import type { ApiClient } from './client';
import { adaptFeedPage } from '../feed/adaptFeed';

export async function fetchGlobalFeed(client: ApiClient, signal?: AbortSignal, cursor?: string | null) {
  const query = new URLSearchParams({ limit: '20' });
  if (cursor) query.set('cursor', cursor);
  return adaptFeedPage(await client.getJson(`/api/feed/global?${query}`, signal));
}
