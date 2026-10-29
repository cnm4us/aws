import {createAggregateRouter} from '../features/aggregate-feeds/router';
import { requireEntry } from '../features/discovery/service';
import { entryReceipt } from '../features/discovery/router';
import { createDiscoveryRouter } from '../features/discovery/router';
import { createReportingRouter } from '../features/reports/viewer';
import { accessMetadata, playbackIds } from '../features/native-sessions/access';
import { createFollowRouter } from '../features/follows/router';
import { createGlobalRecognitionRouter } from '../features/follows/globalRecognition';
import { engagement } from '../features/engagement/service';
import { positiveId, parsePage, commentBody, emptyQuery, noBody } from '../features/engagement/contract';
import { Router } from 'express';
import { resolveViewer, ViewerApiError } from '../features/native-sessions/service';
import * as feeds from '../features/feeds/service';
import * as spaces from '../features/spaces/service';
import { serializeViewerFeedWithCreators, parseViewerQuery } from '../features/feeds/viewer';
import { aroundPublication } from '../features/feeds/resume';
import { getCreatorView } from '../features/profiles/viewer';
import { sendViewerError } from './native-session';
import { viewerLaunch, launchId } from '../features/publications/viewerLaunch';
import { viewerText, textId, type TextContext } from '../features/publications/viewerText';

export function createViewerRouter(engagementDeps = { resolveViewer, engagement }, entryDeps = { requireEntry }) {
  const router=Router();
  router.use((_req,res,next)=>{
    res.locals.accessStartedAt=Date.now();res.set('Cache-Control','no-store');
    const json=res.json.bind(res);
    res.json=body=>json(res.statusCode>=200&&res.statusCode<300&&body&&typeof body==='object'&&!body.access&&res.locals.viewerPrincipal
      ?{...body,access:accessMetadata(res.locals.accessStartedAt,res.locals.viewerPrincipal)}:body);
    next();
  });
  router.use(createDiscoveryRouter());
  router.use(createAggregateRouter());
  router.use(createReportingRouter());
  router.use(createFollowRouter());
  router.use(createGlobalRecognitionRouter());
  for (const scope of ['global', 'space'] as const) {
    const prefix = scope === 'global' ? '/feed/global/publications/:publicationId' : '/spaces/:spaceId/publications/:publicationId';
    for (const resource of ['story', 'captions.vtt'] as const) router.get(`${prefix}/${resource}`, async (req, res) => {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      res.on('close', cancel);
      try {
        const principal = await resolveViewer(req, scope === 'space');
        const publicationId = textId(req.params.publicationId);
        const context: TextContext = scope === 'global' ? { kind: 'global' } : { kind: 'space', spaceId: textId((req.params as Record<string,string>).spaceId) };
        const userId = principal?.viewer.id ?? null;
        if (resource === 'story') res.json(await viewerText.story(context, publicationId, userId));
        else {
          const text = await viewerText.captions(context, publicationId, userId, controller.signal);
          res.set('Content-Type', 'text/vtt; charset=utf-8').send(text);
        }
      } catch (e) { if (!controller.signal.aborted) sendViewerError(res, e); }
      finally { res.off('close', cancel); }
    });
  }
  for (const resolve of [false,true]) router.get(`/feed/global/publications/:publicationId/spaces${resolve?'/:spaceId':''}`,async(req,res)=>{
    const controller=new AbortController();const cancel=()=>controller.abort();res.on('close',cancel);
    try {
      const principal=(await resolveViewer(req,true))!;
      const publicationId=launchId(req.params.publicationId);
      const includeEntry=resolve && req.query.include==='entry';
      if(resolve && (Object.keys(req.query).length>(includeEntry?1:0)))throw new ViewerApiError(400,'invalid_query');
      const result=resolve?await viewerLaunch.resolve(publicationId,launchId((req.params as Record<string,string>).spaceId),principal.viewer.id,controller.signal)
        :await viewerLaunch.list(publicationId,principal.viewer.id,req.query,controller.signal);
      let entry;
      if(includeEntry) {
        const target=result as Awaited<ReturnType<typeof viewerLaunch.resolve>>;
        await entryDeps.requireEntry(target.space.id,principal.viewer.id,entryReceipt(req));
        entry=await confirmedPage(target.space.id,principal,res.locals.accessStartedAt,{limit:20,cursor:undefined,anchorPublicationId:target.publicationId});
        const again=await viewerLaunch.resolve(publicationId,target.space.id,principal.viewer.id,controller.signal);
        const selected=entry.items.find(i=>i.publicationId===target.publicationId);
        if(again.publicationId!==target.publicationId || !selected || selected.productionUlid!==target.productionUlid || selected.creator.id!==target.creator.id)
          throw new ViewerApiError(404,'launch_target_unavailable');
      }
      if(!controller.signal.aborted)res.json({...result,...(entry?{entry}:{})});
    }catch(e){if(!controller.signal.aborted)sendViewerError(res,e);}
    finally{res.off('close',cancel);}
  });
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
      const page=await serializeViewerFeedWithCreators(data,{kind:'global'});
      res.json({...page,...('resume' in data?{resume:data.resume}:{}),access:accessMetadata(res.locals.accessStartedAt,principal,page.items,undefined,true)});
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
      res.json(await confirmedPage(id,p,res.locals.accessStartedAt,query));
    }catch(e){sendViewerError(res,e);}
  });
  router.get('/spaces/:id/playback-access',async(req,res)=>{
    try {
      const p=(await resolveViewer(req,true))!, id=positiveId(req.params.id), ids=playbackIds(req.query);
      const decision=await spaces.confirmedSpaceView(id,p.viewer.id);
      const pages=await Promise.all(ids.map(publicationId=>feeds.getSpaceFeed(id,{publicationId,userId:p.viewer.id,limit:1})));
      const data={items:pages.flatMap(page=>page.items),nextCursor:null};
      const page=await serializeViewerFeedWithCreators(data,{kind:'space',space:{...decision.space}});
      const membersOnlyIds=new Set(data.items.filter(i=>i.publication.visibility==='members').map(i=>i.publication.id));
      res.json({...page,unavailable:ids.filter(id=>!page.items.some(i=>i.publicationId===id)),
        access:accessMetadata(res.locals.accessStartedAt,p,page.items,{spaceId:id,...decision,membersOnlyIds})});
    }catch(e){sendViewerError(res,e);}
  });
  const engagementPrefix='/spaces/:spaceId/publications/:publicationId';
  for(const resource of ['engagement','like','comments'] as const) {
    const methods=resource==='engagement'?['get'] as const:resource==='like'?['post','delete'] as const:['get','post'] as const;
    for(const method of methods)router[method](`${engagementPrefix}/${resource}`,async(req,res)=>{
      try {
        const principal=(await engagementDeps.resolveViewer(req,true))!;
        const ctx={spaceId:positiveId((req.params as any).spaceId),publicationId:positiveId((req.params as any).publicationId),userId:principal.viewer.id};
        if(resource==='comments' && method==='get') {noBody(req.body);res.json(await engagementDeps.engagement.comments(ctx,parsePage(req.query,ctx)));}
        else {
          emptyQuery(req.query);
          if(resource==='comments') {
            if(!req.is('application/json'))throw new ViewerApiError(400,'invalid_body');
            res.status(201).json(await engagementDeps.engagement.create(ctx,commentBody(req.body).body));
          } else {noBody(req.body);res.json(resource==='engagement'?await engagementDeps.engagement.summary(ctx):await engagementDeps.engagement.like(ctx,method==='post'));}
        }
      }catch(e){sendViewerError(res,e);}
    });
  }
  return router;
}

async function confirmedPage(id:number, p:NonNullable<Awaited<ReturnType<typeof resolveViewer>>>, startedAt:number,
  query:ReturnType<typeof parseViewerQuery>) {
  const decision=await spaces.confirmedSpaceView(id,p.viewer.id),s=decision.space;
  const load=(selection:Omit<Parameters<typeof feeds.getSpaceFeed>[1],'userId'>)=>feeds.getSpaceFeed(id,{...selection,userId:p.viewer.id});
  const data=query.anchorPublicationId ? await aroundPublication(load,query.anchorPublicationId,query.limit) : await load(query);
  const page=await serializeViewerFeedWithCreators(data,{kind:'space',space:{id:s.id,ulid:s.ulid || null,name:s.name || '',slug:s.slug || '',type:s.type}});
  const membersOnlyIds=new Set(data.items.filter(i=>i.publication.visibility==='members').map(i=>i.publication.id));
  return {...page,...('resume' in data?{resume:data.resume}:{}),access:accessMetadata(startedAt,p,page.items,{spaceId:id,...decision,membersOnlyIds})};
}
