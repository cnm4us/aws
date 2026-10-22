import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createApiClient, ApiError } from '../api/client';
import { fetchViewerFeed } from '../api/feed';
import { useAuth, nativeFetch } from '../auth/useAuth';
import { contextKey, type FeedContext } from './context';
import { FeedStore } from './feedStore';
import type { FeedCheckpoint } from '../navigation/viewerJourney';

export function useViewerClient() {
  const {store:auth,snapshot,baseUrl}=useAuth();
  const generation=snapshot.generation,token=auth.credentialFor(generation);
  const client=useMemo(()=>createApiClient(baseUrl,{fetchImpl:nativeFetch,
    getHeaders:():Record<string,string>=>token?{Authorization:`Bearer ${token}`}:{}}),[baseUrl,generation,token]);
  return {client,auth,generation};
}
export function useViewerFeed(context:FeedContext,restore?:FeedCheckpoint) {
  const {client,auth,generation}=useViewerClient();
  const key=contextKey(context);
  const resumeAnchor=useMemo(()=>({current:restore?.publicationId??undefined}),[client,key,restore]);
  const store=useMemo(()=>new FeedStore((cursor,signal)=>fetchViewerFeed(client,context,signal,cursor,
    !cursor?resumeAnchor.current:undefined),error=>{
    if(error instanceof ApiError && error.status===401)void auth.invalidate(generation);
  }),[client,key,restore]);
  const snapshot=useSyncExternalStore(store.subscribe,store.getSnapshot);
  useEffect(()=>{void store.refresh();return store.cancel;},[store]);
  return {store,snapshot,client,clearResume:()=>{resumeAnchor.current=undefined;}};
}
