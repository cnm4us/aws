import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { useAuth } from '../auth/useAuth';
import { useViewerClient } from '../feed/useViewerFeed';
import { Action, Message } from '../ui/Message';
import { LaunchStore } from './launchStore';
import type { LaunchResolved } from './launchApi';

export function LaunchSpacesScreen({sourceId,productionUlid,onEnter,onClose,onSignIn,onSourceUnavailable}:{
  sourceId:number;productionUlid:string|null;onEnter:(entry:LaunchResolved)=>void;onClose:()=>void;onSignIn:()=>void;onSourceUnavailable:()=>void;
}) {
  const {snapshot}=useAuth(),{client,auth,generation}=useViewerClient(),focused=useIsFocused();
  const store=useMemo(()=>new LaunchStore(client,sourceId,productionUlid,()=>{void auth.invalidate(generation);},onSourceUnavailable),[client,sourceId,productionUlid,generation]);
  const state=useSyncExternalStore(store.subscribe,store.getSnapshot),signedIn=snapshot.status==='authenticated';
  useEffect(()=>{
    if(!focused||!signedIn)return;
    void store.refresh();const sub=AppState.addEventListener('change',status=>{if(status==='active')void store.refresh();else store.cancel();});
    return()=>{sub.remove();store.cancel();};
  },[store,focused,signedIn]);
  const enter=async(id:number)=>{const result=await store.enter(id);if(result && auth.getSnapshot().generation===generation)onEnter(result);};
  return <SafeAreaView style={styles.screen} edges={['bottom']}><ScrollView contentContainerStyle={styles.content}>
    {!signedIn?<><Text style={styles.text}>Sign in to see accessible groups and channels for this video. Signing in opens Global; tap Launch again afterward.</Text><Action label="Sign in" onPress={onSignIn}/></>:
      state.loading?<Message scrollable={false} title="Loading spaces" busy/>:<>
        {state.error && <Message scrollable={false} title={state.sourceUnavailable?'Video no longer available':'Cannot open space'} message={state.error} onRetry={()=>{void store.refresh();}}/>}
        {!state.error && !state.items.length && <Text style={styles.text}>No accessible spaces for this video.</Text>}
        {state.items.map(item=><Action key={item.space.id} label={`Open ${item.space.name} (${item.space.type})`} disabled={state.entering||state.loadingMore}
          onPress={()=>{void enter(item.space.id);}}/>)}
        {state.entering && <Message scrollable={false} title="Checking space access" busy/>}
        {state.nextCursor && <Action label={state.loadingMore?'Loading more spaces…':'Load more spaces'} disabled={state.loadingMore||state.entering} onPress={()=>{void store.more();}}/>}
      </>}
    <Action label="Close" onPress={onClose}/>
  </ScrollView></SafeAreaView>;
}
const styles=StyleSheet.create({screen:{flex:1,backgroundColor:'#000'},content:{padding:24,gap:16},text:{color:'#fff',fontSize:18,lineHeight:26}});
