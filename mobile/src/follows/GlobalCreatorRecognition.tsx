import { useEffect,useLayoutEffect,useMemo,useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { ApiError } from '../api/client';
import { useViewerClient } from '../feed/useViewerFeed';
import { VerifiedRefresh,verificationClock } from '../auth/verifiedRefresh';
import { CreatorButton } from '../ui/CreatorButton';
import { loadRecognition } from './api';
// Recognition is read-only. The Global feed retains ownership of account checks and playback.
export function GlobalCreatorRecognition({publicationId,creatorId,name,avatarUrl,eligible,onCreator}:{
  publicationId:number;creatorId:number;name:string;avatarUrl:string|null;eligible:boolean;onCreator:()=>void;
}) {
  const {auth,client,generation}=useViewerClient();
  const store=useMemo(()=>new VerifiedRefresh(async signal=>{
    const verifiedAt=verificationClock();
    if(auth.getSnapshot().generation!==generation || auth.getSnapshot().status!=='authenticated')throw new Error('Cancelled');
    return {value:await loadRecognition(client,publicationId,creatorId,signal),verifiedAt};
  },{protected:true,onError:error=>{
    if(error instanceof ApiError && error.status===401 && auth.getSnapshot().generation===generation)void auth.invalidate(generation);
  }}),[auth,client,generation,publicationId,creatorId]);
  const state=useSyncExternalStore(store.subscribe,store.getSnapshot);
  const active=eligible && auth.getSnapshot().generation===generation && auth.getSnapshot().status==='authenticated';
  useLayoutEffect(()=>{
    const update=()=>store.setActive(active && AppState.currentState==='active',true);
    update();const sub=AppState.addEventListener('change',update);
    return()=>{sub.remove();store.setActive(false);};
  },[store,active]);
  useEffect(()=>()=>store.dispose(),[store]);
  const known=active && AppState.currentState==='active' ? state.value : undefined;
  const hint=known ? known.followingInSpaces ? 'Following this creator in a space. Launch to explore their spaces.'
    : 'Not following this creator in any space. Launch to explore their spaces.'
    : state.error ? 'Creator recognition unavailable. Refresh the feed to try again.' : 'Checking creator recognition.';
  return <CreatorButton name={name} avatarUrl={avatarUrl} disabled={!eligible} onPress={onCreator}
    followState={known?.followingInSpaces?'elsewhere':undefined} accessibilityHint={hint}/>;
}
