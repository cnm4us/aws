import { type Queryable } from '../../db';
import { ViewerApiError } from '../native-sessions/service';
import { followAccess, type FollowContext, type FollowTarget } from './access';
import * as repo from './repo';

export function createCreatorFollowService(deps = { access: followAccess, ...repo }) {
  const sameTarget = (a: FollowTarget, b: FollowTarget) => {
    if (a.creatorId !== b.creatorId) throw new ViewerApiError(404, 'creator_not_found');
    return b;
  };
  const read = async (ctx: FollowContext, target: FollowTarget, db?: Queryable) => {
    const summary = await deps.getSummary(ctx.spaceId, target.creatorId, ctx.userId, db);
    const fresh = sameTarget(target, await deps.access(ctx, db));
    const self = fresh.creatorId === ctx.userId;
    return { space: fresh.space, publicationId: ctx.publicationId, creatorId: fresh.creatorId,
      following: !self && summary.following, followingElsewhere: !self && summary.followingElsewhere, followersCount: summary.followersCount,
      canFollow: !self, disabledReason: self ? 'self' as const : null };
  };
  return {
    summary: async (ctx: FollowContext) => read(ctx, await deps.access(ctx)),
    set: async (ctx: FollowContext, following: boolean) => {
      const target = await deps.access(ctx);
      if (target.creatorId === ctx.userId) throw new ViewerApiError(403, 'cannot_follow_self');
      return deps.transaction(ctx.publicationId, async db => {
        const fresh = sameTarget(target, await deps.access(ctx, db));
        await deps.setFollowing(ctx.spaceId, fresh.creatorId, ctx.userId, following, db);
        return read(ctx, fresh, db);
      });
    },
  };
}
export const creatorFollow = createCreatorFollowService();
