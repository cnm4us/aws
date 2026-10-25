import { Router } from 'express';
import { listGlobalFeedRows } from '../feeds/repo';
import { loadCreators } from '../profiles/viewer';
import { resolveViewer, ViewerApiError } from '../native-sessions/service';
import { sendViewerError } from '../../routes/native-session';
import { positiveId, emptyQuery, noBody } from '../engagement/contract';
import { followingInSpaces } from './repo';

export function createGlobalRecognition(deps={select:listGlobalFeedRows,creators:loadCreators,followingInSpaces}) {
  const source=async(publicationId:number,userId:number)=>{
    const row=(await deps.select({publicationId,userId,limit:1}))[0];
    const creatorId=Number(row?.owner_id);
    if(!row || Number(row.publication_id)!==publicationId || !Number.isSafeInteger(creatorId) || creatorId<=0
      || !(await deps.creators([creatorId])).has(creatorId))throw new ViewerApiError(404,'publication_not_found');
    return creatorId;
  };
  return async(publicationId:number,userId:number)=>{
    const creatorId=await source(publicationId,userId);
    const follows=creatorId!==userId && await deps.followingInSpaces(creatorId,userId);
    if(await source(publicationId,userId)!==creatorId)throw new ViewerApiError(404,'publication_not_found');
    return {publicationId,creatorId,followingInSpaces:follows};
  };
}
export function createGlobalRecognitionRouter(deps={resolveViewer,recognition:createGlobalRecognition()}) {
  const router=Router();
  router.get('/feed/global/publications/:publicationId/creator-recognition',async(req,res)=>{
    res.set('Cache-Control','no-store');
    try {
      const principal=(await deps.resolveViewer(req,true))!;
      emptyQuery(req.query);noBody(req.body);
      res.json(await deps.recognition(positiveId(req.params.publicationId),principal.viewer.id));
    }catch(error){sendViewerError(res,error);}
  });
  return router;
}
