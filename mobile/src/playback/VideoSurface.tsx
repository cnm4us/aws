import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { VideoView } from 'expo-video';
import { Action } from '../ui/Message';
import type { PlaybackCoordinator, PlaybackSnapshot } from './coordinator';
import type { NativePlayerPort } from './useFeedPlayback';

export function VideoSurface({ coordinator, snapshot, posterUrl, onNext }: {
  coordinator: PlaybackCoordinator<NativePlayerPort>;
  snapshot: PlaybackSnapshot<NativePlayerPort>;
  posterUrl: string | null;
  onNext: () => void;
}) {
  const [showLoading, setShowLoading] = useState(false);
  const eligible = snapshot.appActive && !snapshot.scrolling && !snapshot.userPaused;
  useEffect(() => {
    setShowLoading(false);
    if (snapshot.hasFrame || snapshot.failed || !eligible) return;
    const spinner = setTimeout(() => setShowLoading(true), 250);
    const timeout = setTimeout(() => coordinator.fail(snapshot.activation), 10_000);
    return () => { clearTimeout(spinner); clearTimeout(timeout); };
  }, [coordinator, snapshot.activation, snapshot.hasFrame, snapshot.failed, eligible]);

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
      <Pressable style={StyleSheet.absoluteFill} onPress={coordinator.togglePause}
        accessibilityRole="button" accessibilityLabel={snapshot.userPaused ? 'Play video' : 'Pause video'} />
      {snapshot.failed ? (
        <View style={styles.feedback}>
          <Text style={styles.text}>Video unavailable</Text>
          <Action label="Retry" onPress={coordinator.retry} />
          <Action label="Next video" onPress={onNext} />
        </View>
      ) : showLoading || snapshot.userPaused ? (
        <View style={styles.center} pointerEvents="none">
          {snapshot.userPaused ? <Text style={styles.text}>Paused</Text> : <ActivityIndicator color="#ffffff" size="large" />}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  feedback: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 16, backgroundColor: 'rgba(0,0,0,0.6)' },
  text: { color: '#ffffff', fontSize: 20, fontWeight: '600', textShadowColor: '#000000', textShadowRadius: 8 },
});
