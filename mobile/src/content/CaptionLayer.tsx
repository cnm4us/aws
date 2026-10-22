import { useLayoutEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { TextResources } from './resources';
import { cueAt, type Cue } from './vtt';

export interface CaptionPlayer {
  currentTime?(): number;
  subscribeClock(listener: (seconds: number) => void): () => void;
}
export function CaptionLayer({ resources, publicationId, duration, player, visible, bottom, paused }: {
  resources: TextResources; publicationId: number; duration: number | null; player: CaptionPlayer | null;
  visible: boolean; bottom: number; paused: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ cues: Cue[]; loading: boolean; error: string | null }>({ cues: [], loading: true, error: null });
  const [text, setText] = useState<string | null>(null);
  useLayoutEffect(() => {
    setText(null);
    if (!visible) return;
    const request = new AbortController();
    const load = (force: boolean) => {
      setState({ cues: [], loading: true, error: null });
      void resources.captions(publicationId, duration, request.signal, force).then(cues => {
        if (!request.signal.aborted) setState({ cues, loading: false, error: cues.length ? null : 'Captions are not available.' });
      }, error => {
        if (!request.signal.aborted && error?.name !== 'AbortError') setState({ cues: [], loading: false, error: 'Captions are unavailable. Try again.' });
      });
    };
    load(attempt > 0);
    const timer = setInterval(() => load(true), 60_000);
    return () => { request.abort(); clearInterval(timer); };
  }, [resources, publicationId, duration, visible, attempt]);
  useLayoutEffect(() => {
    setText(null);
    if (!visible || !player || !state.cues.length) return;
    // Subscribe samples immediately and runs in release; pause/seek causes an immediate resample.
    try { return player.subscribeClock(seconds => setText(cueAt(state.cues, seconds))); }
    catch { setState({ cues: [], loading: false, error: 'Captions are unavailable. Try again.' }); }
  }, [visible, player, state.cues, paused]);
  if (!visible) return null;
  return <View style={[styles.position, { bottom }]} pointerEvents="box-none">
    {state.loading ? <View style={styles.pill} pointerEvents="none"><ActivityIndicator color="#fff" accessibilityLabel="Loading captions" /></View> :
      state.error ? <View style={styles.pill}>
        <Text style={styles.text}>{state.error}</Text>
        <Pressable style={styles.retry} accessibilityRole="button" accessibilityLabel="Retry captions" onPress={() => setAttempt(n => n + 1)}>
          <Text style={styles.text}>Retry captions</Text>
        </Pressable>
      </View> : text ? <View style={styles.pill} pointerEvents="none"><Text style={styles.text} accessibilityLiveRegion="none">{text}</Text></View> : null}
  </View>;
}
const styles = StyleSheet.create({
  position: { position: 'absolute', left: 16, right: 96, alignItems: 'center' },
  pill: { maxWidth: '100%', backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 12, padding: 10 },
  text: { color: '#fff', fontSize: 17, lineHeight: 24, textAlign: 'center' },
  retry: { minHeight: 44, justifyContent: 'center' },
});
