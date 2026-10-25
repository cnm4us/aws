import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../api/client';
import { useViewerClient } from '../feed/useViewerFeed';
import { FollowStore } from './followStore';
import type { FollowProof } from './api';
import { CreatorButton } from '../ui/CreatorButton';

// The parent space access guard owns account validation and its routine lease.
// This selected-only store renews the exact Follow proof without a second clock for account requests.
export function FeedFollow({ proof, name, avatarUrl, onCreator, eligible, onDenied }: {
  proof: FollowProof; name: string; avatarUrl: string|null; onCreator: () => void; eligible: boolean; onDenied: (error: Error) => void;
}) {
  const { auth, client, generation } = useViewerClient();
  const denied = useRef(onDenied); denied.current = onDenied;
  const store = useMemo(() => new FollowStore(client, proof, async signal => {
    if (signal.aborted || auth.getSnapshot().generation !== generation || auth.getSnapshot().status !== 'authenticated') {
      throw new Error('Cancelled');
    }
  }, error => {
    if (auth.getSnapshot().generation !== generation) return;
    if (error instanceof ApiError && error.status === 401) void auth.invalidate(generation);
    else denied.current(error);
  }), [client, auth, generation, proof.spaceId, proof.publicationId, proof.creatorId, proof.generation, proof.visitId]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const active = eligible && generation === proof.generation && auth.getSnapshot().status === 'authenticated';
  useLayoutEffect(() => {
    const update = () => store.setActive(active && AppState.currentState === 'active');
    update(); const sub = AppState.addEventListener('change', update);
    return () => { sub.remove(); store.setActive(false); };
  }, [store, active]);
  useEffect(() => () => store.dispose(), [store]);
  const summary = active && AppState.currentState === 'active' && state.authorized ? state.summary : null;
  const retry = !summary && !state.checking && !!(state.error || state.uncertain);
  const disabled = !active || state.busy || !summary && !retry;
  const label = summary
    ? `Follow ${name} in ${summary.space.name}`
    : retry ? `Refresh Follow status for ${name}` : `Checking Follow status for ${name}`;
  const followState = summary?.following ? 'here' : summary?.followingElsewhere ? 'elsewhere' : undefined;
  const hint = summary ? !summary.canFollow ? 'Your profile.' : summary.following
    ? `Following in ${summary.space.name}. Open profile to manage this Follow.`
    : summary.followingElsewhere ? `Following in another space, not yet in ${summary.space.name}. Follow button below.`
    : `Not following in ${summary.space.name}. Follow button below.` : 'Follow status unavailable.';
  return <View style={styles.group}>
    <CreatorButton name={name} avatarUrl={avatarUrl} onPress={onCreator} disabled={!eligible} followState={followState} accessibilityHint={hint}/>
    {(!summary || summary.canFollow && !summary.following) && <Pressable accessibilityRole="button" accessibilityLabel={label}
      accessibilityHint={summary?.followingElsewhere ? `Already following ${name} in another space.` : undefined}
      accessibilityState={{ disabled, busy: state.busy || state.checking }}
      disabled={disabled} onPress={() => { if (retry) store.retry(); else void store.follow(); }} style={styles.button}>
      <View style={styles.badge}><Text allowFontScaling={false} accessible={false} style={styles.mark}>{state.busy || !summary && !retry ? '…' : retry ? '↻' : '+'}</Text></View>
    </Pressable>}
  </View>;
}
const styles = StyleSheet.create({
  group: { alignItems: 'center' },
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'flex-start' },
  badge: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: '#777', backgroundColor: 'rgba(24,24,28,0.9)', alignItems: 'center', justifyContent: 'center' },
  mark: { color: '#fff', fontSize: 20, lineHeight: 22, fontWeight: '700' },
});
