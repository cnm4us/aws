import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View, ScrollView } from 'react-native';
import { VideoView } from 'expo-video';
import { Action } from '../ui/Message';
import type { PlaybackCoordinator, PlaybackSnapshot } from './coordinator';
import type { NativePlayerPort } from './useFeedPlayback';

export function VideoSurface({ coordinator, snapshot, posterUrl, onNext,onRetry }: {
  coordinator: PlaybackCoordinator<NativePlayerPort>;
  snapshot: PlaybackSnapshot<NativePlayerPort>;
  posterUrl: string | null;
  onNext: () => void;onRetry?:()=>void;
}) {
  const [showLoading, setShowLoading] = useState(false);
  const eligible = snapshot.appActive && snapshot.screenEligible && !snapshot.scrolling && !snapshot.userPaused;
  const progressLabel = snapshot.restoring
    ? snapshot.status === 'readyToPlay' ? 'Restoring video position' : 'Loading video to restore position'
    : snapshot.hasFrame ? 'Starting playback' : 'Preparing video';
  useEffect(() => {
    setShowLoading(false);
    if ((snapshot.hasFrame && snapshot.playbackStarted) || snapshot.failed || snapshot.restoring || snapshot.restoreError || !eligible) return;
    const spinner = setTimeout(() => setShowLoading(true), 1500);
    return () => { clearTimeout(spinner); };
  }, [snapshot.activation, snapshot.hasFrame, snapshot.playbackStarted, snapshot.failed, snapshot.restoring, snapshot.restoreError, eligible]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {snapshot.player && <VideoView
        key={snapshot.activation}
        style={StyleSheet.absoluteFill}
        player={snapshot.player.native}
        contentFit="contain"
        nativeControls={false}
        allowsVideoFrameAnalysis={false}
        onFirstFrameRender={() => coordinator.firstFrame(snapshot.activation)}
      />}
      {!snapshot.hasFrame && posterUrl && <Image source={{ uri: posterUrl }} resizeMode="contain" style={StyleSheet.absoluteFill} />}
      <Pressable style={StyleSheet.absoluteFill} onPress={()=>{const live=coordinator.getSnapshot();if(live.screenEligible&&live.appActive&&!live.scrolling)coordinator.togglePause();}}
        accessibilityRole="button" accessibilityLabel={snapshot.userPaused ? 'Play video' : 'Pause video'} />
      {snapshot.restoreError ? <ScrollView style={styles.feedback} contentContainerStyle={styles.feedbackContent}>
        <Text style={styles.text}>{snapshot.restoreError}</Text>
        <Action label="Start from beginning" onPress={coordinator.retryRestore}/>
        <Action label="Next video" onPress={onNext}/>
      </ScrollView> : snapshot.restoring ? <View style={styles.center} pointerEvents="none">
        <View style={styles.progress}><Text style={styles.progressText}>{progressLabel}</Text></View>
      </View> : snapshot.failed ? (
        <ScrollView style={styles.feedback} contentContainerStyle={styles.feedbackContent}>
          <Text style={styles.text}>Cannot play video</Text>
          <Action label="Retry" onPress={onRetry??(()=>{coordinator.recoverFailed();})} />
          <Action label="Next video" onPress={onNext} />
        </ScrollView>
      ) : showLoading || snapshot.userPaused ? (
        <View style={styles.center} pointerEvents="none">
          {snapshot.userPaused ? <Text style={styles.text}>Paused</Text> :
            <View style={styles.progress}><Text style={styles.progressText}>{progressLabel}</Text></View>}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  progress: { maxWidth: '85%', alignItems: 'center', gap: 10, padding: 14, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.7)' },
  progressText: { color: '#ffffff', fontSize: 17, textAlign: 'center', flexShrink: 1 },
  feedback: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.6)' },
  feedbackContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 16 },
  text: { color: '#ffffff', fontSize: 20, fontWeight: '600', textShadowColor: '#000000', textShadowRadius: 8 },
});
