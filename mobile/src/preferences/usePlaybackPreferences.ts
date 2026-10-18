import { useEffect, useMemo, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PlaybackPreferences } from './playbackPreferences';

export function usePlaybackPreferences() {
  const store = useMemo(() => new PlaybackPreferences(AsyncStorage), []);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => { void store.hydrate(); }, [store]);
  return { store, snapshot };
}
