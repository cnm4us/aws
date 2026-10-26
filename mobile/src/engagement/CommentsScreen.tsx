import { useEffect,useMemo,useRef,useSyncExternalStore } from 'react';
import { AppState,FlatList,Keyboard,KeyboardAvoidingView,Platform,StyleSheet,Text,TextInput,View,useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { useAuth } from '../auth/useAuth';
import { useViewerClient } from '../feed/useViewerFeed';
import { ApiError } from '../api/client';
import { Action,Message } from '../ui/Message';
import { IconButton } from '../ui/IconButton';
import { CommentsStore } from './commentsStore';
import { CommentOrderSelector } from './CommentOrderSelector';
import type { Comment } from './api';
export function CommentsScreen({spaceId,publicationId,generation:visitGeneration,onClose,onDenied}:{
 spaceId:number;publicationId:number;generation:number;onClose:()=>void;onDenied:(error:Error)=>void;
}) {
 const {snapshot}=useAuth(),{auth,client,generation}=useViewerClient(),focused=useIsFocused();
 const {width,fontScale}=useWindowDimensions();
 const denied=useRef(onDenied);denied.current=onDenied;
 const store=useMemo(()=>new CommentsStore(client,{spaceId,publicationId},async signal=>{
  if(signal.aborted||auth.getSnapshot().generation!==generation)throw new Error('Cancelled');
 },error=>{if(auth.getSnapshot().generation===generation){if(error instanceof ApiError&&error.status===401)void auth.invalidate(generation);else denied.current(error);}}),[auth,client,spaceId,publicationId,generation]);
 const state=useSyncExternalStore(store.subscribe,store.getSnapshot);
 useEffect(()=>{
  const update=()=>{
   const active=focused&&visitGeneration===generation&&AppState.currentState==='active'&&auth.getSnapshot().status==='authenticated';
   store.setActive(active);
  };
  update();const sub=AppState.addEventListener('change',update),unsubscribe=auth.subscribe(update);
  return()=>{sub.remove();unsubscribe();store.setActive(false);};
 },[auth,store,focused,visitGeneration,generation]);
 useEffect(()=>()=>store.dispose(),[store]);
 const close=()=>{Keyboard.dismiss();onClose();};
 const retry=()=>{if(snapshot.status==='unavailable')void auth.retryValidation();else store.retry();};
 const renderComment=({item}:{item:Comment})=><View style={styles.comment}><Text style={styles.author}>{item.author.displayName}{item.isMine?' (you)':''}</Text><Text selectable style={styles.text}>{item.body}</Text><Text style={styles.meta}>{new Date(item.createdAt.replace(' ','T')+(/(?:Z|[+-]\d\d:\d\d)$/.test(item.createdAt)?'':'Z')).toLocaleString()}</Text></View>;
 const blocked=!state.authorized||visitGeneration!==generation||snapshot.status!=='authenticated'||!focused||AppState.currentState!=='active';
 return <SafeAreaView accessibilityViewIsModal style={[styles.screen,blocked?styles.blocked:styles.scrim]} edges={['top','bottom']}>
  <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS==='ios'?'padding':undefined}>
   <View style={styles.header}>
    <View style={styles.closeRow}><IconButton icon="close" label="Close comments" onPress={close}/></View>
    {!blocked&&<CommentOrderSelector count={state.summary?.count??null} order={state.order} disabled={state.sending} onSelect={store.sort}/>}
   </View>
   {blocked?<Message title={state.checking?'Checking access':snapshot.status==='unavailable'?'Cannot verify sign-in':'Comments unavailable'} message={state.error??undefined} busy={state.checking} onRetry={state.checking?undefined:retry}/>:
    <>
     <FlatList data={state.items.filter(c=>c.id!==state.posted?.id)} keyExtractor={item=>String(item.id)} renderItem={renderComment} keyboardShouldPersistTaps="handled" style={{flex:1}}
      ListHeaderComponent={<View>
       {state.posted&&<View><Text style={[styles.meta,{paddingHorizontal:16}]}>Your new comment</Text>{renderComment({item:state.posted})}</View>}
      </View>}
      ListEmptyComponent={!state.loading&&!state.posted?<Text style={[styles.text,{padding:20}]}>No top-level comments yet.</Text>:null}
      ListFooterComponent={<View style={styles.footer}>
       {state.loading&&<Text style={styles.meta}>Loading comments…</Text>}
       {state.error&&<Text accessibilityRole="alert" style={styles.error}>{state.error}</Text>}
       <Action label={state.loading?'Loading comments…':'Refresh comments'} disabled={state.loading||state.sending} onPress={()=>{void store.reload();}}/>
       {state.nextCursor&&state.items.length<200?<Action label="Load more comments" disabled={state.loading||state.sending} onPress={()=>{void store.more();}}/>:
        state.items.length>=200?<Text style={styles.meta}>Showing up to 200 comments. Refresh for the latest.</Text>:null}
      </View>}/>
     <View style={styles.composer}>
      {state.uncertain&&<Text accessibilityRole="alert" style={styles.error}>Your comment may have posted. Refresh and check the list before sending it again.</Text>}
      {!state.summary?.canComment?<Text style={styles.meta}>{state.summary?.disabledReason==='comments_disabled'?'New comments are disabled for this video.':'You cannot currently post comments in this space.'}</Text>:<>
       <TextInput accessibilityLabel="Write a comment" value={state.draft} onChangeText={store.setDraft} maxLength={2000} multiline scrollEnabled style={styles.input} editable={!state.sending} placeholder="Write a comment…" placeholderTextColor="#999"/>
       <View style={[styles.sendRow,(fontScale>1.2||width<350)&&styles.stacked]}><Text style={styles.meta}>{state.draft.length}/2000</Text><Action label={state.sending?'Sending…':state.uncertain?'Send again':'Send comment'} disabled={state.sending||state.loading||!state.draft.trim()||state.uncertain&&!state.reconciled} onPress={()=>{void store.send();}}/></View>
      </>}
     </View>
    </>}
  </KeyboardAvoidingView>
 </SafeAreaView>;
}
const styles=StyleSheet.create({screen:{flex:1},blocked:{backgroundColor:'#000'},scrim:{backgroundColor:'rgba(0,0,0,0.8)'},header:{paddingHorizontal:16,paddingTop:8,paddingBottom:12,gap:8},closeRow:{alignItems:'flex-end'},sendRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},stacked:{flexDirection:'column',alignItems:'stretch'},meta:{color:'#bfc0c8',fontSize:13,flexShrink:1},comment:{padding:16,gap:6,borderBottomWidth:1,borderColor:'#555'},author:{color:'#fff',fontSize:16,fontWeight:'700'},text:{color:'#fff',fontSize:17,lineHeight:25},footer:{padding:16,gap:12},error:{color:'#ffb4b4',fontSize:15},composer:{padding:12,gap:10,borderTopWidth:1,borderColor:'#555',backgroundColor:'rgba(0,0,0,0.94)'},input:{color:'#fff',backgroundColor:'#17171c',fontSize:17,minHeight:48,maxHeight:120,borderWidth:1,borderColor:'#777',borderRadius:12,padding:12}});
