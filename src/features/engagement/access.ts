import { getPool, type Queryable } from '../../db';
import * as spaces from '../spaces/service';
import { listSpaceFeedRows } from '../feeds/repo';
import { can } from '../../security/permissions';
import { PERM } from '../../security/perm';
import { ViewerApiError } from '../native-sessions/service';

const dependencies = { space: spaces.loadSpaceOrThrow, canView: spaces.canViewSpaceFeed, select: listSpaceFeedRows, can };
export function createEngagementAccess(deps = dependencies) {
  return async (spaceId: number, publicationId: number, userId: number, db: Queryable = getPool()) => {
    const space = await deps.space(spaceId, db);
    const settings = typeof space.settings === 'string' ? JSON.parse(space.settings) : space.settings ?? {};
    if (!['personal','group','channel'].includes(space.type) || ['global','global-feed'].includes(String(space.slug).toLowerCase())
      || settings.global === true || settings.isGlobal === true || settings.feed === 'global') throw new ViewerApiError(403,'forbidden');
    if (!await deps.canView(space,userId,db)) throw new ViewerApiError(403,'forbidden');
    const row = (await deps.select(spaceId,{publicationId,userId,limit:1},db))[0];
    if (!row || Number(row.publication_id) !== publicationId || Number(row.space_id) !== spaceId) throw new ViewerApiError(404,'publication_not_found');
    const [rows] = await db.query('SELECT comments_enabled FROM space_publications WHERE id=? AND space_id=?',[publicationId,spaceId]);
    const pub = (rows as any[])[0];
    if (!pub) throw new ViewerApiError(404,'publication_not_found');
    const disabledReason = settings.comments === 'off' || Number(pub.comments_enabled) === 0 && pub.comments_enabled != null
      ? 'comments_disabled' as const : !await deps.can(userId,PERM.COMMENT_CREATE,{spaceId,db}) ? 'comment_forbidden' as const : null;
    return { canComment: disabledReason === null, disabledReason };
  };
}
export const engagementAccess = createEngagementAccess();
