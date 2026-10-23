import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createApiClient, ApiError } from '../api/client';
import { fetchViewerFeed } from '../api/feed';
import { useAuth, nativeFetch } from '../auth/useAuth';
import { contextKey, type FeedContext } from './context';
import { FeedStore } from './feedStore';
import { validateLaunchEntry, validateOriginProduction, type LaunchEntry } from '../navigation/globalLaunchJourney';
import type { FeedCheckpoint } from '../navigation/viewerJourney';

export function useViewerClient() {
  const {store:auth,snapshot,baseUrl}=useAuth();
  const generation=snapshot.generation,token=auth.credentialFor(generation);
  const client=useMemo(()=>createApiClient(baseUrl,{fetchImpl:nativeFetch,
    getHeaders:():Record<string,string>=>token?{Authorization:`Bearer ${token}`}:{}}),[baseUrl,generation,token]);
  return {client,auth,generation};
}
export function useViewerFeed(context:FeedContext,restore?:FeedCheckpoint,entry?:LaunchEntry) {
  const {client,auth,generation}=useViewerClient();
  const key=contextKey(context);
  const resumeAnchor=useMemo(()=>({current:entry?.publicationId??restore?.publicationId??undefined,entryPending:!!entry}),[client,key,restore,entry]);
  const store=useMemo(()=>new FeedStore(async(cursor,signal)=>{
    const page=await fetchViewerFeed(client,context,signal,cursor,!cursor?resumeAnchor.current:undefined);
    if(!cursor && resumeAnchor.entryPending && entry){validateLaunchEntry(page,entry);resumeAnchor.entryPending=false;resumeAnchor.current=undefined;}
    return !cursor && restore?validateOriginProduction(page,restore):page;
  },error=>{
    if(error instanceof ApiError && error.status===401)void auth.invalidate(generation);
  }),[client,key,restore,entry]);
  const snapshot=useSyncExternalStore(store.subscribe,store.getSnapshot);
  useEffect(()=>{void store.refresh();return store.cancel;},[store]);
  return {store,snapshot,client,entryPending:resumeAnchor.entryPending,clearResume:()=>{resumeAnchor.current=undefined;resumeAnchor.entryPending=false;}};
}
