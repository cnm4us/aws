import { useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import type { ApiClient } from '../api/client';
import { ApiError } from '../api/client';
import type { FeedContext } from '../feed/context';
import { contextKey } from '../feed/context';
import type { FeedStore } from '../feed/feedStore';
import { useAuth } from './useAuth';
import { AccessGuard } from './accessGuard';

export function useSpaceAccess(context:FeedContext,client:ApiClient,feed:FeedStore,focused:boolean,initialAccess?:((signal:AbortSignal)=>Promise<{verifiedAt:number}>)) {
  const {store:auth,snapshot}=useAuth();const generation=snapshot.generation;
  const protectedFeed=context.kind==='space';
  const guard=useMemo(()=>{let first=initialAccess;return new AccessGuard(async signal=>{
    if(first){const verify=first;first=undefined;return await verify(signal);}
    if(!await auth.validate())throw new ApiError('Cannot verify sign-in. Reconnect and try again.');
    if(auth.getSnapshot().generation!==generation || signal.aborted)throw new Error('Cancelled');
    if(context.kind==='space')await client.getJson(`/api/viewer/v1/spaces/${context.spaceId}/feed?limit=1`,signal);
  },error=>{if(auth.getSnapshot().generation===generation)feed.denyAccess(error);});},[client,feed,contextKey(context),generation,initialAccess]);
  const state=useSyncExternalStore(guard.subscribe,guard.getSnapshot);
  useLayoutEffect(()=>{
    if(!protectedFeed)return;
    let release:(()=>void)|undefined;
    const update=(appActive:boolean)=>{
      const active=focused && appActive && auth.getSnapshot().status==='authenticated';
      if(active && !release)release=auth.claimRoutineValidation();
      else if(!active){release?.();release=undefined;}
      guard.setActive(active);
    };
    update(AppState.currentState==='active');
    const sub=AppState.addEventListener('change',state=>update(state==='active'));
    // Invalidate synchronously on account failure, before recovery can reuse old authority.
    const unsubscribe=auth.subscribe(()=>update(AppState.currentState==='active'));
    return()=>{sub.remove();unsubscribe();release?.();guard.setActive(false);};
  },[guard,auth,focused,protectedFeed]);
  useEffect(()=>()=>guard.dispose(),[guard]);
  return {authorized:!protectedFeed || state.authorized,checking:protectedFeed && state.checking,error:protectedFeed?state.error:null,
    check:()=>protectedFeed?guard.check():Promise.resolve(true)};
}
