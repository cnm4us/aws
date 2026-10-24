import { useEffect,useMemo,useRef,useSyncExternalStore } from 'react';
import { Image,Pressable,StyleSheet,Text } from 'react-native';
import type { ApiClient } from '../api/client';
import { EngagementStore } from './engagementStore';
const heart=require('../../assets/icons/heart.png'),filled=require('../../assets/icons/heart-filled.png'),comment=require('../../assets/icons/comment.png');
const compact=(value:number)=>value<1000?String(value):value<1_000_000?`${Number((value/1000).toFixed(1))}k`:`${Number((value/1_000_000).toFixed(1))}m`;
export function EngagementControls({client,spaceId,publicationId,eligible,onDenied,onComments}:{
 client:ApiClient;spaceId:number;publicationId:number;eligible:boolean;onDenied:(error:Error)=>void;onComments:()=>void;
}) {
 const denied=useRef(onDenied);denied.current=onDenied;
 const store=useMemo(()=>new EngagementStore(client,{spaceId,publicationId},e=>denied.current(e)),[client,spaceId,publicationId]);
 const state=useSyncExternalStore(store.subscribe,store.getSnapshot);
 useEffect(()=>{store.setActive(eligible);return()=>store.setActive(false);},[store,eligible]);
 useEffect(()=>()=>store.dispose(),[store]);
 const liked=state.value?.likes.likedByMe??false;
 return <>
  <Pressable accessibilityRole="button" accessibilityLabel={state.error?`${state.error} Retry likes and comments`:state.busy?'Updating Like':`${liked?'Unlike':'Like'}${state.value?`, ${state.value.likes.count} likes`:''}`}
   accessibilityState={{selected:liked,disabled:!eligible||state.loading||state.busy||!state.value&&!state.error,busy:state.busy||state.loading}}
   disabled={!eligible||state.loading||state.busy||!state.value&&!state.error} onPress={()=>{void(state.error?store.refresh():store.toggle());}} style={styles.action}>
   <Image accessible={false} source={liked?filled:heart} style={[styles.icon,{opacity:liked?1:.5}]}/>
   <Text style={styles.count} numberOfLines={1}>{state.error?'Retry':state.busy?'…':state.value?compact(state.value.likes.count):'—'}</Text>
  </Pressable>
  <Pressable accessibilityRole="button" accessibilityLabel={`Comments${state.value?`, ${state.value.comments.count} total comments`:''}`}
   accessibilityState={{disabled:!eligible}} disabled={!eligible} onPress={onComments} style={styles.action}>
   <Image accessible={false} source={comment} style={[styles.icon,{opacity:state.value?.comments.hasCommentedByMe?1:.5}]}/>
   <Text style={styles.count} numberOfLines={1}>{state.value?compact(state.value.comments.count):'—'}</Text>
  </Pressable>
 </>;
}
const styles=StyleSheet.create({action:{minWidth:44,minHeight:64,alignItems:'center',justifyContent:'center',gap:3,borderRadius:12,backgroundColor:'rgba(24,24,28,0.25)'},icon:{width:24,height:24},count:{fontSize:12,color:'#fff',maxWidth:44}});
