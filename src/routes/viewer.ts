import { Router } from 'express';
import { resolveViewer, ViewerApiError } from '../features/native-sessions/service';
import * as feeds from '../features/feeds/service';
import * as spaces from '../features/spaces/service';
import { serializeViewerFeedWithCreators, parseViewerQuery } from '../features/feeds/viewer';
import { aroundPublication } from '../features/feeds/resume';
import { getCreatorView } from '../features/profiles/viewer';
import { sendViewerError } from './native-session';

export function createViewerRouter() {
  const router=Router();
  router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
  router.get('/creators/:userId',async(req,res)=>{
    try {
      const p=await resolveViewer(req,false);
      const id=Number(req.params.userId);
      if(!/^[1-9]\d*$/.test(req.params.userId) || !Number.isSafeInteger(id))throw new ViewerApiError(400,'invalid_query');
      res.json(await getCreatorView(id,p?.viewer.id ?? null));
    }catch(e){sendViewerError(res,e);}
  });
  router.get('/feed/global',async(req,res)=>{
    try {
      const principal=await resolveViewer(req,false);
      const query=parseViewerQuery(req.query);
      const load=(selection:Parameters<typeof feeds.getGlobalFeed>[0])=>feeds.getGlobalFeed({...selection,userId:principal?.viewer.id});
      const data=query.anchorPublicationId ? await aroundPublication(load,query.anchorPublicationId,query.limit) : await load(query);
      res.json({...await serializeViewerFeedWithCreators(data,{kind:'global'}),...('resume' in data?{resume:data.resume}:{})});
    }catch(e){sendViewerError(res,e);}
  });
  router.get('/me/spaces',async(req,res)=>{
    try {
      const p=(await resolveViewer(req,true))!;
      const mine=await spaces.getMySpaces(p.viewer.id);
      const allowed=async(s:any)=>s && await spaces.canViewSpaceFeed(await spaces.loadSpaceOrThrow(s.id),p.viewer.id);
      const filter=async(items:any[])=>{const flags=await Promise.all(items.map(allowed));return items.filter((_,i)=>flags[i]);};
      res.json({personal:await allowed(mine.personal)?mine.personal:null,groups:await filter(mine.groups),channels:await filter(mine.channels)});
    }catch(e){sendViewerError(res,e);}
  });
  router.get('/spaces/:id/feed',async(req,res)=>{
    try {
      const p=(await resolveViewer(req,true))!;
      const id=Number(req.params.id);
      if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(id)) throw new ViewerApiError(400,'invalid_query');
      const query=parseViewerQuery(req.query);
      await spaces.assertCanViewSpaceFeed(id,p.viewer.id);
      const s=await spaces.loadSpaceOrThrow(id);
      const load=(selection:Omit<Parameters<typeof feeds.getSpaceFeed>[1],'userId'>)=>feeds.getSpaceFeed(id,{...selection,userId:p.viewer.id});
      const data=query.anchorPublicationId ? await aroundPublication(load,query.anchorPublicationId,query.limit) : await load(query);
      res.json({...await serializeViewerFeedWithCreators(data,{kind:'space',space:{id:s.id,ulid:s.ulid || null,name:s.name || '',slug:s.slug || '',type:s.type}}),
        ...('resume' in data?{resume:data.resume}:{})});
    }catch(e){sendViewerError(res,e);}
  });
  return router;
}
