import assert from 'node:assert/strict';
import test from 'node:test';
import { FeedStore } from '../src/feed/feedStore';
import type { FeedPage, FeedVideoItem } from '../src/feed/types';
import { fetchGlobalFeed } from '../src/api/feed';

function item(id: number): FeedVideoItem {
  return { publicationId: id, uploadId: 1, productionUlid: null, spaceId: 1,
    playbackUrl: `https://example.com/${id}.m3u8`, posterUrl: null,
    creator: { id: 1, displayName: 'Creator', avatarUrl: null }, description: null,
    width: null, height: null, durationSeconds: null };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('cursor encoding preserves spaces, separators, and percent signs', async () => {
  let requestPath = '';
  const cursor = '2026-10-17 10:01:02|123%';
  await fetchGlobalFeed({ getJson: async path => { requestPath = path; return { items: [], nextCursor: null }; } }, undefined, cursor);
  assert.equal(new URL(requestPath, 'https://example.com').searchParams.get('cursor'), cursor);
});

test('merges overlapping pages in server order and stops at the end', async () => {
  let calls = 0;
  const pages = [{ items: [item(5), item(4)], nextCursor: 'next' },
    { items: [item(4), item(3)], nextCursor: null }];
  const store = new FeedStore(async () => pages[calls++]);
  await store.refresh();
  await store.loadMore();
  await store.loadMore();
  assert.deepEqual(store.getSnapshot().items.map(row => row.publicationId), [5, 4, 3]);
  assert.equal(calls, 2);
});

test('concurrent load-more events share one request', async () => {
  const pending = deferred<FeedPage>();
  let calls = 0;
  const store = new FeedStore(async () => ++calls === 1
    ? { items: [item(1)], nextCursor: 'a' } : pending.promise);
  await store.refresh();
  const first = store.loadMore();
  const second = store.loadMore();
  assert.equal(calls, 2);
  pending.resolve({ items: [item(2)], nextCursor: null });
  await Promise.all([first, second]);
  assert.equal(store.getSnapshot().items.length, 2);
});

test('failed page retries the same cursor and leaves current items available', async () => {
  const cursors: (string | null)[] = [];
  const store = new FeedStore(async cursor => {
    cursors.push(cursor);
    if (cursors.length === 1) return { items: [item(1)], nextCursor: 'a' };
    if (cursors.length === 2) throw new Error('Temporarily offline');
    return { items: [item(2)], nextCursor: null };
  });
  await store.refresh();
  await store.loadMore();
  assert.equal(store.getSnapshot().items.length, 1);
  assert.equal(store.getSnapshot().moreError, 'Temporarily offline');
  await store.loadMore();
  assert.equal(cursors.length, 2);
  await store.loadMore(true);
  assert.deepEqual(cursors, [null, 'a', 'a']);
  assert.equal(store.getSnapshot().items.length, 2);
  assert.equal(store.getSnapshot().moreError, null);
});

test('refresh aborts and ignores an older response even if its loader ignores cancellation', async () => {
  const pending = deferred<FeedPage>();
  let signal: AbortSignal | undefined;
  let calls = 0;
  const store = new FeedStore(async (_cursor, requestSignal) => {
    if (++calls === 1) { signal = requestSignal; return pending.promise; }
    return { items: [item(9)], nextCursor: null };
  });
  const old = store.refresh();
  await store.refresh();
  assert.equal(signal?.aborted, true);
  pending.resolve({ items: [item(1)], nextCursor: 'old' });
  await old;
  assert.deepEqual(store.getSnapshot().items.map(row => row.publicationId), [9]);
  assert.equal(store.getSnapshot().nextCursor, null);
});

test('repeating cursors pauses automatic fetching instead of spinning', async () => {
  let calls = 0;
  const store = new FeedStore(async () => ({ items: [item(++calls)], nextCursor: 'a' }));
  await store.refresh();
  await store.loadMore();
  assert.equal(store.getSnapshot().autoPaused, true);
  assert.match(store.getSnapshot().moreError!, /advance/);
  await store.loadMore();
  assert.equal(calls, 2);
});

test('empty pages advance new cursors, with an explicit continue after two automatic gaps', async () => {
  let calls = 0;
  const store = new FeedStore(async () => ({ items: calls++ ? [] : [item(1)], nextCursor: String(calls) }));
  await store.refresh();
  await store.loadMore();
  assert.equal(store.getSnapshot().autoPaused, false);
  await store.loadMore();
  assert.equal(store.getSnapshot().autoPaused, true);
  await store.loadMore();
  assert.equal(calls, 3);
  await store.loadMore(true);
  assert.equal(calls, 4);
});

test('teardown aborts without publishing a late error', async () => {
  const pending = deferred<FeedPage>();
  const store = new FeedStore(() => pending.promise);
  const request = store.refresh();
  const before = store.getSnapshot();
  store.cancel();
  pending.reject(new Error('Late failure'));
  await request;
  assert.equal(store.getSnapshot(), before);
});
