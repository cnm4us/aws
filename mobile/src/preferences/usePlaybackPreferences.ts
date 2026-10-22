import { useEffect, useMemo, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CaptionPreferences } from './captionPreferences';
import { PlaybackPreferences } from './playbackPreferences';

export function usePlaybackPreferences() {
  const store = useMemo(() => new PlaybackPreferences(AsyncStorage), []);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => { void store.hydrate(); }, [store]);
  const captionPreferences = useMemo(() => new CaptionPreferences(AsyncStorage), []);
  const captions = useSyncExternalStore(captionPreferences.subscribe, captionPreferences.getSnapshot);
  useEffect(() => { void captionPreferences.hydrate(); }, [captionPreferences]);
  return { store, snapshot, captionPreferences, captions };
}
