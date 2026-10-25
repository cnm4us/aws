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
    getHeaders:():Record<string,string>=>token?{Authorization:`Bearer ${token}`}:{}}),[baseUrl,generation,token]);
  return {client,auth,generation};
}
export function useViewerFeed(context:FeedContext,restore?:FeedCheckpoint,entry?:LaunchEntry,trace?:NavigationTrace) {
  const {client,auth,generation}=useViewerClient();
  const key=contextKey(context);
  const resumeAnchor=useMemo(()=>({current:entry?.publicationId??restore?.publicationId??undefined,entryPending:!!entry}),[client,key,restore,entry]);
  const {store,initialAccess,initial}=useMemo(()=>{
    const load=async(cursor:string|null,signal:AbortSignal)=>{
      const page=await fetchViewerFeed(client,context,signal,cursor,!cursor?resumeAnchor.current:undefined);
      if(signal.aborted || auth.getSnapshot().generation!==generation)throw Error('Cancelled');
      if(!cursor && resumeAnchor.entryPending && entry){validateLaunchEntry(page,entry);resumeAnchor.entryPending=false;resumeAnchor.current=undefined;}
      const result=!cursor && restore?validateOriginProduction(page,restore):page;
      if(!cursor)trace?.mark('feed_ready');
      return result;
    };
    const initial=new InitialFeed(async signal=>{
      if(context.kind==='space'){
        if(!await auth.validate())throw new ApiError('Cannot verify sign-in. Reconnect and try again.');
        if(auth.getSnapshot().generation!==generation || signal.aborted)throw Error('Cancelled');
        trace?.mark('account_verified');
      }
      return load(null,signal);
    });
    let first=true;
    const store=new FeedStore((cursor,signal)=>{if(first && !cursor){first=false;return initial.get();}return load(cursor,signal);},error=>{
      if(error instanceof ApiError && error.status===401)void auth.invalidate(generation);
      trace?.finish('failed');
    });
    return {store,initial,initialAccess:context.kind==='space'?initial.verify:undefined};
  },[client,key,restore,entry]);
  const snapshot=useSyncExternalStore(store.subscribe,store.getSnapshot);
  useEffect(()=>{void store.refresh();return()=>{store.cancel();initial.dispose();trace?.finish('interrupted');};},[store]);
  return {store,snapshot,client,initialAccess,entryPending:resumeAnchor.entryPending,clearResume:()=>{resumeAnchor.current=undefined;resumeAnchor.entryPending=false;}};
}
