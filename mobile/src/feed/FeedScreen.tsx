import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Action, Message } from '../ui/Message';
import { FeedCard } from './FeedCard';
import { useViewerFeed } from './useViewerFeed';
import type { FeedContext } from './context';
import { contextKey } from './context';
import { useAuth } from '../auth/useAuth';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSpaceAccess } from '../auth/useSpaceAccess';
import type { FeedSnapshot, FeedStore } from './feedStore';
import type { FeedVideoItem } from './types';
import { useFeedPlayback, type NativePlayerPort } from '../playback/useFeedPlayback';
import type { PlayerHandoff } from '../playback/playerHandoff';
import type { NavigationTrace } from '../diagnostics/playbackDiagnostics';
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

export type FeedCommands={requestRefresh:()=>void;denyAccess?:(error:ApiError)=>void};
export type FeedPlaybackHandle={capture:()=>PlaybackCheckpoint;release:()=>void;handOff:()=>PlayerHandoff<NativePlayerPort>|undefined};


export function FeedScreen({ context, preferences, sound, captionPreferences, captions, focused, onSpaces, onMenu, onGlobal, onCreator, registerPlayback, registerCommands, restore, entry, onBackProfile, onBackGlobal, onLaunch, onRetryEntry, onChooseLaunch, onComments, onPrepareLaunch, handoff, trace, blocked=false }: {
  onPrepareLaunch?:(item:FeedVideoItem)=>void;handoff?:PlayerHandoff<NativePlayerPort>;trace?:NavigationTrace;
  captionPreferences: CaptionPreferences; captions: ReturnType<CaptionPreferences['getSnapshot']>;
  context: FeedContext; preferences: PlaybackPreferences; sound: PlaybackPreferencesSnapshot; focused: boolean;
  onSpaces:()=>void;onMenu:()=>void;onGlobal:()=>void;
  registerCommands?:(handle:FeedCommands)=>()=>void;
  onCreator?:(id:number)=>void;registerPlayback?:(handle:FeedPlaybackHandle)=>()=>void;
  restore?:FeedCheckpoint;entry?:LaunchEntry;onBackProfile?:()=>void;onBackGlobal?:()=>void;onLaunch?:(item:FeedVideoItem)=>void;
  onRetryEntry?:()=>Promise<void>;onChooseLaunch?:()=>void;onComments?:(publicationId:number)=>void;blocked?:boolean;
}) {
  const { store:identity, snapshot:auth }=useAuth();
  const { store, snapshot, client,clearResume,entryPending,initialAccess } = useViewerFeed(context,restore,entry,trace);
  const access=useSpaceAccess(context,client,store,focused,initialAccess);
  // Verified spaces stay eligible during bounded routine renewal. Entry/return,
  // failure and expiry still withhold authority through the access guard.
  const eligible=!blocked && focused && !snapshot.errorStatus && access.authorized
    && (auth.status==='authenticated' || auth.status==='anonymous');
  const [retrying,setRetrying]=useState(false),[retryError,setRetryError]=useState<string|null>(null);
  const retryEntry=async()=>{if(retrying||!onRetryEntry)return;setRetrying(true);setRetryError(null);try{await onRetryEntry();}catch(e){setRetryError(e instanceof Error?e.message:"Cannot open space. Try again.");}finally{setRetrying(false);}};
  // Bound to this feed/auth generation. Unmount and context replacement invalidate commands.
  const pendingRefresh = useRef(false);
  const live = useRef({ mounted: false, focused });
  live.current.focused = focused;
  const refresh = (fromStart=false) => {
    const generation=auth.generation;
    if(fromStart)clearResume();
    void access.check().then(ok=>{
      if(ok && live.current.mounted && live.current.focused && identity.getSnapshot().generation===generation)void store.refresh();
    });
  };
  useLayoutEffect(()=>{
    live.current.mounted=true;
    const unregister=registerCommands?.({requestRefresh:()=>{
      if(live.current.mounted && identity.getSnapshot().generation===auth.generation)pendingRefresh.current=true;
    },denyAccess:error=>{if(live.current.mounted && identity.getSnapshot().generation===auth.generation)store.denyAccess(error);}});
    return()=>{live.current.mounted=false;pendingRefresh.current=false;unregister?.();};
  },[store,identity,auth.generation,registerCommands]);
  useEffect(()=>{
    if(focused && pendingRefresh.current){pendingRefresh.current=false;refresh(true);}
  },[focused,store]);
  return <SafeAreaView style={styles.screen} edges={['top','bottom']}>
    <View style={styles.toolbar}>
      <FeedHeader context={context} onSpaces={onSpaces} onMenu={onMenu} onBackProfile={onBackProfile} onBackGlobal={onBackGlobal}/>
      {auth.status==='anonymous' && auth.message && <Text accessibilityRole="alert" style={{color:'#ffb4b4',fontSize:15}}>{auth.message}</Text>}
      {snapshot.resume?.outcome==='unavailable' && <Text style={{color:'#c7c7ce'}}>The original video is no longer available. Showing the current feed.</Text>}
    </View>
    <View style={{flex:1}}>
      {blocked ? <Message title="Video no longer available"/> : snapshot.initialLoading ? <Message title="Loading videos" busy/> : snapshot.initialError ?
        <View style={{flex:1}}><Message title={snapshot.errorCode==='launch_target_unavailable'?'Video unavailable in this space':snapshot.errorStatus===403 || snapshot.errorStatus===404?'Access unavailable':'Cannot load the feed'}
          message={retryError??snapshot.initialError} busy={retrying} onRetry={retrying?undefined:entryPending && onRetryEntry?()=>{void retryEntry();}:()=>refresh()}/>
          {entryPending && onChooseLaunch && <Action label="Choose another space" onPress={onChooseLaunch}/>}
          <View style={styles.headerActions}><Action label="Spaces" onPress={onSpaces}/><Action label="Global" onPress={onGlobal}/></View>
        </View> : <FeedSession key={snapshot.sessionId} store={store} snapshot={snapshot} muted={sound.muted}
          onToggleMute={preferences.toggleMute} eligible={!!eligible} diagnosticContext={{feedContext:contextKey(context),authGeneration:auth.generation}}
          restore={restore} entry={entry} handoff={handoff} trace={trace} onPrepareLaunch={onPrepareLaunch} onCreator={onCreator} onLaunch={onLaunch} onComments={onComments} registerPlayback={registerPlayback} client={client} context={context} captionPreferences={captionPreferences} captions={captions}/>}
      {(auth.status==='unavailable' || (context.kind==='space' && access.checking && !access.authorized)) &&
        <View style={[StyleSheet.absoluteFill,{backgroundColor:'#000',padding:20,gap:12}]}>
          <Message title={auth.status==='unavailable'?'Cannot verify access':'Checking access'} busy={auth.status!=='unavailable'}
            message={auth.status==='unavailable'?auth.message??undefined:undefined}
            onRetry={auth.status==='unavailable'?()=>{void identity.retryValidation().then(()=>access.check());}:undefined}/>
          {auth.status==='unavailable' && <Action label="Browse Global" onPress={onGlobal}/>}
        </View>}
      {access.error && !access.checking && !snapshot.errorStatus && auth.status!=='unavailable' &&
        <View style={[StyleSheet.absoluteFill,{backgroundColor:'#000',padding:20,gap:12}]}>
          <Message title="Cannot verify access" message={access.error} onRetry={()=>{void access.check();}}/>
          <Action label="Global" onPress={onGlobal}/><Action label="Spaces" onPress={onSpaces}/>
        </View>}
    </View>
  </SafeAreaView>;
}

function FeedSession({ store, snapshot, muted, onToggleMute, eligible, diagnosticContext, restore, entry, onCreator, onLaunch, onComments, registerPlayback, client, context, captionPreferences, captions, onPrepareLaunch, handoff, trace }: {
  onPrepareLaunch?:(item:FeedVideoItem)=>void;handoff?:PlayerHandoff<NativePlayerPort>;trace?:NavigationTrace;
  store: FeedStore; snapshot: FeedSnapshot; muted: boolean; onToggleMute: () => void; eligible: boolean;
  diagnosticContext:{feedContext:string;authGeneration:number};
  restore?:FeedCheckpoint;entry?:LaunchEntry;onLaunch?:(item:FeedVideoItem)=>void;onComments?:(publicationId:number)=>void;onCreator?:(id:number)=>void;registerPlayback?:(handle:FeedPlaybackHandle)=>()=>void;
  client: ApiClient; context: FeedContext; captionPreferences: CaptionPreferences; captions: ReturnType<CaptionPreferences['getSnapshot']>;
}) {
  const [height, setHeight] = useState(0);
  const [index, setIndex] = useState(()=>Math.max(0,snapshot.items.findIndex(item=>item.publicationId===snapshot.resume?.restoredPublicationId)));
  const list = useRef<FlatList<FeedVideoItem>>(null);
  const items = useRef(snapshot.items);
  items.current = snapshot.items;
  const { coordinator, snapshot: playback } = useFeedPlayback(muted, eligible, diagnosticContext,handoff,trace);
  const resources = useMemo(() => new TextResources(client, context, error => store.denyAccess(error)), [client, contextKey(context), store]);
  const textEligible = eligible && playback.appActive && playback.screenEligible && !playback.scrolling;
  const [storyExpanded, setStoryExpanded] = useState(false);
  const [textHeight, setTextHeight] = useState(0);
  useLayoutEffect(() => { if (!textEligible) { resources.clear(); setStoryExpanded(false); } }, [resources, textEligible]);
  useEffect(() => resources.clear, [resources]);
  const initialSelection=useRef(false);
  useLayoutEffect(()=>registerPlayback?.({capture:coordinator.capture,release:coordinator.dispose,handOff:coordinator.handOff}),[coordinator,registerPlayback]);
  const paging = useMemo(() => new PagingController(
    () => coordinator.setScrolling(true),
    selected => {
      // Replace selection while still paused; never briefly resume the previous video.
      coordinator.selectAt(items.current, selected);
      setIndex(selected);
      coordinator.setScrolling(false);
    },
  ), [coordinator]);
  paging.configure(height, snapshot.items.length);
  useEffect(() => () => paging.dispose(), [paging]);
  useEffect(() => { store.ensureAhead(index); }, [store, index, snapshot]);
  useEffect(() => {
    if(!initialSelection.current) {
      initialSelection.current=true;
      if(entry && snapshot.resume?.restoredPublicationId===entry.publicationId){coordinator.restoreAt(snapshot.items,index,entry);return;}
      if(restore && snapshot.resume?.restoredPublicationId===snapshot.items[index]?.publicationId) {
        coordinator.restoreAt(snapshot.items,index,restore);return;
      }
    }
    coordinator.selectAt(snapshot.items, index);
  }, [coordinator, snapshot.items, index]);
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
    paging.beginProgrammatic();
    list.current?.scrollToOffset({ offset: Math.min(index + 1, snapshot.items.length) * height, animated: true });
  };
  const {snapshot:followAuth}=useAuth();
  const followItem=snapshot.items[index];
  useEffect(()=>{
    if(context.kind!=='global' || !textEligible || !playback.hasFrame || !followItem?.productionUlid || !onPrepareLaunch)return;
    const timer=setTimeout(()=>onPrepareLaunch(followItem),200);
    return()=>clearTimeout(timer);
  },[followItem?.publicationId,textEligible,playback.hasFrame,onPrepareLaunch]);
  const showFollow=context.kind==='space' && ['group','channel'].includes(context.type) && followAuth.status==='authenticated' && !!followItem?.creator.id && !!onCreator;
  const showRecognition=context.kind==='global' && followAuth.status==='authenticated' && !!followItem?.creator.id && !!onCreator;
  const controlCount=(snapshot.items[index]?.creator.id && onCreator?1:0)+(context.kind==='global' && onLaunch?1:0)+(context.kind==='space' && onComments?2:0)+(snapshot.items[index]?.hasCaptions?1:0)+1;
  const controlHeight=Math.min(controlCount*52-8+(context.kind==='space' && onComments?40:0)+(showFollow?44:0),Math.max(44,height-48));
  return (
    <View style={styles.screen} onLayout={event => setHeight(event.nativeEvent.layout.height)}>
      {height > 0 && <FlatList
        ref={list}
        data={snapshot.items}
        extraData={{ index, playback, height, textEligible }}
        keyExtractor={item => String(item.publicationId)}
        pagingEnabled
        initialNumToRender={2}
        initialScrollIndex={index}
        maxToRenderPerBatch={3}
        windowSize={5}
        removeClippedSubviews={false}
        showsVerticalScrollIndicator={false}
        getItemLayout={(_data, itemIndex) => ({ length: height, offset: height * itemIndex, index: itemIndex })}
        renderItem={({ item, index: rowIndex }) => (
          <FeedCard item={item} height={height} onCreator={rowIndex===index?onCreator:undefined}
            resources={resources} active={rowIndex===index && textEligible} onStoryExpanded={rowIndex===index?setStoryExpanded:undefined}
            onTextHeight={rowIndex===index?setTextHeight:undefined}>
            {rowIndex === index && item.publicationId === playback.publicationId && item.playbackUrl && (
              <VideoSurface coordinator={coordinator} snapshot={playback} posterUrl={item.posterUrl} onNext={next} />
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
            disabled={!captions.ready} onPress={() => { void captionPreferences.toggle(); }} />}
          <IconButton icon={muted ? 'soundOff' : 'soundOn'} label={muted ? 'Unmute' : 'Mute'}
            selected={!muted} onPress={onToggleMute} />
        </ScrollView>
      )}
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
  toolbar: { paddingHorizontal:16, paddingVertical:8, gap:8, backgroundColor:'#000' },
  headerActions: { flexDirection: 'row', gap: 8, flexWrap:'wrap', justifyContent:'center', paddingBottom:4 },
  mute: { position: 'absolute', right: CONTROL_LANE.right, bottom: 24, gap: 8, width: CONTROL_LANE.width },
  unavailable: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});
