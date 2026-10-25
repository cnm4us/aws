import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AppState, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { useAuth } from '../auth/useAuth';
import { useViewerClient } from '../feed/useViewerFeed';
import { Action, Message } from '../ui/Message';
import { IconButton } from '../ui/IconButton';
import { adaptLaunchCreator, type LaunchCreator, type LaunchResolved } from './launchApi';
import { LaunchStore } from './launchStore';
import type { LaunchPreparation } from './launchPreparation';
import type { NavigationTrace } from '../diagnostics/playbackDiagnostics';
import { playbackDiagnostics } from '../diagnostics/development';

function CreatorIntroduction({creator}:{creator:LaunchCreator}) {
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[creator.id,creator.avatarUrl]);
  return <View style={styles.creator}>
    {creator.avatarUrl&&!failed?<Image source={{uri:creator.avatarUrl}} accessibilityLabel={`${creator.displayName}'s avatar`}
      onError={()=>setFailed(true)} style={styles.avatar}/>:
      <View style={[styles.avatar,styles.placeholder]}><Text accessible={false} style={styles.initial}>{creator.displayName.slice(0,1).toUpperCase()}</Text></View>}
    <Text accessibilityRole="header" style={styles.name}>{creator.displayName}</Text>
    {!!creator.bio&&<Text style={styles.text}>{creator.bio}</Text>}
  </View>;
}
export function LaunchSpacesScreen({sourceId,productionUlid,creatorId,onEnter,onClose,onSignIn,onSourceUnavailable,preparation,trace,onEntryTrace}:{
  preparation?:LaunchPreparation;trace?:NavigationTrace;onEntryTrace?:(trace:NavigationTrace|undefined)=>void;
  sourceId:number;productionUlid:string|null;creatorId:number|null;onEnter:(entry:LaunchResolved)=>void;onClose:()=>void;onSignIn:()=>void;onSourceUnavailable:()=>void;
}) {
  const {snapshot}=useAuth(),{client,auth,generation}=useViewerClient(),focused=useIsFocused();
  const store=useMemo(()=>preparation?.get(sourceId,productionUlid,creatorId)??new LaunchStore(client,sourceId,productionUlid,()=>{void auth.invalidate(generation);},undefined,creatorId),[client,sourceId,productionUlid,creatorId,generation,preparation]);
  const state=useSyncExternalStore(store.subscribe,store.getSnapshot),signedIn=snapshot.status==='authenticated';
  const [appActive,setAppActive]=useState(AppState.currentState==='active');
  const [publicCreator,setPublicCreator]=useState<LaunchCreator|null>(null),[profileError,setProfileError]=useState(false),[revision,setRevision]=useState(0);
  useEffect(()=>{
    const sub=AppState.addEventListener('change',status=>setAppActive(status==='active'));
    return()=>sub.remove();
  },[]);
  useEffect(()=>{
    if(!focused||!signedIn||!appActive)return;
    void store.ensureFresh();return()=>store.cancel();
  },[store,focused,signedIn,appActive]);
  useEffect(()=>{if(state.sourceUnavailable)onSourceUnavailable();},[state.sourceUnavailable]);
  useEffect(()=>{if(focused&&!state.loading&&(state.creator||state.error)){trace?.mark('chooser_ready');trace?.finish(state.error?'failed':'ready');}},[focused,state.loading,state.creator,state.error,trace]);
  useEffect(()=>{
    if(!appActive)store.clear();
  },[appActive,store]);
  useEffect(()=>{
    setPublicCreator(null);setProfileError(false);
    if(!focused||signedIn||!appActive||snapshot.status!=='anonymous'||!creatorId)return;
    const request=new AbortController();
    void client.getJson(`/api/viewer/v1/creators/${creatorId}`,request.signal).then(value=>{
      const creator=adaptLaunchCreator((value as {creator:unknown}).creator,creatorId);
      if(!request.signal.aborted)setPublicCreator(creator);
    }).catch(()=>{if(!request.signal.aborted)setProfileError(true);});
    return()=>request.abort();
  },[client,creatorId,sourceId,focused,signedIn,appActive,snapshot.status,revision]);
  const enter=async(id:number)=>{
    const timing=playbackDiagnostics?.navigationStart('space');onEntryTrace?.(timing);
    const result=await store.enter(id);
    if(result)timing?.mark('destination_resolved');else timing?.finish('failed');
    if(result&&auth.getSnapshot().generation===generation&&AppState.currentState==='active')onEnter(result);
  };
  const masked=!focused||!appActive||state.sourceUnavailable||snapshot.status==='unavailable';
  const creator=signedIn?state.creator:publicCreator;
  return <SafeAreaView accessibilityViewIsModal style={[styles.screen,masked?styles.opaque:styles.scrim]} edges={['top','bottom']}>
    <View style={styles.header}><View style={styles.closeRow}><IconButton icon="close" label="Close spaces" onPress={onClose}/></View>
      <Text accessibilityRole="header" style={styles.title}>Open in a space</Text>
    </View>
    <ScrollView contentContainerStyle={styles.content}>
      {masked?<Message scrollable={false} title={state.sourceUnavailable?'Video no longer available':snapshot.status==='unavailable'?'Cannot verify sign-in':'Checking access'}
        message={state.error??undefined} onRetry={appActive&&focused?()=>{if(snapshot.status==='unavailable')void auth.retryValidation();else void store.refresh();}:undefined}/>:
        <>
          {creator&&<CreatorIntroduction creator={creator}/>}
          {!signedIn?<>
            {profileError&&<Message scrollable={false} title="Cannot load creator" onRetry={()=>setRevision(n=>n+1)}/>}
            <Text style={styles.text}>Sign in to see accessible groups and channels for this video. Signing in opens Global; tap Launch again afterward.</Text>
            <Action label="Sign in" onPress={onSignIn}/>
          </>:state.loading?<Message scrollable={false} title="Loading spaces" busy/>:<>
            {state.error&&<Message scrollable={false} title="Cannot open space" message={state.error} onRetry={()=>{void store.refresh();}}/>}
            {!state.error&&!state.items.length&&<Text style={styles.text}>No accessible spaces for this video.</Text>}
            {state.items.map(item=><View key={item.space.id} style={styles.destination}>
              <Text accessibilityRole="header" style={styles.spaceName}>{item.space.name}</Text>
              <Text style={styles.type}>{item.space.type==='group'?'Group':'Channel'}</Text>
              {!!item.space.description&&<Text style={styles.text}>{item.space.description}</Text>}
              <Action label={`Open ${item.space.name} (${item.space.type})`} disabled={state.entering||state.loadingMore}
                onPress={()=>{void enter(item.space.id);}}/>
            </View>)}
            {state.entering&&<Message scrollable={false} title="Checking space access" busy/>}
            {state.nextCursor&&<Action label={state.loadingMore?'Loading more spaces…':'Load more spaces'} disabled={state.loadingMore||state.entering} onPress={()=>{void store.more();}}/>}
          </>}
        </>}
    </ScrollView>
  </SafeAreaView>;
}
const styles=StyleSheet.create({
  screen:{flex:1},scrim:{backgroundColor:'rgba(0,0,0,0.8)'},opaque:{backgroundColor:'#000'},
  header:{paddingHorizontal:16,paddingTop:8,paddingBottom:12,gap:8},closeRow:{alignItems:'flex-end'},
  title:{color:'#fff',fontSize:24,fontWeight:'600'},content:{paddingHorizontal:24,paddingBottom:24,gap:20},
  creator:{gap:10},avatar:{width:72,height:72,borderRadius:36},placeholder:{backgroundColor:'#28282e',alignItems:'center',justifyContent:'center'},
  initial:{color:'#fff',fontSize:30},name:{color:'#fff',fontSize:26,fontWeight:'700'},
  destination:{gap:8,paddingVertical:16,borderTopWidth:1,borderColor:'#62626b'},spaceName:{color:'#fff',fontSize:21,fontWeight:'600'},
  type:{color:'#c7c7ce',fontSize:15},text:{color:'#e4e4e7',fontSize:17,lineHeight:25},
});
