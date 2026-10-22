import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, Share, StyleSheet, Text, View } from 'react-native';
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
import { useFeedPlayback } from '../playback/useFeedPlayback';
import { VideoSurface } from '../playback/VideoSurface';
import { PagingController } from '../playback/paging';
import { developmentDiagnostics } from '../diagnostics/development';
import type { PlaybackPreferences, PlaybackPreferencesSnapshot } from '../preferences/playbackPreferences';
import type { FeedCheckpoint, PlaybackCheckpoint } from '../navigation/viewerJourney';

export type FeedPlaybackHandle={capture:()=>PlaybackCheckpoint;release:()=>void};


export function FeedScreen({ context, preferences, sound, focused, onSpaces, onAccount, onSettings, onGlobal, onCreator, registerPlayback, restore, onBackProfile }: {
  context: FeedContext; preferences: PlaybackPreferences; sound: PlaybackPreferencesSnapshot; focused: boolean;
  onSpaces:()=>void;onAccount:()=>void;onSettings:()=>void;onGlobal:()=>void;
  onCreator?:(id:number)=>void;registerPlayback?:(handle:FeedPlaybackHandle)=>()=>void;
  restore?:FeedCheckpoint;onBackProfile?:()=>void;
}) {
  const { store:identity, snapshot:auth }=useAuth();
  const { store, snapshot, client,clearResume } = useViewerFeed(context,restore);
  const access=useSpaceAccess(context,client,store,focused);
  const eligible=focused && !auth.validating && !snapshot.errorStatus && access.authorized
    && (auth.status==='authenticated' || auth.status==='anonymous');
  const refresh=(fromStart=false)=>{if(fromStart)clearResume();void access.check().then(ok=>{if(ok)void store.refresh();});};
  return <SafeAreaView style={styles.screen} edges={['top','bottom']}>
    <View style={styles.toolbar}>
      <View style={styles.titleRow}>
        <Pressable onLongPress={__DEV__ ? sharePlaybackDiagnostics : undefined} accessibilityRole="header" style={{flex:1}}>
          <Text style={styles.heading}>{context.kind==='global'?'Global':context.name}</Text>
          {context.kind==='space' && <Text style={{color:'#c7c7ce'}}>{context.type}</Text>}
        </Pressable>
        <Action label="Refresh" onPress={()=>refresh(true)} />
      </View>
      <View style={styles.headerActions}>
        {onBackProfile && <Action label="Back to profile" onPress={onBackProfile}/>}
        <Action label="Spaces" onPress={onSpaces}/><Action label="Account" onPress={onAccount}/><Action label="Settings" onPress={onSettings}/>
      </View>
      {auth.status==='anonymous' && auth.message && <Text accessibilityRole="alert" style={{color:'#ffb4b4',fontSize:15}}>{auth.message}</Text>}
      {snapshot.resume?.outcome==='unavailable' && <Text style={{color:'#c7c7ce'}}>The original video is no longer available. Showing the current feed.</Text>}
    </View>
    <View style={{flex:1}}>
      {snapshot.initialLoading ? <Message title="Loading videos" busy/> : snapshot.initialError ?
        <View style={{flex:1}}><Message title={snapshot.errorStatus===403 || snapshot.errorStatus===404?'Access unavailable':'Cannot load the feed'}
          message={snapshot.initialError} onRetry={()=>refresh()}/>
          <View style={styles.headerActions}><Action label="Spaces" onPress={onSpaces}/><Action label="Global" onPress={onGlobal}/></View>
        </View> : <FeedSession key={snapshot.sessionId} store={store} snapshot={snapshot} muted={sound.muted}
          onToggleMute={preferences.toggleMute} eligible={!!eligible} diagnosticContext={{feedContext:contextKey(context),authGeneration:auth.generation}}
          restore={restore} onCreator={onCreator} registerPlayback={registerPlayback}/>}
      {(auth.status==='unavailable' || (context.kind==='space' && access.checking) || auth.validating) &&
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

function FeedSession({ store, snapshot, muted, onToggleMute, eligible, diagnosticContext, restore, onCreator, registerPlayback }: {
  store: FeedStore; snapshot: FeedSnapshot; muted: boolean; onToggleMute: () => void; eligible: boolean;
  diagnosticContext:{feedContext:string;authGeneration:number};
  restore?:FeedCheckpoint;onCreator?:(id:number)=>void;registerPlayback?:(handle:FeedPlaybackHandle)=>()=>void;
}) {
  const [height, setHeight] = useState(0);
  const [index, setIndex] = useState(()=>Math.max(0,snapshot.items.findIndex(item=>item.publicationId===snapshot.resume?.restoredPublicationId)));
  const list = useRef<FlatList<FeedVideoItem>>(null);
  const items = useRef(snapshot.items);
  items.current = snapshot.items;
  const { coordinator, snapshot: playback } = useFeedPlayback(muted, eligible, diagnosticContext);
  const initialSelection=useRef(false);
  useLayoutEffect(()=>registerPlayback?.({capture:coordinator.capture,release:coordinator.dispose}),[coordinator,registerPlayback]);
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
  return (
    <View style={styles.screen} onLayout={event => setHeight(event.nativeEvent.layout.height)}>
      {height > 0 && <FlatList
        ref={list}
        data={snapshot.items}
        extraData={{ index, playback, height }}
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
          <FeedCard item={item} height={height} onCreator={rowIndex===index?onCreator:undefined}>
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
      {snapshot.items[index]?.playbackUrl && (
        <View style={styles.mute}>
          <Action label={muted ? 'Unmute' : 'Mute'} onPress={onToggleMute} />
        </View>
      )}
    </View>
  );
}

export function sharePlaybackDiagnostics() {
    if (!developmentDiagnostics) return;
    const report = developmentDiagnostics.report();
    const compactReport = developmentDiagnostics.shareReport();
    const p95 = report.summary.preparedFrames.p95Ms;
    const share = (full: boolean) => {
      const exported = full ? report : compactReport;
      void Share.share({ message: JSON.stringify(exported, null, full ? 2 : undefined), title: 'Video playback diagnostics' }).catch(() => {});
    };
    Alert.alert('Playback diagnostics',
      `Players: ${report.resources.livePlayers} live, ${report.resources.peakPlayers} peak.\nTransitions: ${report.summary.transitions}; errors: ${report.summary.errors}.\nUnexpected playback: ${report.resources.unexpectedPlayback}.\nPrepared first-frame p95: ${p95 === null ? 'no samples yet' : `${Math.round(p95)} ms`}.`,
      [{ text: 'Close', style: 'cancel' },
        { text: 'Share report', onPress: () => share(false) },
        { text: 'Share full report', onPress: () => share(true) }]);
  };

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
  titleRow: { flexDirection:'row', alignItems:'center', gap:12 },
  headerActions: { flexDirection: 'row', gap: 8, flexWrap:'wrap', justifyContent:'center', paddingBottom:4 },
  heading: { color: '#ffffff', fontSize: 24, fontWeight: '700', textShadowColor: '#000000', textShadowRadius: 8 },
  mute: { position: 'absolute', right: 16, bottom: 24 },
  unavailable: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});
