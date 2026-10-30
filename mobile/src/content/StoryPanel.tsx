import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { TextResources } from './resources';
import { VerifiedRefresh } from '../auth/verifiedRefresh';
import type { FeedVideoItem } from '../feed/types';
import { formatPublicationTime } from './publicationTime';

type Bounds = { height: number; headerHeight?: number };
type Interaction = { onInteracting?: (interacting: boolean) => void };
type PanelProps = Bounds & Interaction & { metadata?: ReactNode; active: boolean };

export function PublicationPanel({ item, resources, active, onCreator, onExpanded, ...bounds }: PanelProps & {
  item: FeedVideoItem; resources?: TextResources; onCreator?: (id: number) => void; onExpanded?: (expanded: boolean) => void;
}) {
  const live = useRef({active, id:item.publicationId, creatorId:item.creator.id, onCreator});
  live.current = {active, id:item.publicationId, creatorId:item.creator.id, onCreator};
  const name = <Text style={styles.creator}>{item.creator.displayName}</Text>;
  const date = <Text style={styles.date}>{formatPublicationTime(item.publishedAt)}</Text>;
  const metadata = item.creator.id && onCreator ? <Pressable style={styles.creatorButton} disabled={!active}
    accessibilityRole="button" accessibilityLabel={`View ${item.creator.displayName}'s profile`}
    accessibilityValue={{text:formatPublicationTime(item.publishedAt)}}
    accessibilityState={{disabled:!active}} onPress={event=>{event?.stopPropagation();
      if(live.current.active&&live.current.id===item.publicationId&&live.current.creatorId===item.creator.id)live.current.onCreator?.(item.creator.id!);
    }}>{name}{date}</Pressable> : <View style={styles.creatorButton}>{name}{date}</View>;
  return item.hasStory && resources && onExpanded ?
    <StoryPanel {...bounds} publicationId={item.publicationId} revision={item} resources={resources} active={active} onExpanded={onExpanded} metadata={metadata}/> :
    <PanelFrame {...bounds} active={active} metadata={metadata}/>;
}

// Only story-capable publications construct a renewal owner. State is scoped to
// the resource/publication so a reused row cannot display an old story once.
export function StoryPanel({ publicationId, revision, resources, active, onExpanded, ...props }: PanelProps & {
  publicationId: number; revision?: object; preview?: string | null; resources: TextResources; onExpanded: (expanded: boolean) => void;
}) {
  const [state, setState] = useState({ resources, publicationId, revision, expanded: false, absent: false, force: false });
  const [attempt, setAttempt] = useState(0);
  const same = state.resources === resources && state.publicationId === publicationId && state.revision === revision;
  const absent = same && state.absent, expanded = active && same && state.expanded && !absent;
  const renewal = useMemo(() => new VerifiedRefresh((signal, force) => resources.verifiedStory(publicationId, signal, force),
    { protected: resources.context.kind === 'space', now: resources.now }), [resources, publicationId, revision, attempt]);
  const refreshed = useSyncExternalStore(renewal.subscribe, renewal.getSnapshot);
  const live = useRef({active, expanded, absent, renewal});
  live.current = {active, expanded, absent, renewal};
  useLayoutEffect(() => {
    if (!active) setState(previous => previous.expanded ? { ...previous, expanded: false } : previous);
    onExpanded(expanded);
    return () => onExpanded(false);
  }, [active, expanded, onExpanded]);
  useLayoutEffect(() => {
    if (!expanded) return;
    renewal.setActive(true, attempt > 0 || state.force);
    return () => renewal.setActive(false);
  }, [expanded, renewal, attempt, state.force]);
  useLayoutEffect(() => {
    if (expanded && refreshed.value !== undefined && !refreshed.error && !refreshed.value?.trim())
      setState({ resources, publicationId, revision, expanded: false, absent: true, force: false });
  }, [expanded, refreshed.value, refreshed.error, resources, publicationId, revision]);
  return <PanelFrame {...props} active={active} expanded={expanded} expandable={!absent}
    onToggle={() => { const current=live.current;
      if (current.active && !current.absent && current.renewal === renewal)
        setState({ resources, publicationId, revision, absent: false, expanded: !current.expanded, force: !same && state.absent }); }}>
    {expanded && (refreshed.error ? <View>
      <Text style={styles.text} accessibilityRole="alert">Cannot load the story. Try again.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Retry story" onPress={event => { event?.stopPropagation();
        if(live.current.expanded && live.current.renewal===renewal) setAttempt(n => n + 1); }}
        style={styles.creatorButton}><Text style={styles.action}>Retry story</Text></Pressable>
    </View> : refreshed.value === undefined ? <Text style={styles.text}>Loading story</Text> :
      <Text style={styles.text} selectable>{refreshed.value}</Text>)}
  </PanelFrame>;
}

function PanelFrame({ metadata, height, headerHeight = 0, active, expandable = false, expanded = false, onToggle, onInteracting, children }: PanelProps & {
  expandable?: boolean; expanded?: boolean; onToggle?: () => void; children?: ReactNode;
}) {
  const [metadataHeight, setMetadataHeight] = useState(44);
  const maxHeight = Math.max(0, height - headerHeight - 36);
  const bodyHeight = Math.max(0, Math.min(height * .45, maxHeight - metadataHeight - 24));
  const scrollTogether = bodyHeight < 44;
  useLayoutEffect(() => { if (!expanded || !active) onInteracting?.(false); return () => onInteracting?.(false); }, [expanded, active, onInteracting]);
  return <View testID="publication-panel" style={[styles.panel, { maxHeight }]}>
    <ScrollView style={[styles.metadataScroll, { maxHeight: Math.max(0, maxHeight - 20) }]} nestedScrollEnabled bounces={false}
      onTouchStart={event => { event.stopPropagation(); onInteracting?.(true); }}
      onTouchEnd={() => onInteracting?.(false)} onTouchCancel={() => onInteracting?.(false)}>
      <View style={styles.metadata} onLayout={event => setMetadataHeight(event.nativeEvent.layout.height)}>{metadata}</View>
      {expanded && scrollTogether && <View testID="publication-story-body" style={{paddingRight:48}}>{children}</View>}
    </ScrollView>
    {expandable && <Pressable accessibilityRole="button" accessibilityLabel={expanded ? 'Collapse story' : 'Expand story'}
      accessibilityState={{ expanded, disabled: !active }} disabled={!active} style={styles.toggle}
      onPress={event => { event?.stopPropagation(); onToggle?.(); }}>
      <Image source={require('../../assets/icons/chevron.png')} accessible={false}
        style={[styles.chevron, { transform: [{ rotate: expanded ? '0deg' : '180deg' }] }]}/>
    </Pressable>}
    {expanded && !scrollTogether && <ScrollView testID="publication-story-body" style={{ maxHeight: bodyHeight, flexShrink: 1 }} nestedScrollEnabled bounces={false}
      onTouchStart={event => { event.stopPropagation(); onInteracting?.(true); }}
      onTouchEnd={() => onInteracting?.(false)} onTouchCancel={() => onInteracting?.(false)}>{children}</ScrollView>}
  </View>;
}

const styles = StyleSheet.create({
  panel: { gap: 4, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 12, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 6, overflow: 'hidden' },
  metadataScroll: { flexGrow: 0, flexShrink: 1 },
  metadata: { paddingRight: 48, minHeight: 44 },
  creatorButton: { minHeight: 44, justifyContent: 'center' },
  creator: { color: '#fff', fontSize: 18, lineHeight: 24, fontWeight: '700' },
  date: { color: '#fff', fontSize: 14, lineHeight: 20 },
  toggle: { position: 'absolute', top: 4, right: 8, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  chevron: { width: 24, height: 24 },
  action: { color: '#fff', fontSize: 16, fontWeight: '700' },
  text: { color: '#fff', fontSize: 16, lineHeight: 23 },
});
