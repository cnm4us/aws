import { useLayoutEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { TextResources } from './resources';

export function StoryPanel({ publicationId, preview, resources, active, height, onExpanded }: {
  publicationId: number; preview: string | null; resources: TextResources; active: boolean; height: number;
  onExpanded: (expanded: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false), [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ busy: boolean; text: string | null; error: string | null }>({ busy: true, text: null, error: null });
  useLayoutEffect(() => {
    if (!active) setExpanded(false);
    onExpanded(active && expanded);
    return () => onExpanded(false);
  }, [active, expanded, onExpanded]);
  useLayoutEffect(() => {
    if (!expanded || !active) return;
    const request = new AbortController();
    const load = (force = false) => {
      setState({ busy: true, text: null, error: null });
      void resources.story(publicationId, request.signal, force).then(text => {
        if (!request.signal.aborted) setState({ busy: false, text, error: null });
      }, error => {
        if (!request.signal.aborted && error?.name !== 'AbortError') setState({ busy: false, text: null, error: 'Cannot load the story. Try again.' });
      });
    };
    load(attempt > 0);
    const timer = setInterval(() => load(true), 60_000);
    return () => { request.abort(); clearInterval(timer); };
  }, [expanded, active, publicationId, resources, attempt]);
  if (!active) return null;
  return <View style={styles.panel}>
    <Pressable accessibilityRole="button" accessibilityLabel={expanded ? 'Collapse story' : 'Expand story'}
      accessibilityState={{ expanded }} onPress={() => { if (!expanded) setState({ busy: true, text: null, error: null }); setExpanded(!expanded); }} style={styles.button}>
      <Text style={styles.action}>{expanded ? 'Collapse story' : 'Expand story'}</Text>
    </Pressable>
    {expanded ? <ScrollView style={{ maxHeight: Math.max(80, height * .45) }} nestedScrollEnabled
      onTouchStart={event => event.stopPropagation()}>
      {state.busy ? <ActivityIndicator color="#fff" accessibilityLabel="Loading story" /> : state.error ?
        <View><Text style={styles.text} accessibilityRole="alert">{state.error}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Retry story" onPress={() => setAttempt(n => n + 1)} style={styles.button}><Text style={styles.action}>Retry story</Text></Pressable></View> :
        <Text style={styles.text} selectable>{state.text?.trim() ? state.text : 'No story.'}</Text>}
    </ScrollView> : <Text style={styles.text} numberOfLines={2}>{preview || 'Read the story'}</Text>}
  </View>;
}
const styles = StyleSheet.create({
  panel: { gap: 4, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 12, paddingHorizontal: 10, paddingBottom: 8 },
  button: { minHeight: 44, paddingVertical: 8, justifyContent: 'center' },
  action: { color: '#fff', fontSize: 16, fontWeight: '700' },
  text: { color: '#fff', fontSize: 16, lineHeight: 23 },
});
