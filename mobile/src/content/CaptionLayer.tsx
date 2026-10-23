import { CONTROL_LANE } from '../ui/IconButton';
import { useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { TextResources } from './resources';
import { cueAt } from './vtt';
import { VerifiedRefresh } from '../auth/verifiedRefresh';

export interface CaptionPlayer {
  currentTime?(): number;
  subscribeClock(listener: (seconds: number) => void): () => void;
}
export function CaptionLayer({ resources, publicationId, duration, player, visible, bottom, paused }: {
  resources: TextResources; publicationId: number; duration: number | null; player: CaptionPlayer | null;
  visible: boolean; bottom: number; paused: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  const renewal = useMemo(() => new VerifiedRefresh((signal, force) => resources.verifiedCaptions(publicationId, duration, signal, force),
    { protected: resources.context.kind === 'space', now: resources.now }), [resources, publicationId, duration, attempt]);
  const refreshed = useSyncExternalStore(renewal.subscribe, renewal.getSnapshot);
  const [clockError, setClockError] = useState(false);
  const state = { cues: refreshed.value, loading: refreshed.value === undefined && !refreshed.error,
    error: refreshed.error || clockError ? 'Captions are unavailable. Try again.' : refreshed.value?.length === 0 ? 'Captions are not available.' : null };
  const [loadingNotice, setLoadingNotice] = useState(false);
  const [text, setText] = useState<string | null>(null);
  useLayoutEffect(() => {
    setText(null);
    setClockError(false);
    if (!visible) return;
    renewal.setActive(true, attempt > 0);
    return () => renewal.setActive(false);
  }, [renewal, visible, attempt]);
  useLayoutEffect(() => {
    setLoadingNotice(false);
    if (!visible || !state.loading) return;
    const timer = setTimeout(() => setLoadingNotice(true), 300);
    return () => clearTimeout(timer);
  }, [renewal, visible, state.loading]);
  useLayoutEffect(() => {
    setText(null);
    setClockError(false);
    if (!visible || !player || !state.cues?.length) return;
    // Subscribe samples immediately and runs in release; pause/seek causes an immediate resample.
    const cues = state.cues;
    try { return player.subscribeClock(seconds => setText(cueAt(cues, seconds))); }
    catch { setClockError(true); }
  }, [visible, player, state.cues, paused]);
  if (!visible) return null;
  return <View style={[styles.position, { bottom }]} pointerEvents="box-none">
    {state.loading ? (loadingNotice ? <View style={styles.pill} pointerEvents="none"><ActivityIndicator color="#fff" accessibilityLabel="Loading captions" /></View> : null) :
      state.error ? <View style={styles.pill}>
        <Text style={styles.text}>{state.error}</Text>
        <Pressable style={styles.retry} accessibilityRole="button" accessibilityLabel="Retry captions" onPress={() => setAttempt(n => n + 1)}>
          <Text style={styles.text}>Retry captions</Text>
        </Pressable>
      </View> : text ? <View style={styles.pill} pointerEvents="none"><Text style={styles.text} accessibilityLiveRegion="none">{text}</Text></View> : null}
  </View>;
}
const styles = StyleSheet.create({
  position: { position: 'absolute', left: 16, right: CONTROL_LANE.textRight, alignItems: 'center' },
  pill: { maxWidth: '100%', backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 12, padding: 10 },
  text: { color: '#fff', fontSize: 17, lineHeight: 24, textAlign: 'center' },
  retry: { minHeight: 44, justifyContent: 'center' },
});
