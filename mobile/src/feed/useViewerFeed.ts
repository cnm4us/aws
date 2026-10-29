import { entryReceiptHeader } from '../discovery/receipts';
import { accessScope } from '../auth/accessProof';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createApiClient, ApiError } from '../api/client';
import { fetchViewerFeed } from '../api/feed';
import { useAuth, nativeFetch } from '../auth/useAuth';
import { contextKey, type FeedContext } from './context';
import { FeedStore } from './feedStore';
import { InitialFeed } from './initialFeed';
import type { NavigationTrace } from '../diagnostics/playbackDiagnostics';
import { validateLaunchEntry, validateOriginProduction, type LaunchEntry } from '../navigation/globalLaunchJourney';
import type { FeedCheckpoint } from '../navigation/viewerJourney';

export function useViewerClient() {
  const {store:auth,snapshot,baseUrl}=useAuth();
  const generation=snapshot.generation,token=auth.credentialFor(generation);
  const client=useMemo(()=>createApiClient(baseUrl,{fetchImpl:nativeFetch,
    ticket:auth.access.ticket,onResponse:value=>auth.observeResponse(value,generation),onComplete:(path,httpStatus,durationMs,outcome)=>auth.recordDiagnostic({outcome,event:'http',scope:accessScope(path),httpStatus,durationMs}),onRequest:()=>auth.access.reading(),onError:(error,path)=>{
      if(auth.getSnapshot().generation!==generation)return;
      if(error.status===401)void auth.invalidate(generation);
      else {const match=/\/spaces\/(\d+)(?:\/publications\/(\d+))?/.exec(path);
        if(match&&(error.status===403&&!['comments_disabled','comment_forbidden','cannot_follow_self'].includes(error.code??'')||error.status===404&&!['captions_not_found','report_rule_unavailable'].includes(error.code??'')))
          auth.access.invalidate(Number(match[1]),['publication_not_found','creator_not_found'].includes(error.code??'')?Number(match[2])||undefined:undefined);
      }
    },
    getHeaders:(path:string):Record<string,string>=>token?{Authorization:`Bearer ${token}`}:entryReceiptHeader(baseUrl,path)}),[baseUrl,generation,token]);
  const publicClient=useMemo(()=>createApiClient(baseUrl,{fetchImpl:nativeFetch,ticket:auth.access.ticket,onComplete:(path,httpStatus,durationMs,outcome)=>auth.recordDiagnostic({event:'http',scope:'public',httpStatus,durationMs,outcome})}),[baseUrl,generation]);
  return {client,publicClient,auth,generation};
}
export function useViewerFeed(context:FeedContext,restore?:FeedCheckpoint,entry?:LaunchEntry,trace?:NavigationTrace) {
  const {client,publicClient,auth,generation}=useViewerClient();
  const key=contextKey(context);
  const resumeAnchor=useMemo(()=>({current:entry?.publicationId??restore?.publicationId??undefined,entryPending:!!entry}),[client,key,restore,entry]);
  const {store,initialAccess,initial,cached}=useMemo(()=>{
    const load=async(cursor:string|null,signal:AbortSignal)=>{
      const page=await fetchViewerFeed(context.kind==='global'&&auth.getSnapshot().status==='unavailable'?publicClient:client,context,signal,cursor,!cursor?resumeAnchor.current:undefined);
      if(signal.aborted || auth.getSnapshot().generation!==generation)throw Error('Cancelled');
      if(!cursor && resumeAnchor.entryPending && entry)validateLaunchEntry(page,entry);
      const result=!cursor && restore?validateOriginProduction(page,restore):page;
      if(context.kind==='global'&&restore?.publicationId&&result.resume?.outcome==='unavailable'){auth.globalFeed.clear();auth.access.invalidatePublic(restore.publicationId);}
      auth.access.seedPage(result);
      if(!cursor)trace?.mark('feed_ready');
      return result;
    };
    let cached=context.kind==='space'&&entry?.preparedPage?validateLaunchEntry(entry.preparedPage,entry)
      :context.kind==='global'&&restore?.publicationId?auth.globalFeed.take(restore.publicationId,auth.access):undefined;
    if(cached&&restore&&validateOriginProduction(cached,restore).resume?.outcome==='unavailable')cached=undefined;
    const initial=new InitialFeed(async signal=>{
      return load(null,signal);
    });
    let first=true;
    const store=new FeedStore((cursor,signal)=>{if(first && !cursor){first=false;return initial.get();}return load(cursor,signal);},error=>{
      if(error instanceof ApiError && error.status===401)void auth.invalidate(generation);
      trace?.finish('failed');
    },cached);
    return {store,initial,cached,initialAccess:context.kind==='space'&&!cached?initial.verify:undefined};
  },[client,key,restore,entry]);
  const snapshot=useSyncExternalStore(store.subscribe,store.getSnapshot);
  useEffect(()=>{if(cached){trace?.mark('cache_ready');trace?.mark('feed_ready');if(context.kind==='global')void store.revalidate();}else void store.refresh();return()=>{store.cancel();initial.dispose();trace?.finish('interrupted');};},[store]);
  return {store,snapshot,client,initialAccess,markEntryPresented:()=>{if(entry){resumeAnchor.entryPending=false;resumeAnchor.current=undefined;}},revalidateAt:(id:number|undefined)=>{resumeAnchor.current=id;void store.revalidate();},setResumeAnchor:(id:number|undefined)=>{resumeAnchor.current=id;},entryPending:resumeAnchor.entryPending,clearResume:()=>{resumeAnchor.current=undefined;resumeAnchor.entryPending=false;}};
}
