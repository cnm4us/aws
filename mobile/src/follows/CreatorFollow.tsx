import { useEffect,useMemo,useRef,useSyncExternalStore } from 'react';
import { AppState,Pressable,StyleSheet,Text,View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useViewerClient } from '../feed/useViewerFeed';
import { ApiError } from '../api/client';
import { Action } from '../ui/Message';
import { FollowStore } from './followStore';
import type { FollowProof } from './api';
export function CreatorFollow({proof,onDenied}:{proof:FollowProof;onDenied?:(e:Error)=>void}) {
 const {auth,client,generation}=useViewerClient(),focused=useIsFocused(),denied=useRef(onDenied);denied.current=onDenied;
 const store=useMemo(()=>new FollowStore(client,proof,async signal=>{
  if(!await auth.validate())throw new ApiError('Cannot verify sign-in. Reconnect and try again.');
  if(signal.aborted || auth.getSnapshot().generation!==generation)throw new Error('Cancelled');
 },e=>{if(auth.getSnapshot().generation!==generation)return;if(e instanceof ApiError&&e.status===401)void auth.invalidate(generation);else denied.current?.(e);}),
 [client,auth,generation,proof.spaceId,proof.publicationId,proof.creatorId,proof.generation,proof.visitId]);
 const state=useSyncExternalStore(store.subscribe,store.getSnapshot);
 // Account lifecycle rerenders through useViewerClient; app events also mask synchronously.
 const status=auth.getSnapshot().status;
 useEffect(()=>{
  let release:(()=>void)|undefined;
  const update=()=>{
   const active=focused&&proof.generation===generation&&auth.getSnapshot().status==='authenticated'&&AppState.currentState==='active';
   if(active&&!release)release=auth.claimRoutineValidation();else if(!active){release?.();release=undefined;}
   store.setActive(active);
  };
  update();const sub=AppState.addEventListener('change',update),unsubscribe=auth.subscribe(update);
  return()=>{sub.remove();unsubscribe();release?.();store.setActive(false);};
 },[auth,store,focused,generation,proof.generation]);
 useEffect(()=>()=>store.dispose(),[store]);
 const summary=state.authorized&&focused&&proof.generation===generation&&status==='authenticated'&&AppState.currentState==='active'?state.summary:null;
 return <View style={styles.card}>
  {summary?<>
   <Text accessibilityRole="header" style={styles.heading}>In {summary.space.name}</Text>
   {summary.canFollow?<Pressable accessibilityRole="button" accessibilityLabel={`${summary.following?'Unfollow':'Follow'} in ${summary.space.name}`}
    accessibilityState={{selected:summary.following,disabled:state.busy,busy:state.busy}} disabled={state.busy} onPress={()=>{void store.toggle();}} style={styles.button}>
    <Text style={styles.text}>{state.busy?'Updating…':summary.following?'Following':'Follow'}</Text>
   </Pressable>:<Text style={styles.text}>This is you.</Text>}
   <Text style={styles.text}>{summary.followersCount} {summary.followersCount===1?'follower':'followers'} in this space</Text>
  </>:<>
   <Text style={styles.heading}>{state.checking?'Checking Follow status':'Follow unavailable'}</Text>
   {state.uncertain&&<Text accessibilityRole="alert" style={styles.text}>Follow may have changed. Refresh status before trying again.</Text>}
   {state.error&&<Text accessibilityRole="alert" style={styles.text}>{state.error}</Text>}
   {!state.checking&&focused&&<Action label="Refresh Follow status" onPress={()=>{if(status==='unavailable')void auth.retryValidation();else store.retry();}}/>}
  </>}
 </View>;
}
const styles=StyleSheet.create({card:{gap:12,alignItems:'stretch'},heading:{color:'#fff',fontSize:21,fontWeight:'600'},text:{color:'#e4e4e7',fontSize:17,lineHeight:25},
 button:{minHeight:44,paddingHorizontal:16,paddingVertical:12,borderWidth:1,borderColor:'#62626b',borderRadius:24,alignItems:'center',backgroundColor:'#18181c'}});
