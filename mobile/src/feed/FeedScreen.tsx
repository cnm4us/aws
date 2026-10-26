import { itemKey } from '../auth/accessProof';
import { RecoveryCoordinator } from './recoveryCoordinator';
import { useCallback,useEffect, useLayoutEffect, useMemo, useRef, useState,useSyncExternalStore } from 'react';
import { AppState,FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Action, Message } from '../ui/Message';
import { FeedCard } from './FeedCard';
import { useViewerFeed } from './useViewerFeed';
import type { FeedContext } from './context';
import { contextKey } from './context';
import { useAuth } from '../auth/useAuth';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {FEED_NAVIGATION_HEIGHT,feedGeometry} from './feedGeometry';
import {useVideoSize} from '../playback/useVideoSize';
import { useSpaceAccess,usePublicationAccess } from '../auth/useSpaceAccess';
import type { FeedSnapshot, FeedStore } from './feedStore';
import type { FeedVideoItem } from './types';
import { useFeedPlayback, type NativePlayerPort } from '../playback/useFeedPlayback';
import type { PlayerHandoff } from '../playback/playerHandoff';
import type { NavigationTrace } from '../diagnostics/playbackDiagnostics';
import { FeedLoadingSplash } from '../ui/FeedLoadingSplash';
import { FeedEntryReadiness } from '../playback/feedEntryReadiness';
import { VideoSurface } from '../playback/VideoSurface';
import { PagingController } from '../playback/paging';
import { FeedHeader } from '../ui/FeedHeader';
import { CreatorButton } from '../ui/CreatorButton';
import { IconButton, CONTROL_LANE } from '../ui/IconButton';
import type { PlaybackPreferences, PlaybackPreferencesSnapshot } from '../preferences/playbackPreferences';
import type { FeedCheckpoint, PlaybackCheckpoint } from '../navigation/viewerJourney';
import { TextResources } from '../content/resources';
import { CaptionLayer } from '../content/CaptionLayer';
import type { CaptionPreferences } from '../preferences/captionPreferences';
import type { LaunchEntry } from '../navigation/globalLaunchJourney';
import { ApiError, type ApiClient } from '../api/client';
import { EngagementControls } from '../engagement/EngagementControls';
import { FeedFollow } from '../follows/FeedFollow';
import { GlobalCreatorRecognition } from '../follows/GlobalCreatorRecognition';

export type FeedCommands={revalidate?:(id:number|undefined)=>void;requestRefresh:()=>void;denyAccess?:(error:ApiError)=>void};
export type FeedPlaybackHandle={checkpoint?:()=> (PlaybackCheckpoint&{uploadId:number|null;productionUlid:string|null;creatorId:number|null})|undefined;entryFailed?:()=>boolean;retainOrigin?:()=>void;retryFailed?:()=>boolean;selectedId?:()=>number|null;capture:()=>PlaybackCheckpoint;release:()=>void;handOff:()=>PlayerHandoff<NativePlayerPort>|undefined};


export function FeedScreen({ context, preferences, sound, captionPreferences, captions, focused, onSpaces, onMenu, onGlobal, onCreator, registerPlayback, registerCommands, restore, entry, onBackProfile, onLaunch, onRetryEntry, onChooseLaunch, onComments, onPrepareLaunch, handoff, trace, blocked=false,onForgetCheckpoint }: {
  onForgetCheckpoint?:()=>void;
  onPrepareLaunch?:(item:FeedVideoItem)=>void;handoff?:PlayerHandoff<NativePlayerPort>;trace?:NavigationTrace;
  captionPreferences: CaptionPreferences; captions: ReturnType<CaptionPreferences['getSnapshot']>;
  context: FeedContext; preferences: PlaybackPreferences; sound: PlaybackPreferencesSnapshot; focused: boolean;
  onSpaces:()=>void;onMenu:()=>void;onGlobal:()=>void;
  registerCommands?:(handle:FeedCommands)=>()=>void;
  onCreator?:(id:number)=>void;registerPlayback?:(handle:FeedPlaybackHandle)=>()=>void;
  restore?:FeedCheckpoint;entry?:LaunchEntry;onBackProfile?:()=>void;onLaunch?:(item:FeedVideoItem)=>void;
  onRetryEntry?:()=>Promise<void>;onChooseLaunch?:()=>void;onComments?:(publicationId:number)=>void;blocked?:boolean;
}) {
  const { store:identity, snapshot:auth,baseUrl }=useAuth();
  const insets=useSafeAreaInsets();
  const [headerHeight,setHeaderHeight]=useState(insets.top+76);
  const { store, snapshot, client,clearResume,setResumeAnchor,entryPending,initialAccess,revalidateAt,markEntryPresented } = useViewerFeed(context,restore,entry,trace);
  const access=useSpaceAccess(context,client,store,focused,initialAccess);
  useEffect(()=>{if(snapshot.resume?.outcome==='unavailable')onForgetCheckpoint?.();},[snapshot.resume]);
  // Verified spaces stay eligible during bounded routine renewal. Entry/return,
  // failure and expiry still withhold authority through the access guard.
  const eligible=!blocked && focused && !snapshot.errorStatus && access.authorized
    && (context.kind==='global' || auth.status==='authenticated' || auth.status==='unavailable'&&access.authorized);
  const [retrying,setRetrying]=useState(false),[retryError,setRetryError]=useState<string|null>(null);
  const retryEntry=async()=>{if(retrying||!onRetryEntry)return;setRetrying(true);setRetryError(null);try{await onRetryEntry();}catch(e){setRetryError(e instanceof Error?e.message:"Cannot open space. Try again.");}finally{setRetrying(false);}};
  const media=useRef<FeedPlaybackHandle|null>(null),failedCheckpoint=useRef<PlaybackCheckpoint|null>(null);
  const [recoveryRestore,setRecoveryRestore]=useState<FeedCheckpoint|undefined>(undefined);
  const recovery=useMemo(()=>new RecoveryCoordinator(event=>identity.recordDiagnostic(event)),[store,identity,auth.generation]);
  const registerMedia=useCallback((handle:FeedPlaybackHandle)=>{media.current=handle;const unregister=registerPlayback?.(handle);
    return()=>{if(media.current===handle)media.current=null;unregister?.();};},[registerPlayback]);
  const seenRecovery=useRef(auth.recoveryRevision??0),pendingRecovery=useRef(false);
  // Bound to this feed/auth generation. Unmount and context replacement invalidate commands.
  const pendingRefresh = useRef(false);
  const live = useRef({ mounted: false, focused });
  live.current.focused = focused;
  const refresh = (fromStart=false) => {
    const generation=auth.generation;
    if(fromStart){clearResume();onForgetCheckpoint?.();}
    if(live.current.mounted && live.current.focused && identity.getSnapshot().generation===generation)void store.refresh();
  };
  const recover=()=>recovery.run(async()=>{
    if(!live.current.mounted||!live.current.focused||AppState.currentState!=='active'||identity.getSnapshot().generation!==auth.generation)return false;
    const state=store.getSnapshot();
    if(state.initialError||!state.items.length||media.current?.entryFailed?.()){
      const saved=failedCheckpoint.current??media.current?.capture();
      if(saved?.publicationId){setRecoveryRestore({...saved,context,apiOrigin:baseUrl,authGeneration:auth.generation,journeyGeneration:0});setResumeAnchor?.(saved.publicationId);}
      await store.refresh();if(store.getSnapshot().initialError)return false;
    }
    if(context.kind==='space'){
      const current=store.getSnapshot(),selected=current.items.find(i=>i.publicationId===(media.current?.selectedId?.()??failedCheckpoint.current?.publicationId))??current.items[0];
      if(selected&&!identity.access.canView(selected)&&!await identity.access.check(context.spaceId))return false;
    }
    return live.current.focused&&AppState.currentState==='active'&&identity.getSnapshot().generation===auth.generation;
  },()=>{media.current?.retryFailed?.();});
  useEffect(()=>{
    if((auth.recoveryRevision??0)!==seenRecovery.current){seenRecovery.current=auth.recoveryRevision??0;pendingRecovery.current=true;}
    if(focused&&pendingRecovery.current){pendingRecovery.current=false;void recover();}
    if(!focused)recovery.cancel();
  },[auth.recoveryRevision,focused,recovery]);
  useEffect(()=>{const sub=AppState.addEventListener('change',state=>{if(state!=='active')recovery.cancel();});return()=>{sub.remove();recovery.cancel();};},[recovery]);
  useLayoutEffect(()=>{
    live.current.mounted=true;
    const unsubscribe=store.subscribe(()=>{if(store.getSnapshot().initialError&&media.current&&!failedCheckpoint.current)failedCheckpoint.current=media.current.capture();});
    const unregister=registerCommands?.({revalidate:revalidateAt,requestRefresh:()=>{
      if(live.current.mounted && identity.getSnapshot().generation===auth.generation)pendingRefresh.current=true;
    },denyAccess:error=>{if(live.current.mounted && identity.getSnapshot().generation===auth.generation)store.denyAccess(error);}});
    return()=>{live.current.mounted=false;pendingRefresh.current=false;unsubscribe();unregister?.();};
  },[store,identity,auth.generation,registerCommands]);
  useEffect(()=>{
    if(focused && pendingRefresh.current){pendingRefresh.current=false;refresh(true);}
  },[focused,store]);
  return <View style={styles.screen}>
    <View style={{flex:1}}>
      {blocked ? <View style={{flex:1,paddingTop:headerHeight}}><Message title="Video no longer available"/></View> : snapshot.initialLoading ? <View style={{flex:1,paddingTop:headerHeight}}><FeedLoadingSplash feedName={context.kind==='global'?'Global':context.name}/></View> : snapshot.initialError ?
        <View style={{flex:1,paddingTop:headerHeight}}><Message title={['launch_target_unavailable','publication_not_found'].includes(snapshot.errorCode??'')?'Video unavailable in this space':snapshot.errorStatus===403 || snapshot.errorStatus===404?'Access unavailable':'Cannot load the feed'}
          message={retryError??snapshot.initialError} busy={retrying} busyLabel="Retrying feed" onRetry={retrying?undefined:entryPending && onRetryEntry?()=>{void retryEntry();}:()=>{void recover();}}/>
          {entryPending && onChooseLaunch && <Action label="Choose another space" onPress={onChooseLaunch}/>}
          <View style={styles.headerActions}><Action label="Spaces" onPress={onSpaces}/><Action label="Global" onPress={onGlobal}/></View>
        </View> : <FeedSession key={snapshot.sessionId} store={store} snapshot={snapshot} muted={sound.muted}
          onToggleMute={()=>{if(live.current.mounted&&live.current.focused)preferences.toggleMute();}} visible={focused} eligible={!!eligible} diagnosticContext={{feedContext:contextKey(context),authGeneration:auth.generation}}
          headerHeight={headerHeight} onEntryPresented={markEntryPresented} restore={recoveryRestore??restore} entry={recoveryRestore?undefined:entry} handoff={handoff} trace={trace} onPrepareLaunch={onPrepareLaunch} onCreator={onCreator} onLaunch={onLaunch} onComments={onComments} onRecover={()=>{void recover();}} registerPlayback={registerMedia} client={client} context={context} captionPreferences={captionPreferences} captions={captions}/>}
      {((context.kind==='space'&&auth.status==='unavailable'&&!access.authorized) || (context.kind==='space' && access.checking && !access.authorized)) &&
        <View style={[StyleSheet.absoluteFill,{backgroundColor:'#000',padding:20,paddingTop:headerHeight+12,gap:12}]}>
          <Message title={auth.status==='unavailable'?'Cannot verify access':'Checking access'} busy={auth.status!=='unavailable'}
            message={auth.status==='unavailable'?auth.message??undefined:undefined}
            onRetry={()=>{void recover();}}/>
          {auth.status==='unavailable' && <Action label="Browse Global" onPress={onGlobal}/>}
        </View>}
      {access.error && !access.checking && !snapshot.errorStatus && auth.status!=='unavailable' &&
        <View style={[StyleSheet.absoluteFill,{backgroundColor:'#000',padding:20,paddingTop:headerHeight+12,gap:12}]}>
          <Message title="Cannot verify access" message={access.error} onRetry={()=>{void recover();}}/>
          <Action label="Global" onPress={onGlobal}/><Action label="Spaces" onPress={onSpaces}/>
        </View>}
    </View>
    <View testID="feed-navigation-reserve" style={{height:FEED_NAVIGATION_HEIGHT+insets.bottom,backgroundColor:'#000'}} accessible={false}/>
    <View testID="feed-floating-header" style={[styles.toolbar,{paddingTop:insets.top+8,paddingLeft:Math.max(16,insets.left),paddingRight:Math.max(16,insets.right)}]} onLayout={event=>setHeaderHeight(event.nativeEvent.layout.height)}>
      <FeedHeader context={context} onSpaces={onSpaces} onMenu={onMenu} onBackProfile={onBackProfile}/>
      {auth.status==='anonymous' && auth.message && <Text accessibilityRole="alert" style={{color:'#ffb4b4',fontSize:15}}>{auth.message}</Text>}
      {snapshot.resume?.outcome==='unavailable' && <Text style={{color:'#c7c7ce'}}>The original video is no longer available. Showing the current feed.</Text>}
    </View>
  </View>;
}

function FeedSession({ store, snapshot, muted, onToggleMute, eligible, diagnosticContext, restore, entry, onCreator, onLaunch, onComments, registerPlayback, client, context, captionPreferences, captions, onPrepareLaunch, handoff, trace,visible,onRecover,onEntryPresented,headerHeight }: {
  headerHeight:number;
  onEntryPresented?:()=>void;
  onRecover:()=>void;onPrepareLaunch?:(item:FeedVideoItem)=>void;handoff?:PlayerHandoff<NativePlayerPort>;trace?:NavigationTrace;
  store: FeedStore; snapshot: FeedSnapshot;visible:boolean; muted: boolean; onToggleMute: () => void; eligible: boolean;
  diagnosticContext:{feedContext:string;authGeneration:number};
  restore?:FeedCheckpoint;entry?:LaunchEntry;onLaunch?:(item:FeedVideoItem)=>void;onComments?:(publicationId:number)=>void;onCreator?:(id:number)=>void;registerPlayback?:(handle:FeedPlaybackHandle)=>()=>void;
  client: ApiClient; context: FeedContext; captionPreferences: CaptionPreferences; captions: ReturnType<CaptionPreferences['getSnapshot']>;
}) {
  const {snapshot:followAuth,store:sessionAuth}=useAuth();
  const [layout,setLayout]=useState({width:0,height:0});const {width,height}=layout;
  const [selection,setSelection]=useState(()=>{const index=Math.max(0,snapshot.items.findIndex(item=>item.publicationId===snapshot.resume?.restoredPublicationId));return {index,id:snapshot.items[index]?.publicationId??null};});
  const retainedIndex=snapshot.items.findIndex(item=>item.publicationId===selection.id);
  const index=retainedIndex>=0?retainedIndex:selection.index;
  const priorItems=useRef(snapshot.items),priorIndex=useRef(index);
  const list = useRef<FlatList<FeedVideoItem>>(null);
  const items = useRef(snapshot.items);
  items.current = snapshot.items;
  const publicationAuthorized=usePublicationAccess(context,client,store,visible,[snapshot.items[index],snapshot.items[index+1],snapshot.items[index-1]].filter((i):i is FeedVideoItem=>!!i));
  const { coordinator, snapshot: playback } = useFeedPlayback(muted, eligible&&publicationAuthorized, diagnosticContext,handoff,trace);
  const resources = useMemo(() => new TextResources(client, context, error => store.denyAccess(error)), [client, contextKey(context), store]);
  const selectedItem=snapshot.items[index];
  const sourceKey=selectedItem?itemKey(selectedItem):'empty';
  const videoSize=useVideoSize(playback.player,sourceKey,selectedItem?.width&&selectedItem.height?{width:selectedItem.width,height:selectedItem.height}:null,playback.hasFrame,playback.status);
  const geometry=feedGeometry(width,height,videoSize);
  const initialCheckpoint=useRef(entry&&snapshot.resume?.restoredPublicationId===entry.publicationId?entry:
    restore&&snapshot.resume?.restoredPublicationId===selectedItem?.publicationId?restore:{positionSeconds:0,userPaused:false});
  const liveEntry=useRef({item:selectedItem,enabled:false});
  liveEntry.current={item:selectedItem,enabled:visible&&eligible&&publicationAuthorized&&playback.appActive};
  const entryValid=()=>{const live=liveEntry.current,item=live.item;
    return live.enabled&&AppState.currentState==='active'&&sessionAuth.getSnapshot().generation===diagnosticContext.authGeneration&&
      (!item||!sessionAuth.access||(context.kind==='global'?sessionAuth.access.publicValid(item):sessionAuth.access.canView(item)));
  };
  const entryGate=useMemo(()=>new FeedEntryReadiness<NativePlayerPort>({valid:entryValid,active:()=>AppState.currentState==='active'&&liveEntry.current.enabled,
    prepare:(player,attempt,seconds)=>player.prepareEntry?player.prepareEntry(attempt,seconds):Promise.reject(Error('Native readiness unavailable')),
    cancel:attempt=>playbackRef.current?.cancelEntry?.(attempt)}),[coordinator]);
  const playbackRef=useRef<NativePlayerPort|null>(null);playbackRef.current=playback.player;
  const entryState=useSyncExternalStore(entryGate.subscribe,entryGate.getSnapshot);
  const covered=entryState.phase!=='ready'&&entryState.phase!=='presented';
  const canInteract=useRef(false);canInteract.current=visible&&eligible&&!covered&&playback.entryPresented;
  useLayoutEffect(()=>{
    entryGate.update({key:`${playback.activation}:${selectedItem?itemKey(selectedItem):'empty'}`,player:playback.player,
      seconds:initialCheckpoint.current.positionSeconds,duration:playback.player?.durationSeconds?.()??0,
      sourceReady:playback.status==='readyToPlay'&&playback.sourceLoaded&&!playback.restoring&&!!videoSize,
      hasFrame:playback.hasFrame,failed:playback.failed,error:playback.restoreError,empty:!selectedItem?.playbackUrl,enabled:liveEntry.current.enabled});
  },[entryGate,playback,selectedItem,visible,eligible,publicationAuthorized,videoSize?.width,videoSize?.height]);
  useLayoutEffect(()=>{if(entryState.phase==='ready'&&entryGate.present()){onEntryPresented?.();coordinator.presentEntry();}},[entryGate,entryState.phase,coordinator,onEntryPresented]);
  useEffect(()=>{if(entryState.phase==='failed')coordinator.failEntry();},[entryState.phase,coordinator]);
  useEffect(()=>()=>entryGate.dispose(),[entryGate]);
  const textEligible = eligible && publicationAuthorized && playback.entryPresented && playback.appActive && playback.screenEligible && !playback.scrolling;
  const [storyExpanded, setStoryExpanded] = useState(false);
  const [textHeight, setTextHeight] = useState(0);
  useLayoutEffect(() => { if (!textEligible) { resources.clear(); setStoryExpanded(false); } }, [resources, textEligible]);
  useEffect(() => resources.clear, [resources]);
  const canLoad=(item:FeedVideoItem)=>context.kind!=='space'||!sessionAuth?.access||sessionAuth.access.canView(item);
  const lastSelectedItem=useRef<FeedVideoItem|undefined>(undefined);
  const initialSelection=useRef(false);
  useLayoutEffect(()=>registerPlayback?.({capture:()=>{const saved=coordinator.capture();return entryGate.getSnapshot().phase==='presented'?saved:{...saved,...initialCheckpoint.current};},
    checkpoint:()=>{const item=items.current[index];if(!item||entryGate.getSnapshot().phase!=='presented'||coordinator.getSnapshot().failed||coordinator.getSnapshot().restoreError
      ||(sessionAuth.access&&(context.kind==='global'?!sessionAuth.access.publicValid(item):!sessionAuth.access.canView(item))))return;
      return {...coordinator.capture(),uploadId:item.uploadId,productionUlid:item.productionUlid,creatorId:item.creator.id};},
    release:()=>{entryGate.dispose();coordinator.dispose();},handOff:coordinator.handOff,entryFailed:()=>entryGate.getSnapshot().phase==='failed',
    retryFailed:()=>coordinator.recoverFailed(canLoad),selectedId:()=>coordinator.getSnapshot().publicationId,
    retainOrigin:()=>{if(context.kind==='global')sessionAuth?.globalFeed.save(snapshot.items,index,snapshot.nextCursor,sessionAuth.access);}}),[coordinator,entryGate,registerPlayback,index,snapshot.items,snapshot.nextCursor]);
  const paging = useMemo(() => new PagingController(
    () => {if(canInteract.current)coordinator.setScrolling(true);},
    selected => {
      if(!canInteract.current)return;
      // Replace selection while still paused; never briefly resume the previous video.
      const next=items.current[selected];
      if(context.kind==='space'&&next&&sessionAuth?.access&&!sessionAuth.access.canView(next))coordinator.setScreenEligible(false);
      if(!next||canLoad(next))coordinator.selectAt(items.current, selected,canLoad);
      setSelection({index:selected,id:items.current[selected]?.publicationId??null});
      coordinator.setScrolling(false);
    },
  ), [coordinator]);
  useLayoutEffect(()=>{if(!visible){paging.suspend();coordinator.setScrolling(false);}},[visible,paging,coordinator]);
  useLayoutEffect(()=>{if(priorItems.current!==snapshot.items&&priorIndex.current!==index&&height>0){
    paging.beginProgrammatic();list.current?.scrollToOffset({offset:index*height,animated:false});paging.scroll(index*height);
  }priorItems.current=snapshot.items;priorIndex.current=index;},[snapshot.items,index,height,paging]);
  // The footer is a real page: selecting it clears media/audio ownership.
  paging.configure(height, snapshot.items.length);
  useEffect(() => () => paging.dispose(), [paging]);
  useEffect(() => { if(visible)store.ensureAhead(index); }, [store, index, snapshot,visible]);
  useEffect(() => {
    if(snapshot.items[index]&&!canLoad(snapshot.items[index])){coordinator.setScreenEligible(false);return;}
    const item=snapshot.items[index],previous=lastSelectedItem.current;lastSelectedItem.current=item;
    if(item&&previous&&item.publicationId===previous.publicationId&&itemKey(item)!==itemKey(previous)){
      const saved=coordinator.capture();coordinator.restoreAt(snapshot.items,index,{...saved,
        positionSeconds:item.productionUlid===previous.productionUlid&&item.creator.id===previous.creator.id?saved.positionSeconds:0},canLoad);
      coordinator.setScreenEligible(eligible&&publicationAuthorized);return;
    }
    if(!initialSelection.current) {
      initialSelection.current=true;
      if(entry && snapshot.resume?.restoredPublicationId===entry.publicationId){coordinator.restoreAt(snapshot.items,index,entry,canLoad);return;}
      if(restore && snapshot.resume?.restoredPublicationId===snapshot.items[index]?.publicationId) {
        coordinator.restoreAt(snapshot.items,index,restore,canLoad);return;
      }
    }
    coordinator.selectAt(snapshot.items, index,canLoad);
  }, [coordinator, snapshot.items, index,publicationAuthorized]);
  const previousHeight = useRef(height);
  useEffect(() => {
    if (previousHeight.current > 0 && previousHeight.current !== height) {
      paging.beginProgrammatic();
      list.current?.scrollToOffset({ offset: index * height, animated: false });
      paging.scroll(index * height);
    }
    previousHeight.current = height;
  }, [height, index, paging]);
  const next = () => {
    if(!canInteract.current)return;
    paging.beginProgrammatic();
    list.current?.scrollToOffset({ offset: Math.min(index + 1, snapshot.items.length) * height, animated: true });
  };

  const followItem=snapshot.items[index];
  useEffect(()=>{
    if(context.kind!=='global' || !textEligible || !playback.hasFrame || !followItem?.productionUlid || !onPrepareLaunch)return;
    const timer=setTimeout(()=>onPrepareLaunch(followItem),200);
    return()=>clearTimeout(timer);
  },[followItem?.publicationId,textEligible,playback.hasFrame,onPrepareLaunch]);
  const showFollow=context.kind==='space' && ['group','channel'].includes(context.type) && followAuth.status==='authenticated' && !!followItem?.creator.id && !!onCreator;
  const showRecognition=context.kind==='global' && followAuth.status==='authenticated' && !!followItem?.creator.id && !!onCreator;
  const controlCount=(snapshot.items[index]?.creator.id && onCreator?1:0)+(context.kind==='global' && onLaunch?1:0)+(context.kind==='space' && onComments?2:0)+(snapshot.items[index]?.hasCaptions?1:0)+1;
  const controlHeight=Math.min(controlCount*52-8+(context.kind==='space' && onComments?40:0)+(showFollow?44:0),Math.max(44,height-headerHeight-48));
  return (
    <View testID="feed-stage" style={styles.screen} onLayout={event => setLayout(event.nativeEvent.layout)}>
      <View style={{flex:1}} pointerEvents={covered?'none':'auto'} accessibilityElementsHidden={covered} importantForAccessibility={covered?'no-hide-descendants':'auto'}>
      {height > 0 && <FlatList
        ref={list}
        data={snapshot.items}
        extraData={{ index, playback, height, textEligible }}
        keyExtractor={item => String(item.publicationId)}
        pagingEnabled
        scrollEnabled={!covered}
        initialNumToRender={2}
        initialScrollIndex={index}
        maxToRenderPerBatch={3}
        windowSize={5}
        removeClippedSubviews={false}
        showsVerticalScrollIndicator={false}
        getItemLayout={(_data, itemIndex) => ({ length: height, offset: height * itemIndex, index: itemIndex })}
        renderItem={({ item, index: rowIndex }) => (
          <FeedCard item={item} height={height} geometry={rowIndex===index?geometry:feedGeometry(width,height,item.width&&item.height?{width:item.width,height:item.height}:null)} onCreator={rowIndex===index?onCreator:undefined}
            resources={resources} active={rowIndex===index && textEligible} onStoryExpanded={rowIndex===index?setStoryExpanded:undefined}
            onTextHeight={rowIndex===index?setTextHeight:undefined}>
            {rowIndex === index && item.publicationId === playback.publicationId && item.playbackUrl && (
              <VideoSurface geometry={geometry} headerHeight={headerHeight} onRetry={onRecover} coordinator={coordinator} snapshot={playback} posterUrl={item.posterUrl} onNext={next} />
            )}
            {rowIndex === index && !item.playbackUrl && (
              <View style={styles.unavailable}><Action label="Next video" onPress={next} /></View>
            )}
          </FeedCard>
        )}
        scrollEventThrottle={16}
        onScrollBeginDrag={paging.beginDrag}
        onScroll={event => paging.scroll(event.nativeEvent.contentOffset.y)}
        onScrollEndDrag={event => paging.endDrag(event.nativeEvent.contentOffset.y)}
        onMomentumScrollBegin={paging.beginMomentum}
        onMomentumScrollEnd={event => paging.endMomentum(event.nativeEvent.contentOffset.y)}
        ListFooterComponent={<View style={{ height }}><FeedFooter snapshot={snapshot} store={store} /></View>}
      />}
      {/* Upload duration may precede production edits; bound cues with the loaded video's duration. */}
      {snapshot.items[index]?.hasCaptions && playback.publicationId === snapshot.items[index].publicationId && <CaptionLayer
        key={`${playback.activation}:${snapshot.items[index].publicationId}`} resources={resources}
        publicationId={snapshot.items[index].publicationId}
        duration={playback.player?.durationSeconds?.() || null}
        player={playback.player} paused={playback.userPaused} bottom={Math.min(textHeight + 40, height * .65)}
        visible={captions.ready && captions.enabled && textEligible && !storyExpanded && !playback.failed && !playback.restoring && !playback.restoreError}/>}
      {snapshot.items[index]?.playbackUrl && (
        <ScrollView style={[styles.mute,{height:controlHeight}]} contentContainerStyle={{gap:8}} showsVerticalScrollIndicator={false}>
          {!showFollow && !showRecognition && snapshot.items[index]?.creator.id && onCreator && <CreatorButton key={snapshot.items[index].publicationId} name={snapshot.items[index].creator.displayName}
            avatarUrl={snapshot.items[index].creator.avatarUrl} disabled={!textEligible} onPress={()=>onCreator(snapshot.items[index].creator.id!)}/>}
          {showRecognition && onCreator && <GlobalCreatorRecognition key={`recognition:${followItem.publicationId}:${followItem.creator.id}`}
            publicationId={followItem.publicationId} creatorId={followItem.creator.id!} name={followItem.creator.displayName} avatarUrl={followItem.creator.avatarUrl}
            onCreator={()=>onCreator(followItem.creator.id!)} eligible={textEligible && playback.publicationId===followItem.publicationId}/>}
          {showFollow && context.kind==='space' && onCreator && <FeedFollow key={`follow:${followItem.publicationId}:${followItem.creator.id}`} name={followItem.creator.displayName}
            avatarUrl={followItem.creator.avatarUrl} onCreator={()=>onCreator(followItem.creator.id!)}
            proof={{spaceId:context.spaceId,publicationId:followItem.publicationId,creatorId:followItem.creator.id!,generation:followAuth.generation,visitId:snapshot.sessionId}}
            eligible={textEligible && playback.publicationId===followItem.publicationId}
            onDenied={error=>{if(error instanceof ApiError && [401,403].includes(error.status??0))store.denyAccess(error);}}/>}
          {context.kind==='global' && onLaunch && <IconButton icon="launch" label="Open spaces for this video" disabled={!textEligible || playback.publicationId!==snapshot.items[index].publicationId} onPress={()=>onLaunch(snapshot.items[index])}/>}
          {context.kind==='space' && onComments && <EngagementControls client={client} spaceId={context.spaceId} publicationId={snapshot.items[index].publicationId}
            eligible={textEligible && playback.publicationId===snapshot.items[index].publicationId}
            onDenied={error=>{if(error instanceof ApiError)store.denyAccess(error);}} onComments={()=>onComments(snapshot.items[index].publicationId)}/>}
          {snapshot.items[index]?.hasCaptions && <IconButton icon="cc"
            label={captions.enabled ? 'Hide captions' : 'Show captions'} selected={captions.enabled}
            disabled={!captions.ready} onPress={() => { if(canInteract.current)void captionPreferences.toggle(); }} />}
          <IconButton icon={muted ? 'soundOff' : 'soundOn'} label={muted ? 'Unmute' : 'Mute'}
            selected={!muted} onPress={onToggleMute} />
        </ScrollView>
      )}
      </View>
      {covered&&<View style={[StyleSheet.absoluteFill,{paddingTop:headerHeight}]}><FeedLoadingSplash feedName={context.kind==='global'?'Global':context.name} error={entryState.error} onRetry={onRecover}/></View>}
      {context.kind==='space'&&!publicationAuthorized&&<View testID="feed-publication-mask" style={[StyleSheet.absoluteFill,{backgroundColor:'#000',paddingTop:headerHeight}]}>
        <Message title="Cannot verify video access" onRetry={()=>{void sessionAuth.access.check(context.spaceId);}}/>
      </View>}
    </View>
  );
}


export function FeedFooter({ snapshot, store }: { snapshot: FeedSnapshot; store: FeedStore }) {
  if (snapshot.loadingMore) return <Message title="Loading more videos" busy />;
  if (snapshot.moreError) {
    return <Message title="Cannot load more videos" message={snapshot.moreError} onRetry={() => { void store.loadMore(true); }} />;
  }
  if (snapshot.nextCursor) {
    return <Message title="Continue browsing" onRetry={() => { void store.loadMore(true); }} />;
  }
  return <Message title={snapshot.items.length ? "You're all caught up" : 'No videos yet'} onRetry={() => { void store.refresh(); }} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000' },
  toolbar: { position:'absolute',top:0,left:0,right:0,paddingHorizontal:16,paddingVertical:8,gap:8,backgroundColor:'rgba(0,0,0,0.35)' },
  headerActions: { flexDirection: 'row', gap: 8, flexWrap:'wrap', justifyContent:'center', paddingBottom:4 },
  mute: { position: 'absolute', right: CONTROL_LANE.right, bottom: 24, gap: 8, width: CONTROL_LANE.width },
  unavailable: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});
