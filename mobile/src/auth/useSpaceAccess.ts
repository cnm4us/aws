import { useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import type { ApiClient } from '../api/client';
import { ApiError } from '../api/client';
import type { FeedContext } from '../feed/context';
import { contextKey } from '../feed/context';
import type { FeedStore } from '../feed/feedStore';
import { useAuth } from './useAuth';
import { AccessGuard } from './accessGuard';

export function useSpaceAccess(context:FeedContext,client:ApiClient,feed:FeedStore,focused:boolean) {
  const {store:auth,snapshot}=useAuth();const generation=snapshot.generation;
  const protectedFeed=context.kind==='space';
  const guard=useMemo(()=>new AccessGuard(async signal=>{
    if(!await auth.validate())throw new ApiError('Cannot verify sign-in. Reconnect and try again.');
    if(auth.getSnapshot().generation!==generation || signal.aborted)throw new Error('Cancelled');
    if(context.kind==='space')await client.getJson(`/api/viewer/v1/spaces/${context.spaceId}/feed?limit=1`,signal);
  },error=>{if(auth.getSnapshot().generation===generation)feed.denyAccess(error);}),[client,feed,contextKey(context),generation]);
  const state=useSyncExternalStore(guard.subscribe,guard.getSnapshot);
  useLayoutEffect(()=>{
    if(!protectedFeed)return;
    guard.setActive(focused && AppState.currentState==='active');
    const sub=AppState.addEventListener('change',state=>guard.setActive(focused && state==='active'));
    return()=>{sub.remove();guard.setActive(false);};
  },[guard,focused,protectedFeed]);
  useEffect(()=>{
    if(!protectedFeed)return;
    const timer=setInterval(()=>{if(focused && AppState.currentState==='active')void guard.check();},60_000);
    return()=>clearInterval(timer);
  },[guard,focused,protectedFeed]);
  useEffect(()=>()=>guard.dispose(),[guard]);
  return {authorized:!protectedFeed || state.authorized,checking:protectedFeed && state.checking,error:protectedFeed?state.error:null,
    check:()=>protectedFeed?guard.check():Promise.resolve(true)};
}
