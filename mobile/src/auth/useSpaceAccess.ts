import { useEffect,useLayoutEffect,useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import type { ApiClient } from '../api/client';
import { ApiError } from '../api/client';
import type { FeedContext } from '../feed/context';
import type { FeedStore } from '../feed/feedStore';
import type { FeedVideoItem } from '../feed/types';
import { adaptViewerFeedPage } from '../feed/adaptFeed';
import { itemKey } from './accessProof';
import { useAuth } from './useAuth';

export function useSpaceAccess(context:FeedContext,_client:ApiClient,feed:FeedStore,focused:boolean,initialAccess?:((signal:AbortSignal)=>Promise<{verifiedAt:number}>)) {
 const {store:auth}=useAuth(),manager=auth.access;
 useSyncExternalStore(manager.subscribe,manager.getSnapshot);
 useEffect(()=>{
  if(context.kind!=='space'||!initialAccess)return;const request=new AbortController();
  void initialAccess(request.signal).catch(()=>{});return()=>request.abort();
 },[initialAccess,context.kind]);
 const authorized=context.kind!=='space'||manager.spaceValid(context.spaceId);
 const error=context.kind==='space'&&!authorized&&!feed.getSnapshot().initialLoading
  ?manager.error(context.spaceId)?.message??'Access confirmation expired. Reconnect and try again.':null;
 return {authorized,checking:context.kind==='space'&&!authorized&&(feed.getSnapshot().initialLoading||manager.checking(context.spaceId)),error,
  check:()=>context.kind==='space'?manager.check(context.spaceId):Promise.resolve(true)};
}

// The shared manager owns renewal; this hook merely registers the visible
// selected/neighbor window. Covering a route releases work, not valid authority.
export function usePublicationAccess(context:FeedContext,client:ApiClient,feed:FeedStore,visible:boolean,items:FeedVideoItem[]) {
 const {store:auth,snapshot}=useAuth(),manager=auth.access;
 useSyncExternalStore(manager.subscribe,manager.getSnapshot);
 const key=items.map(itemKey).join('|'),spaceId=context.kind==='space'?context.spaceId:0;
 useLayoutEffect(()=>{
  if(!spaceId||!visible||!snapshot.viewer||!items.length)return;
  let release:(()=>void)|undefined;
  const update=()=>{
   release?.();release=undefined;
   if(AppState.currentState==='active')release=manager.watch(spaceId,items,async signal=>{
    try{
     const raw=await client.getJson(`/api/viewer/v1/spaces/${spaceId}/playback-access?publicationIds=${items.map(i=>i.publicationId).join(',')}`,signal);
     const page=adaptViewerFeedPage(raw,context);
     if(signal.aborted||auth.getSnapshot().generation!==snapshot.generation||!manager.seedPage(page))throw new Error('Cancelled');
     if(!page.items.some(i=>i.publicationId===items[0].publicationId))throw new ApiError('This video is no longer available.',404,'publication_not_found');
     feed.reconcileItems(page.items);return page;
    }catch(e){if(e instanceof ApiError&&[403,404].includes(e.status??0))feed.denyAccess(e);throw e;}
   });
  };
  update();const sub=AppState.addEventListener('change',update);
  return()=>{sub.remove();release?.();};
 },[manager,spaceId,client,visible,snapshot.generation,!!snapshot.viewer,key,feed]);
 return !spaceId||AppState.currentState==='active'&&(!items[0]||manager.canView(items[0]));
}
