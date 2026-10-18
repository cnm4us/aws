import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { Action, Message } from '../ui/Message';
import { FeedCard } from './FeedCard';
import { useGlobalFeed } from './useGlobalFeed';
import type { FeedSnapshot, FeedStore } from './feedStore';
import type { FeedVideoItem } from './types';
import { useFeedPlayback } from '../playback/useFeedPlayback';
import { VideoSurface } from '../playback/VideoSurface';
import { PagingController } from '../playback/paging';
import { developmentDiagnostics } from '../diagnostics/development';
import type { PlaybackPreferences, PlaybackPreferencesSnapshot } from '../preferences/playbackPreferences';
import { PlaybackSettings } from '../preferences/PlaybackSettings';

export function FeedScreen({ baseUrl, preferences, sound }: {
  baseUrl: string; preferences: PlaybackPreferences; sound: PlaybackPreferencesSnapshot;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { store, snapshot } = useGlobalFeed(baseUrl);
  if (snapshot.initialLoading) return <Message title="Loading videos" busy />;
  if (snapshot.initialError) {
    return <Message title="Cannot load the feed" message={snapshot.initialError} onRetry={() => { void store.refresh(); }} />;
  }
  return <>
    <FeedSession key={snapshot.sessionId} store={store} snapshot={snapshot} muted={sound.muted}
      onToggleMute={preferences.toggleMute} onSettings={() => setSettingsOpen(true)} />
    <PlaybackSettings visible={settingsOpen} onClose={() => setSettingsOpen(false)} preferences={preferences} snapshot={sound} />
  </>;
}

function FeedSession({ store, snapshot, muted, onToggleMute, onSettings }: {
  store: FeedStore; snapshot: FeedSnapshot; muted: boolean; onToggleMute: () => void; onSettings: () => void;
}) {
  const [height, setHeight] = useState(0);
  const [index, setIndex] = useState(0);
  const list = useRef<FlatList<FeedVideoItem>>(null);
  const items = useRef(snapshot.items);
  items.current = snapshot.items;
  const { coordinator, snapshot: playback } = useFeedPlayback(muted);
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
  useEffect(() => { coordinator.selectAt(snapshot.items, index); }, [coordinator, snapshot.items, index]);
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
  const shareDiagnostics = () => {
    if (!developmentDiagnostics) return;
    const report = developmentDiagnostics.report();
    const compactReport = developmentDiagnostics.shareReport();
    const p95 = report.summary.preparedFrames.p95Ms;
    const share = (full: boolean) => {
      const exported = full ? report : compactReport;
      void Share.share({ message: JSON.stringify(exported, null, full ? 2 : undefined), title: 'Video POC diagnostics' }).catch(() => {});
    };
    Alert.alert('Playback diagnostics',
      `Players: ${report.resources.livePlayers} live, ${report.resources.peakPlayers} peak.\nTransitions: ${report.summary.transitions}; errors: ${report.summary.errors}.\nUnexpected playback: ${report.resources.unexpectedPlayback}.\nPrepared first-frame p95: ${p95 === null ? 'no samples yet' : `${Math.round(p95)} ms`}.`,
      [{ text: 'Close', style: 'cancel' },
        { text: 'Share report', onPress: () => share(false) },
        { text: 'Share full report', onPress: () => share(true) }]);
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
        maxToRenderPerBatch={3}
        windowSize={5}
        removeClippedSubviews={false}
        showsVerticalScrollIndicator={false}
        getItemLayout={(_data, itemIndex) => ({ length: height, offset: height * itemIndex, index: itemIndex })}
        renderItem={({ item, index: rowIndex }) => (
          <FeedCard item={item} height={height}>
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
      <View style={styles.header} pointerEvents="box-none">
        <Pressable onLongPress={__DEV__ ? shareDiagnostics : undefined} accessibilityRole="header">
          <Text style={styles.heading}>Global</Text>
        </Pressable>
        <View style={styles.headerActions}>
          <Action label="Settings" onPress={onSettings} />
          <Action label="Refresh" onPress={() => { void store.refresh(); }} />
        </View>
      </View>
      {snapshot.items[index]?.playbackUrl && (
        <View style={styles.mute}>
          <Action label={muted ? 'Unmute' : 'Mute'} onPress={onToggleMute} />
        </View>
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
  header: { position: 'absolute', top: 12, left: 20, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerActions: { flexDirection: 'row', gap: 8 },
  heading: { color: '#ffffff', fontSize: 24, fontWeight: '700', textShadowColor: '#000000', textShadowRadius: 8 },
  mute: { position: 'absolute', right: 16, bottom: 24 },
  unavailable: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});
