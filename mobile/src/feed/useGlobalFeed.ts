import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createApiClient } from '../api/client';
import { fetchGlobalFeed } from '../api/feed';
import { FeedStore } from './feedStore';

export function useGlobalFeed(baseUrl: string) {
  const store = useMemo(() => {
    const client = createApiClient(baseUrl);
    return new FeedStore((cursor, signal) => fetchGlobalFeed(client, signal, cursor));
  }, [baseUrl]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    void store.refresh();
    return store.cancel;
  }, [store]);
  return { store, snapshot };
}
