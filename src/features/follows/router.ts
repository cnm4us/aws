import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { resolveViewer, ViewerApiError } from '../native-sessions/service';
import { sendViewerError } from '../../routes/native-session';
import { positiveId, noBody } from '../engagement/contract';
import { creatorFollow } from './service';

export function createFollowRouter(legacy = false, deps = { resolveViewer, creatorFollow }) {
  const router = Router();
  const path = legacy ? '/api/spaces/:spaceId/users/:creatorId/follow' : '/spaces/:spaceId/publications/:publicationId/creator-follow';
  for (const method of ['get', 'post', 'delete'] as const) router[method](path,
    (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); },
    ...(legacy ? [requireAuth] : []), async (req, res) => {
      try {
        const principal = (await deps.resolveViewer(req, true))!;
        if (legacy && principal.source !== 'cookie') throw new ViewerApiError(401, 'unauthorized');
        if (Object.keys(req.query).some(k => !legacy || k !== 'publicationId')) throw new ViewerApiError(400, 'invalid_query');
        noBody(req.body);
        const ctx = { spaceId: positiveId(req.params.spaceId), userId: principal.viewer.id,
          publicationId: positiveId(legacy ? req.query.publicationId : req.params.publicationId),
          ...(legacy ? { expectedCreatorId: positiveId(req.params.creatorId) } : {}) };
        res.json(method === 'get' ? await deps.creatorFollow.summary(ctx) : await deps.creatorFollow.set(ctx, method === 'post'));
      } catch (error) { sendViewerError(res, error); }
    });
  return router;
}
