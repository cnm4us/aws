import { useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { createVideoPlayer, type VideoPlayer } from 'expo-video';
import { PlaybackCoordinator, type PlayerPort } from './coordinator';
import { playbackDiagnostics } from '../diagnostics/development';
import { viewerBuildPolicy } from '../config/build';
import { PlayerBudget } from './playerBudget';
import type { NavigationTrace } from '../diagnostics/playbackDiagnostics';
import type { PlayerHandoff } from './playerHandoff';
import { createCaptionClock } from './captionClock';
import { prepareReadinessEvidence,cancelReadinessEvidence,readPresentationSize,seekNativeTimeline,cancelNativeSeek } from './readinessEvidence';

export interface NativePlayerPort extends PlayerPort { native: VideoPlayer; presentationSize():ReturnType<typeof readPresentationSize>;subscribeClock(listener: (seconds: number) => void): () => void }
const playerBudget=new PlayerBudget(3);

// Shared by the internal readiness check so it cannot bypass the app budget.
export function createNativePlayer(): NativePlayerPort {
  const lease=playerBudget.acquire(()=>createVideoPlayer(null),player=>player.release());
  const native=lease.value;
  try {
  native.loop = true;
  native.muted = true;
  native.staysActiveInBackground = false;
  native.bufferOptions = { preferredForwardBufferDuration: 5 };
  const diagnosticInterval = viewerBuildPolicy.diagnostics ? .25 : 0;
  native.timeUpdateEventInterval = diagnosticInterval;
  const clock = createCaptionClock(native, diagnosticInterval);
  let entryAttempt:string|undefined,seekAttempt:string|undefined;
  return {
    native,
    presentationSize:()=>readPresentationSize(native),
    prepareEntry:(attempt,seconds)=>{entryAttempt=attempt;return prepareReadinessEvidence(native,attempt,seconds).finally(()=>{if(entryAttempt===attempt)entryAttempt=undefined;});},
    cancelEntry:attempt=>{if(entryAttempt===attempt)entryAttempt=undefined;cancelReadinessEvidence(attempt);},
    load: url => native.replaceAsync({ uri: url, contentType: 'hls' }),
    play: () => native.play(),
    pause: () => native.pause(),
    setMuted: muted => { native.muted = muted; },
    seekToStart: () => { native.currentTime = 0; },
    currentTime: () => native.currentTime,
    durationSeconds: () => native.duration,
    subscribeClock: clock.subscribe,
    seekInteractive:async(seconds,attempt)=>{seekAttempt=attempt;try{return await seekNativeTimeline(native,attempt,seconds);}finally{if(seekAttempt===attempt)seekAttempt=undefined;}},
    cancelInteractiveSeek:attempt=>cancelNativeSeek(attempt),
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
    subscribeProgress: viewerBuildPolicy.diagnostics ? listener => {
      const subscription = native.addListener('timeUpdate', ({ currentTime }) => listener(currentTime));
      return () => subscription.remove();
    } : undefined,
    release: () => {if(seekAttempt)void cancelNativeSeek(seekAttempt).catch(()=>{});seekAttempt=undefined;if(entryAttempt)cancelReadinessEvidence(entryAttempt);entryAttempt=undefined;clock.dispose();lease.release();},
  };
  } catch(error) {lease.release();throw error;}
}

export function useFeedPlayback(muted: boolean, eligible = true, context?:{feedContext:string;authGeneration:number},handoff?:PlayerHandoff<NativePlayerPort>,trace?:NavigationTrace) {
  const {coordinator,diagnostic} = useMemo(() => {
    const diagnostic=playbackDiagnostics?.session();
    return {coordinator:new PlaybackCoordinator(createNativePlayer,diagnostic,muted,handoff,trace,true),diagnostic};
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
