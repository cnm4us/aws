import { getPool, type Queryable } from '../../db';
import * as spaces from '../spaces/service';
import { listSpaceFeedRows } from '../feeds/repo';
import { ViewerApiError } from '../native-sessions/service';

export type FollowContext = { spaceId: number; publicationId: number; userId: number; expectedCreatorId?: number };
export type FollowTarget = { creatorId: number; space: { id: number; name: string; type: 'group' | 'channel' } };
const dependencies = { space: spaces.loadSpaceOrThrow, canView: spaces.canViewSpaceFeed, select: listSpaceFeedRows };
export function createFollowAccess(deps = dependencies) {
  return async (ctx: FollowContext, db: Queryable = getPool()): Promise<FollowTarget> => {
    const space = await deps.space(ctx.spaceId, db);
    const settings = typeof space.settings === 'string' ? JSON.parse(space.settings) : space.settings ?? {};
    if (!['group', 'channel'].includes(space.type) || ['global', 'global-feed'].includes(String(space.slug).toLowerCase())
      || settings.global === true || settings.isGlobal === true || settings.feed === 'global') throw new ViewerApiError(403, 'forbidden');
    if (!await deps.canView(space, ctx.userId, db)) throw new ViewerApiError(403, 'forbidden');
    const row = (await deps.select(ctx.spaceId, { publicationId: ctx.publicationId, userId: ctx.userId, limit: 1 }, db))[0];
    if (!row || Number(row.publication_id) !== ctx.publicationId || Number(row.space_id) !== ctx.spaceId) throw new ViewerApiError(404, 'publication_not_found');
    const creatorId = Number(row.owner_id);
    if (!Number.isSafeInteger(creatorId) || creatorId <= 0 || ctx.expectedCreatorId !== undefined && creatorId !== ctx.expectedCreatorId)
      throw new ViewerApiError(404, 'creator_not_found');
    const [users] = await db.query('SELECT id FROM users WHERE id=? AND deleted_at IS NULL', [creatorId]);
    if (!(users as any[]).length) throw new ViewerApiError(404, 'creator_not_found');
    return { creatorId, space: { id: ctx.spaceId, name: String(space.name || 'Space').slice(0, 200), type: space.type as 'group' | 'channel' } };
  };
}
export const followAccess = createFollowAccess();
