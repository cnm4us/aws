import { useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { TextResources } from './resources';
import { VerifiedRefresh } from '../auth/verifiedRefresh';

export function StoryPanel({ publicationId, preview, resources, active, height, onExpanded }: {
  publicationId: number; preview: string | null; resources: TextResources; active: boolean; height: number;
  onExpanded: (expanded: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false), [attempt, setAttempt] = useState(0);
  const renewal = useMemo(() => new VerifiedRefresh((signal, force) => resources.verifiedStory(publicationId, signal, force),
    { protected: resources.context.kind === 'space', now: resources.now }), [resources, publicationId, attempt]);
  const refreshed = useSyncExternalStore(renewal.subscribe, renewal.getSnapshot);
  const state = { busy: refreshed.value === undefined && !refreshed.error, text: refreshed.value,
    error: refreshed.error ? 'Cannot load the story. Try again.' : null };
  useLayoutEffect(() => {
    if (!active) setExpanded(false);
    onExpanded(active && expanded);
    return () => onExpanded(false);
  }, [active, expanded, onExpanded]);
  useLayoutEffect(() => {
    if (!expanded || !active) return;
    renewal.setActive(true, attempt > 0);
    return () => renewal.setActive(false);
  }, [expanded, active, renewal, attempt]);
  if (!active) return null;
  return <View style={styles.panel}>
    <Pressable accessibilityRole="button" accessibilityLabel={expanded ? 'Collapse story' : 'Expand story'}
      accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={styles.button}>
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
