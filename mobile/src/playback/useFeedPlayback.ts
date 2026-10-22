import { useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { createVideoPlayer, type VideoPlayer } from 'expo-video';
import { PlaybackCoordinator, type PlayerPort } from './coordinator';
import { developmentDiagnostics } from '../diagnostics/development';
import { PlayerBudget } from './playerBudget';

export interface NativePlayerPort extends PlayerPort { native: VideoPlayer }
const playerBudget=new PlayerBudget(3);

function createNativePlayer(): NativePlayerPort {
  const lease=playerBudget.acquire(()=>createVideoPlayer(null),player=>player.release());
  const native=lease.value;
  try {
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
    currentTime: () => native.currentTime,
    seekTo: async seconds => {
      native.currentTime=seconds;
      // The setter starts the native seek. Confirm the timeline reached its
      // target before unblocking playback, using reads available in release builds.
      const started=Date.now();
      while(Math.abs(native.currentTime-seconds)>1) {
        if(Date.now()-started>8000)throw Error('Seek timed out');
        await new Promise(resolve=>setTimeout(resolve,50));
      }
    },
    bufferedSeconds: () => Math.max(0, native.bufferedPosition - native.currentTime),
    isPlaying: () => native.playing,
    status: () => native.status,
    subscribe: listener => {
      const subscription = native.addListener('statusChange', ({ status, error }) => listener(status, error));
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
    release: lease.release,
  };
  } catch(error) {lease.release();throw error;}
}

export function useFeedPlayback(muted: boolean, eligible = true, context?:{feedContext:string;authGeneration:number}) {
  const {coordinator,diagnostic} = useMemo(() => {
    const diagnostic=developmentDiagnostics?.session();
    return {coordinator:new PlaybackCoordinator(createNativePlayer,diagnostic,muted),diagnostic};
  }, []);
  const snapshot = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot);
  useEffect(()=>{if(context)diagnostic?.({type:'context',...context});},[coordinator]);
  useEffect(() => { coordinator.setMuted(muted); }, [coordinator, muted]);
  useLayoutEffect(()=>{coordinator.setScreenEligible(eligible);},[coordinator,eligible]);
  useLayoutEffect(() => {
    coordinator.setAppActive(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', state => coordinator.setAppActive(state === 'active'));
    return () => { subscription.remove(); coordinator.dispose(); };
  }, [coordinator]);
  return { coordinator, snapshot };
}
