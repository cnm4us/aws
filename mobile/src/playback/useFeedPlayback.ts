import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { createVideoPlayer, type VideoPlayer } from 'expo-video';
import { PlaybackCoordinator, type PlayerPort } from './coordinator';
import { developmentDiagnostics } from '../diagnostics/development';

export interface NativePlayerPort extends PlayerPort { native: VideoPlayer }

function createNativePlayer(): NativePlayerPort {
  const native = createVideoPlayer(null);
  native.loop = true;
  native.muted = true;
  native.staysActiveInBackground = false;
  native.bufferOptions = { preferredForwardBufferDuration: 5 };
  native.timeUpdateEventInterval = __DEV__ ? 0.25 : 0;
  return {
    native,
    load: url => native.replaceAsync({ uri: url, contentType: 'hls' }),
    play: () => native.play(),
    pause: () => native.pause(),
    setMuted: muted => { native.muted = muted; },
    seekToStart: () => { native.currentTime = 0; },
    bufferedSeconds: () => Math.max(0, native.bufferedPosition - native.currentTime),
    isPlaying: () => native.playing,
    status: () => native.status,
    subscribe: listener => {
      const subscription = native.addListener('statusChange', ({ status }) => listener(status));
      return () => subscription.remove();
    },
    subscribePlaying: listener => {
      const subscription = native.addListener('playingChange', ({ isPlaying }) => listener(isPlaying));
      return () => subscription.remove();
    },
    subscribeProgress: __DEV__ ? listener => {
      const subscription = native.addListener('timeUpdate', ({ currentTime }) => listener(currentTime));
      return () => subscription.remove();
    } : undefined,
    release: () => native.release(),
  };
}

export function useFeedPlayback(muted: boolean) {
  const coordinator = useMemo(() => new PlaybackCoordinator(createNativePlayer, developmentDiagnostics?.session(), muted), []);
  const snapshot = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot);
  useEffect(() => { coordinator.setMuted(muted); }, [coordinator, muted]);
  useEffect(() => {
    coordinator.setAppActive(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', state => coordinator.setAppActive(state === 'active'));
    return () => { subscription.remove(); coordinator.dispose(); };
  }, [coordinator]);
  return { coordinator, snapshot };
}
