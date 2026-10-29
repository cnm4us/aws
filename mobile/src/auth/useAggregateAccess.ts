import {useEffect,useMemo,useRef,useSyncExternalStore} from 'react';
import {AppState} from 'react-native';
import type {ApiClient} from '../api/client';
import {ApiError} from '../api/client';
import {isAggregate,type FeedContext} from '../feed/context';
import type {FeedVideoItem} from '../feed/types';
import type {FeedStore} from '../feed/feedStore';
import {adaptViewerFeedPage} from '../feed/adaptFeed';
import {itemKey} from './accessProof';
import {VerifiedRefresh} from './verifiedRefresh';
import {useAuth} from './useAuth';
export function useAggregateAccess(context:FeedContext,client:ApiClient,feed:FeedStore,visible:boolean,items:FeedVideoItem[]){
 const {store:auth,snapshot}=useAuth(),manager=auth.access,current=useRef(items);current.current=items;
 useSyncExternalStore(manager.subscribe,manager.getSnapshot);
 const enabled=isAggregate(context),key=items.map(itemKey).join('|'),generation=snapshot.generation;
 const verification=useMemo(()=>new VerifiedRefresh(async signal=>{
  const window=current.current;if(!window.length)return {value:true,verifiedAt:performance.now()};
  const page=adaptViewerFeedPage(await client.getJson(`/api/viewer/v1/feed/${context.kind}?publicationIds=${window.map(i=>i.publicationId).join(',')}`,signal),context);
  if(signal.aborted||auth.getSnapshot().generation!==generation)throw Error('Cancelled');
  if(!page.items.some(i=>itemKey(i)===itemKey(window[0])))throw new ApiError('This video is no longer available in this feed. Refresh to continue.',404,'aggregate_item_unavailable');
  manager.seedPage(page);feed.reconcileItems(page.items);return {value:true,verifiedAt:page.access?.startedAt??performance.now()};
 },{protected:true,retainOnTransientError:true}),[client,context.kind,feed,auth,generation]);
 const state=useSyncExternalStore(verification.subscribe,verification.getSnapshot);
 useEffect(()=>{const update=()=>verification.setActive(enabled&&visible&&current.current.length>0&&AppState.currentState==='active'&&auth.getSnapshot().status==='authenticated',true);
  update();const sub=AppState.addEventListener('change',update);return()=>{sub.remove();verification.setActive(false);};
 },[verification,enabled,visible,!!items.length]);
 useEffect(()=>{if(enabled&&visible&&items.length)void verification.refresh(true);},[verification,key,enabled,visible]);
 useEffect(()=>()=>verification.dispose(),[verification]);
 return !enabled||!items.length||AppState.currentState==='active'&&state.value===true&&(!items[0]||manager.aggregateValid(context.kind,items[0]));
}
