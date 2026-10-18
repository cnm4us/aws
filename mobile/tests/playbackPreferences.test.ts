import assert from 'node:assert/strict';
import test from 'node:test';
import { PlaybackPreferences, PLAYBACK_PREFERENCES_KEY, type PreferenceStorage } from '../src/preferences/playbackPreferences';

function storage(value: string | null = null) {
  const writes: string[] = [];
  return { writes, adapter: {
    getItem: async (key: string) => { assert.equal(key, PLAYBACK_PREFERENCES_KEY); return value; },
    setItem: async (key: string, next: string) => { assert.equal(key, PLAYBACK_PREFERENCES_KEY); value = next; writes.push(next); },
  } satisfies PreferenceStorage };
}

test('first install starts unmuted and the browsing toggle does not change the saved startup default', async () => {
  const saved = storage();
  const preferences = new PlaybackPreferences(saved.adapter);
  assert.equal(preferences.getSnapshot().ready, false);
  await preferences.hydrate();
  assert.equal(preferences.getSnapshot().startMuted, false);
  assert.equal(preferences.getSnapshot().muted, false);
  preferences.toggleMute();
  assert.equal(preferences.getSnapshot().muted, true);
  assert.equal(preferences.getSnapshot().startMuted, false);
  assert.equal(saved.writes.length, 0);
  const nextLaunch = new PlaybackPreferences(saved.adapter);
  await nextLaunch.hydrate();
  assert.equal(nextLaunch.getSnapshot().muted, false);
});

test('hydration stays unready until the saved muted preference resolves and shares one read', async () => {
  let reads = 0;
  let resolve!: (value: string | null) => void;
  const preferences = new PlaybackPreferences({
    getItem: () => { reads++; return new Promise<string | null>(done => { resolve = done; }); },
    setItem: async () => {},
  });
  const first = preferences.hydrate();
  assert.equal(preferences.hydrate(), first);
  preferences.toggleMute();
  assert.equal(preferences.getSnapshot().ready, false);
  resolve(JSON.stringify({ version: 1, startMuted: true }));
  await first;
  assert.equal(reads, 1);
  assert.equal(preferences.getSnapshot().ready, true);
  assert.equal(preferences.getSnapshot().muted, true);
  assert.equal(preferences.getSnapshot().startMuted, true);
});

test('saved startup choice applies on the next launch and leaves current browsing sound unchanged', async () => {
  const saved = storage();
  const preferences = new PlaybackPreferences(saved.adapter);
  await preferences.hydrate();
  assert.equal(await preferences.setStartMuted(true), true);
  assert.equal(preferences.getSnapshot().startMuted, true);
  assert.equal(preferences.getSnapshot().muted, false);
  assert.deepEqual(JSON.parse(saved.writes[0]), { version: 1, startMuted: true });
  const nextLaunch = new PlaybackPreferences(saved.adapter);
  await nextLaunch.hydrate();
  assert.equal(nextLaunch.getSnapshot().muted, true);
  assert.equal(await nextLaunch.setStartMuted(false), true);
  assert.equal(nextLaunch.getSnapshot().muted, true);
  const unmutedLaunch = new PlaybackPreferences(saved.adapter);
  await unmutedLaunch.hydrate();
  assert.equal(unmutedLaunch.getSnapshot().muted, false);
});

test('failed preference writes stay visible, retain the prior choice, and can be retried', async () => {
  let fail = true;
  const saved = storage();
  const preferences = new PlaybackPreferences({ ...saved.adapter,
    setItem: async (key, value) => {
      if (fail) throw new Error('private device detail');
      await saved.adapter.setItem(key, value);
    },
  });
  await preferences.hydrate();
  assert.equal(await preferences.setStartMuted(true), false);
  assert.equal(preferences.getSnapshot().startMuted, false);
  assert.equal(preferences.getSnapshot().saving, false);
  assert.match(preferences.getSnapshot().error!, /could not be saved/);
  assert.doesNotMatch(preferences.getSnapshot().error!, /private/);
  fail = false;
  assert.equal(await preferences.setStartMuted(true), true);
  assert.equal(preferences.getSnapshot().error, null);
});

test('corrupt or unreadable storage falls back visibly without blocking startup', async () => {
  for (const raw of ['invalid json', 'null', '{"version":2,"startMuted":true}', '{"version":1,"startMuted":"false"}']) {
    const preferences = new PlaybackPreferences(storage(raw).adapter);
    await preferences.hydrate();
    assert.equal(preferences.getSnapshot().ready, true);
    assert.equal(preferences.getSnapshot().muted, false);
    assert.match(preferences.getSnapshot().error!, /could not be loaded/);
  }
  const preferences = new PlaybackPreferences({
    getItem: async () => { throw new Error('read failed'); }, setItem: async () => {},
  });
  await preferences.hydrate();
  assert.equal(preferences.getSnapshot().ready, true);
  assert.equal(preferences.getSnapshot().startMuted, false);
});

test('only one save runs at a time and changing browsing sound during a save is preserved', async () => {
  let finish!: () => void;
  let writes = 0;
  const preferences = new PlaybackPreferences({ getItem: async () => null,
    setItem: async () => { writes++; await new Promise<void>(resolve => { finish = resolve; }); },
  });
  await preferences.hydrate();
  const saving = preferences.setStartMuted(true);
  assert.equal(preferences.getSnapshot().saving, true);
  assert.equal(await preferences.setStartMuted(false), false);
  preferences.toggleMute();
  finish();
  assert.equal(await saving, true);
  assert.equal(writes, 1);
  assert.equal(preferences.getSnapshot().muted, true);
  assert.equal(preferences.getSnapshot().startMuted, true);
});
