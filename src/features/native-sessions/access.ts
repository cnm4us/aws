import type { Principal } from './service';
import { ViewerApiError } from './service';
import type { serializeViewerVideo } from '../feeds/viewer';

type BaseItem = ReturnType<typeof serializeViewerVideo>;
type Item = Omit<BaseItem,'creator'> & {creator:{id:number|null;displayName:string|null;avatarUrl:string|null}};
export type AccessMetadata = {
  version: 1;
  identity?: { viewerId: number; remainingMs: number };
  spaceView?: { spaceId: number; remainingMs: number };
  publicationViews: Array<{ publicationId: number; spaceId: number; uploadId: number | null;
    productionUlid: string | null; creatorId: number | null; remainingMs: number }>;
  publicView?: { remainingMs: number; publicationIds: number[] };
};

// Start before the earliest contributing authority read. JSON delivery can only
// shorten this budget; clients also anchor to their own original request start.
export function accessMetadata(startedAt: number, principal: Principal | null, items: Item[] = [],
  scope?: { spaceId: number; validUntil: number; publicationValidUntil?: number; membersOnlyIds?: Set<number> }, publicFeed = false, now = Date.now()): AccessMetadata {
  const remaining = (until = Infinity) => Math.max(0, Math.floor(Math.min(startedAt + 60_000, until) - now));
  const identityMs = principal ? remaining(principal.expiresAt ? Date.parse(principal.expiresAt) : Infinity) : 0;
  const spaceMs = scope ? Math.min(identityMs, remaining(scope.validUntil)) : 0;
  return {
    version: 1,
    ...(principal ? { identity: { viewerId: principal.viewer.id, remainingMs: identityMs } } : {}),
    ...(scope ? { spaceView: { spaceId: scope.spaceId, remainingMs: spaceMs } } : {}),
    publicationViews: scope ? items.filter(i => i.publicationId && i.spaceId === scope.spaceId).map(i => ({
      publicationId: i.publicationId!, spaceId: scope.spaceId, uploadId: i.uploadId,
      productionUlid: i.productionUlid, creatorId: i.creator.id,
      remainingMs: Math.min(spaceMs, remaining(scope.membersOnlyIds?.has(i.publicationId!) ? scope.publicationValidUntil : scope.validUntil)),
    })) : [],
    ...(publicFeed ? { publicView: { remainingMs: remaining(), publicationIds: items.map(i => i.publicationId!).filter(Boolean) } } : {}),
  };
}

export function playbackIds(query: Record<string, unknown>): number[] {
  if (Object.keys(query).length !== 1 || typeof query.publicationIds !== 'string'
    || !/^[1-9]\d*(?:,[1-9]\d*){0,2}$/.test(query.publicationIds)) throw new ViewerApiError(400, 'invalid_query');
  const ids = query.publicationIds.split(',').map(Number);
  if (ids.some(id => !Number.isSafeInteger(id)) || new Set(ids).size !== ids.length) throw new ViewerApiError(400, 'invalid_query');
  return ids;
}
