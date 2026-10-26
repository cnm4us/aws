import { useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { VideoView } from 'expo-video';
import { fetchViewerFeed } from '../api/feed';
import { useViewerClient } from '../feed/useViewerFeed';
import { playbackDiagnostics } from '../diagnostics/development';
import { viewerBuildIdentity, viewerBuildPolicy } from '../config/build';
import { Action } from '../ui/Message';
import { FeedLoadingBar } from '../ui/FeedLoadingBar';
import { createNativePlayer, type NativePlayerPort } from './useFeedPlayback';
import { ReadinessProbe, type ProbeOptions } from './readinessProbe';
import { cancelReadinessEvidence, prepareReadinessEvidence, readinessEvidenceAvailable } from './readinessEvidence';

export type NativeReadinessProbe = ReadinessProbe<NativePlayerPort>;
const activePhases = ['loading', 'preparing', 'ready', 'revealed'];

export function ReadinessCheckScreen({ muted, onClose, onModal }: {
  muted: boolean; onClose(): void; onModal(probe: NativeReadinessProbe): void;
}) {
  const { auth, client, generation } = useViewerClient(), focused = useIsFocused();
  const probe = useMemo(() => {
    const diagnostic = playbackDiagnostics?.session();
    diagnostic?.({ type: 'context', feedContext: 'readiness-check', authGeneration: generation });
    return new ReadinessProbe({
      loadSubject: async signal => {
        const page = await fetchViewerFeed(client, { kind: 'global' }, signal);
        if (signal.aborted || auth.getSnapshot().generation !== generation || !auth.access.seedPage(page)) throw Error('Cancelled');
        const item = page.items.find(item => item.playbackUrl && auth.access.publicValid(item));
        if (!item) throw Error('No currently authorized public video');
        return item;
      },
      current: () => AppState.currentState === 'active' && auth.getSnapshot().generation === generation,
      authorized: item => auth.access.publicValid(item),
      create: createNativePlayer,
      prepare: (player, attempt, seconds) => prepareReadinessEvidence(player.native, attempt, seconds),
      cancel: cancelReadinessEvidence,
      resource: delta => diagnostic?.({ type: delta === 1 ? 'allocation' : 'release' }),
    });
  }, [auth, client, generation]);
  const state = useSyncExternalStore(probe.subscribe, probe.getSnapshot);
  useEffect(() => {
    const app = AppState.addEventListener('change', () => probe.invalidate());
    const identity = auth.subscribe(probe.invalidate), access = auth.access.subscribe(probe.invalidate);
    return () => { app.remove(); identity(); access(); probe.dispose(); };
  }, [probe, auth]);
  useLayoutEffect(() => { if (focused && state.phase === 'revealed') probe.present(); }, [probe, focused, state.phase]);
  const run = (seconds: number, paused: boolean, mode: ProbeOptions['mode'],automatic=false) => {
    if (!focused || !viewerBuildPolicy.diagnostics || !readinessEvidenceAvailable) return;
    void probe.start({ seconds, paused, muted, mode,automatic });
    if (mode === 'native-modal') onModal(probe);
  };
  const covered = ['loading', 'preparing', 'ready'].includes(state.phase);
  return <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
    <View style={styles.header}><Text style={styles.heading}>Feed readiness check</Text><Action label="Close readiness check" onPress={() => { probe.cancel(); onClose(); }} /></View>
    <View style={state.record?.options.automatic&&state.player?[styles.stage,StyleSheet.absoluteFill]:styles.stage}>
      {state.player && <VideoView key={state.record!.attempt} player={state.player.native} nativeControls={false} contentFit="contain"
        allowsVideoFrameAnalysis={false} style={StyleSheet.absoluteFill}
        onLayout={event => probe.viewport(state.record!.attempt, event.nativeEvent.layout.width, event.nativeEvent.layout.height)}
        onFirstFrameRender={() => probe.firstFrame(state.record!.attempt)} />}
      {covered && <View style={[StyleSheet.absoluteFill, styles.cover]} accessibilityViewIsModal>
        {state.record?.options.mode === 'inline' && <ReadinessCheckCover probe={probe} onReveal={probe.reveal} onCancel={probe.cancel} />}
      </View>}
    </View>
    <ScrollView style={state.record?.options.automatic&&state.player?styles.floatingControls:undefined} contentContainerStyle={styles.controls}>
      <Text style={styles.text}>Internal feasibility check. Uses a separate public video and your saved sound setting. No account or preference changes.</Text>
      {!readinessEvidenceAvailable && <Text style={styles.error}>This installed binary has no native readiness adapter.</Text>}
      {state.error && <Text style={styles.error} accessibilityRole="alert">{state.error}</Text>}
      <Text style={styles.text}>State: {state.phase}{state.record ? ` · target ${state.record.targetSeconds ?? state.record.options.seconds}s · ${state.record.options.paused ? 'paused' : 'playing'}` : ''}</Text>
      {state.phase === 'revealed' && <>
        <Text style={styles.text}>Check the first visible image, pause/play intent and sound (if enabled). Decoded-frame evidence alone does not prove the displayed image.</Text>
        <Action label="Frame and playback correct" onPress={() => probe.finish(true)} />
        <Action label="End without confirming" onPress={() => probe.finish(false)} />
      </>}
      {!activePhases.includes(state.phase) && [true, false].flatMap(paused => [0, 7].map(seconds =>
        <Action key={`${paused}-${seconds}`} label={`Check ${paused ? 'paused' : 'playing'} at ${seconds}s`} disabled={!readinessEvidenceAvailable}
          onPress={() => run(seconds, paused, 'native-modal')} />))}
      {!activePhases.includes(state.phase) && <>
        <Action label="Automatic full-height paused at 7s" disabled={!readinessEvidenceAvailable} onPress={()=>run(7,true,'native-modal',true)}/>
        <Action label="Automatic full-height playing at 0s" disabled={!readinessEvidenceAvailable} onPress={()=>run(0,false,'native-modal',true)}/>
      </>}
      {!activePhases.includes(state.phase) && <Action label="Compare inline cover at 7s paused" disabled={!readinessEvidenceAvailable} onPress={() => run(7, true, 'inline')} />}
      <Action label="Share readiness report" onPress={() => {
        void Share.share({ title: 'Feed readiness check', message: JSON.stringify({ build: viewerBuildIdentity, ...probe.report(), resources: playbackDiagnostics?.report().resources }, null, 2) }).catch(() => {});
      }} />
    </ScrollView>
  </SafeAreaView>;
}

export function ReadinessCheckCover({ probe, onReveal, onCancel }: {
  probe: NativeReadinessProbe; onReveal(): void; onCancel(): void;
}) {
  const state = useSyncExternalStore(probe.subscribe, probe.getSnapshot);
  useEffect(()=>{if(state.phase==='ready'&&state.record?.options.automatic)onReveal();},[state.phase,state.record?.attempt]);
  const waiting = state.phase === 'loading' || state.phase === 'preparing';
  return <SafeAreaView style={styles.modal} accessibilityViewIsModal edges={['top', 'bottom']}>
    <View style={styles.header}><Text style={styles.heading}>Preparing check video</Text><Action label="Cancel readiness preparation" onPress={onCancel} /></View>
    <ScrollView contentContainerStyle={styles.controls}>
      {waiting && <FeedLoadingBar />}
      <Text style={styles.text}>{state.phase === 'ready' ? state.record?.options.automatic?'Revealing check video':'Native target frame decoded. Reveal to inspect the actual video image.' : state.error ?? `Check: ${state.phase}`}</Text>
      {state.phase === 'ready'&&!state.record?.options.automatic && <Action label="Reveal check video" onPress={onReveal} />}
      <Text style={styles.text}>The covered player must remain silent. Cancel is available throughout.</Text>
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  header: { padding: 12, gap: 8 }, heading: { color: '#fff', fontSize: 23, fontWeight: '600' },
  stage: { flex: 1, minHeight: 160, backgroundColor: '#000' }, cover: { backgroundColor: '#000' },
  controls: { padding: 16, gap: 10 }, text: { color: '#ddd', fontSize: 17 }, error: { color: '#ffb4b4', fontSize: 17 },
  modal: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)' },
  floatingControls:{position:'absolute',bottom:0,left:0,right:0,maxHeight:220,backgroundColor:'rgba(0,0,0,0.8)'},
});
