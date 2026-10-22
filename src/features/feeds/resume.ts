import { buildTsIdCursor } from '../../core/pagination';
import type { FeedResponse } from './types';
import type { FeedSelection } from './repo';

type Selection = Pick<FeedSelection, 'publicationId' | 'newerThan' | 'ascending'> & { limit: number; cursor?: string };
// Inject the regular authorized feed loader: every anchor/window query uses its
// exact publication eligibility filters, not a separate permissive pinned lookup.
export async function aroundPublication(load: (selection: Selection) => Promise<FeedResponse>, anchor: number, limit: number) {
  const found = await load({ publicationId: anchor, limit: 1 });
  const item = found.items[0];
  if (!item) return { ...await load({ limit }), resume: { requestedPublicationId: anchor, restoredPublicationId: null, outcome: 'unavailable' as const } };
  const publication = item.publication;
  const before = Math.min(20, Math.floor((limit - 1) / 3));
  const newer = before ? await load({ newerThan: { ts: publication.published_at!, id: publication.id }, ascending: true, limit: before }) : { items: [], nextCursor: null };
  const remaining = limit - newer.items.length - 1;
  const cursor = buildTsIdCursor(publication.published_at!, publication.id);
  const older = remaining ? await load({ cursor, limit: remaining }) : { items: [], nextCursor: cursor };
  return { items: [...newer.items.reverse(), item, ...older.items], nextCursor: older.nextCursor,
    resume: { requestedPublicationId: anchor, restoredPublicationId: anchor, outcome: 'restored' as const } };
}
