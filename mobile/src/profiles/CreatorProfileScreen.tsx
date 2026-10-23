import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AppState, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CreatorStore } from './creatorStore';
import { useViewerClient } from '../feed/useViewerFeed';
import { Action, Message } from '../ui/Message';
import type { FeedContext } from '../feed/context';

export function CreatorProfileScreen({creatorId,returnName,onEnter,onAccount}:{creatorId:number;returnName:string;
  onEnter:(context:Extract<FeedContext,{kind:'space'}>)=>void;onAccount:()=>void}) {
  const {client,auth,generation}=useViewerClient();const focused=useIsFocused();
  const store=useMemo(()=>new CreatorStore(client,creatorId,()=>{void auth.invalidate(generation);}),[client,creatorId,generation]);
  const state=useSyncExternalStore(store.subscribe,store.getSnapshot);
  const [avatarFailed,setAvatarFailed]=useState(false);
  useEffect(()=>{setAvatarFailed(false);},[state.view?.creator.avatarUrl]);
  useEffect(()=>{
    if(!focused)return;
    void store.refresh();const sub=AppState.addEventListener('change',status=>{
      if(status==='active')void store.refresh();else store.cancel();
    });return()=>{sub.remove();store.cancel();};
  },[store,focused]);
  const enter=async()=>{const context=await store.enter();if(context && auth.getSnapshot().generation===generation)onEnter(context);};
  const view=state.view;
  return <SafeAreaView style={{flex:1}} edges={['bottom']}><ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.returnText}>Back returns to {returnName}</Text>
    {state.loading?<Message scrollable={false} title="Loading profile" busy/>:state.error?<Message scrollable={false} title={state.missing?'Profile unavailable':'Cannot load profile'} message={state.error} onRetry={()=>{void store.refresh();}}/>:view && <>
      {view.creator.avatarUrl && !avatarFailed?<Image accessibilityLabel="Creator avatar" source={{uri:view.creator.avatarUrl}} onError={()=>setAvatarFailed(true)} style={styles.avatar}/>
        :<View style={[styles.avatar,styles.placeholder]}><Text style={styles.initial}>{view.creator.displayName.slice(0,1).toUpperCase()}</Text></View>}
      <Text accessibilityRole="header" style={styles.name}>{view.creator.displayName}</Text>
      {view.creator.handle && <Text style={styles.body}>@{view.creator.handle}</Text>}
      {view.creator.bio && <Text style={styles.body}>{view.creator.bio}</Text>}
      <Text accessibilityRole="header" style={styles.section}>Personal space</Text>
      {state.entering?<Message scrollable={false} title="Checking personal-space access" busy/>:view.personalEntry.state==='allowed'?
        <Action label="View personal space" onPress={()=>{void enter();}}/>:view.personalEntry.state==='sign_in_required'?<>
          <Text style={styles.body}>Sign in to check personal-space access. Signing in opens Global.</Text><Action label="Sign in" onPress={onAccount}/>
        </>:<Text style={styles.body}>Personal space unavailable to you.</Text>}
    </>}
  </ScrollView></SafeAreaView>;
}
const styles=StyleSheet.create({content:{flexGrow:1,padding:24,gap:18,alignItems:'stretch'},actions:{flexDirection:'row',flexWrap:'wrap',gap:10},
  returnText:{color:'#c7c7ce',fontSize:15},avatar:{height:96,width:96,borderRadius:48},placeholder:{alignItems:'center',justifyContent:'center',backgroundColor:'#28282e'},
  initial:{color:'#fff',fontSize:40},name:{color:'#fff',fontSize:28,fontWeight:'700'},body:{color:'#e4e4e7',fontSize:17,lineHeight:25},section:{color:'#fff',fontSize:21,fontWeight:'600',marginTop:16}});
