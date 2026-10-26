import assert from 'node:assert/strict';
import test from 'node:test';
import { PlaybackCoordinator, type PlayerPort, type PlaybackStatus } from '../src/playback/coordinator';
import type { FeedVideoItem } from '../src/feed/types';
import { PagingController, settledIndex } from '../src/playback/paging';
import { PlaybackDiagnostics } from '../src/diagnostics/playbackDiagnostics';
import { PlaybackPreferences } from '../src/preferences/playbackPreferences';
import { PlayerBudget } from '../src/playback/playerBudget';

function item(publicationId: number): FeedVideoItem {
  return { publicationId, playbackUrl: `https://example.com/${publicationId}.m3u8`,
    uploadId: 1, productionUlid: null, spaceId: 1, posterUrl: null,
    creator: { id: 1, displayName: 'Creator', avatarUrl: null }, publishedAt:null,description: null,
    width: null, height: null, durationSeconds: null };
}

class FakePlayer implements PlayerPort {
  playing = false;
  muted = true;
  released = false;
  plays = 0;
  releases = 0;
  seeks = 0;
  loads = 0;
  currentStatus: PlaybackStatus = 'loading';
  listeners = new Set<(status: PlaybackStatus, error?: unknown) => void>();
  lateListeners: ((status: PlaybackStatus) => void)[] = [];
  playingListeners = new Set<(playing: boolean) => void>();
  progressListeners = new Set<(seconds: number) => void>();
  resolveLoad!: () => void;
  rejectLoad!: (error: Error) => void;
  load = () => { this.loads++; return new Promise<void>((resolve, reject) => { this.resolveLoad = resolve; this.rejectLoad = reject; }); };
  play() {
    assert.equal(this.released, false); this.plays += 1;
    if (!this.playing) { this.playing = true; this.playingListeners.forEach(listener => listener(true)); }
  }
  pause() {
    assert.equal(this.released, false);
    if (this.playing) { this.playing = false; this.playingListeners.forEach(listener => listener(false)); }
  }
  setMuted(muted: boolean) { assert.equal(this.released, false); this.muted = muted; }
  seekToStart() { assert.equal(this.released, false); this.seeks++; }
  bufferedSeconds = () => this.currentStatus === 'readyToPlay' ? 2 : 0;
  isPlaying = () => this.playing;
  release() { assert.equal(this.released, false); this.released = true; this.releases += 1; }
  status = () => this.currentStatus;
  subscribe = (listener: (status: PlaybackStatus, error?: unknown) => void) => {
    this.listeners.add(listener);
    this.lateListeners.push(listener);
    return () => { this.listeners.delete(listener); };
  };
  subscribePlaying = (listener: (playing: boolean) => void) => {
    this.playingListeners.add(listener); return () => { this.playingListeners.delete(listener); };
  };
  subscribeProgress = (listener: (seconds: number) => void) => {
    this.progressListeners.add(listener); return () => { this.progressListeners.delete(listener); };
  };
  ready() {
    this.currentStatus = 'readyToPlay';
    this.listeners.forEach(listener => listener('readyToPlay'));
    this.resolveLoad();
  }
}

function setup() {
  const players: FakePlayer[] = [];
  const coordinator = new PlaybackCoordinator(() => {
    assert.ok(players.every(player => player.released), 'release the old player before allocating');
    const player = new FakePlayer(); players.push(player); return player;
  });
  coordinator.setAppActive(true);
  return { coordinator, players };
}
test('a fresh feed cannot unmute or play from a first frame alone; reveal preserves pause and ordinary swipes',async()=>{
 const players:FakePlayer[]=[],stages:string[]=[],outcomes:string[]=[];
 const c=new PlaybackCoordinator(()=>{const p=new FakePlayer();players.push(p);return p;},undefined,false,undefined,
  {mark:stage=>stages.push(stage),finish:outcome=>outcomes.push(outcome)},true);
 c.setAppActive(true);c.selectAt([item(1),item(2),item(3)],0);players[0].ready();await Promise.resolve();
 c.firstFrame(c.getSnapshot().activation);assert.equal(c.getSnapshot().sourceLoaded,true);assert.ok(players.every(p=>p.muted&&!p.playing));assert.equal(outcomes.length,0);
 c.togglePause();c.presentEntry();assert.equal(players[0].playing,false);assert.equal(c.getSnapshot().userPaused,true);
 c.togglePause();assert.equal(players[0].playing,true);assert.equal(players[0].muted,false);
 players[1].ready();c.setScrolling(true);c.selectAt([item(1),item(2),item(3)],1);c.setScrolling(false);
 assert.equal(c.getSnapshot().entryPresented,true);assert.equal(players[1].playing,true);assert.equal(players.filter(p=>p.playing).length,1);
 assert.deepEqual(stages,['first_frame','entry_revealed']);assert.deepEqual(outcomes,['ready']);c.dispose();
});

test('screen blur or validation suppression releases neighbors and preserves manual pause on return',()=>{
  const players:FakePlayer[]=[];const c=new PlaybackCoordinator(()=>{const p=new FakePlayer();players.push(p);return p;});
  c.setAppActive(true);c.selectAt([item(1),item(2),item(3)],1);players[0].ready();
  for(const p of [...players].slice(1))p.ready();
  assert.equal(c.getSnapshot().livePlayers,3);c.togglePause();c.setScreenEligible(false);
  assert.equal(c.getSnapshot().livePlayers,1);assert.equal(players.every(p=>!p.playing),true);
  c.setAppActive(false);c.setAppActive(true);assert.equal(players.every(p=>!p.playing),true);
  c.setScreenEligible(true);assert.equal(c.getSnapshot().userPaused,true);assert.equal(players.filter(p=>p.playing).length,0);
  c.togglePause();assert.equal(players.filter(p=>p.playing).length,1);c.dispose();
});

test('a source that becomes ready behind another screen cannot start until focus and authorization return',()=>{
  const {coordinator:c,players}=setup();c.setScreenEligible(false);c.select(item(1));players[0].ready();assert.equal(players[0].playing,false);
  c.setAppActive(false);c.setScreenEligible(true);assert.equal(players[0].playing,false);c.setAppActive(true);assert.equal(players[0].playing,true);c.dispose();
});

test('only the selected video plays and stale load/status/frame callbacks cannot revive an old item', async () => {
  const { coordinator, players } = setup();
  coordinator.select(item(1));
  const oldActivation = coordinator.getSnapshot().activation;
  coordinator.select(item(2));
  assert.equal(players[0].released, true);
  players[1].ready();
  players[0].lateListeners[0]('readyToPlay');
  players[0].resolveLoad();
  coordinator.firstFrame(oldActivation);
  await Promise.resolve();
  assert.equal(players[0].plays, 0);
  assert.equal(players[1].playing, true);
  assert.equal(coordinator.getSnapshot().hasFrame, false);
  assert.equal(coordinator.getSnapshot().publicationId, 2);
});

test('rapid A-to-B-to-C selection releases skipped players and plays only C', async () => {
  const { coordinator, players } = setup();
  for (const id of [1, 2, 3]) coordinator.select(item(id));
  for (const player of players) player.ready();
  await Promise.resolve();
  assert.deepEqual(players.map(player => player.playing), [false, false, true]);
  assert.deepEqual(players.map(player => player.releases), [1, 1, 0]);
});

test('duplicate selection and cancelled swipes retain the player and respect user pause', () => {
  const { coordinator, players } = setup();
  coordinator.select(item(1)); players[0].ready();
  coordinator.togglePause();
  coordinator.setScrolling(true);
  coordinator.select(item(1));
  coordinator.setScrolling(false);
  assert.equal(players.length, 1);
  assert.equal(players[0].playing, false);
  assert.equal(coordinator.getSnapshot().userPaused, true);
});

test('background and scrolling pause immediately; readiness cannot override them', () => {
  const { coordinator, players } = setup();
  coordinator.select(item(1));
  coordinator.setScrolling(true);
  players[0].ready();
  assert.equal(players[0].playing, false);
  coordinator.setScrolling(false);
  assert.equal(players[0].playing, true);
  coordinator.setAppActive(false);
  assert.equal(players[0].playing, false);
  coordinator.setAppActive(true);
  assert.equal(players[0].playing, true);
  coordinator.togglePause();
  coordinator.setAppActive(false);
  coordinator.setAppActive(true);
  assert.equal(players[0].playing, false);
});

test('buffering after readiness preserves play intent without repeated play or pause commands', () => {
  const { coordinator, players } = setup();
  coordinator.select(item(1)); players[0].ready();
  const current = players[0];
  const playCalls = current.plays;
  current.currentStatus = 'loading';
  current.listeners.forEach(listener => listener('loading'));
  assert.equal(current.playing, true, 'keep the existing native play request during buffering');
  assert.equal(coordinator.getSnapshot().status, 'loading');
  current.listeners.forEach(listener => listener('loading'));
  current.ready();
  assert.equal(current.plays, playCalls, 'status changes must not restart playback commands');
  assert.equal(coordinator.getSnapshot().failed, false);
  coordinator.togglePause();
  current.currentStatus = 'loading';
  current.listeners.forEach(listener => listener('loading'));
  assert.equal(current.playing, false, 'buffering must still respect explicit pause');
  coordinator.togglePause();
  assert.equal(current.playing, true, 'resume can queue playback before buffering completes');
});

test('a retained revisit that starts buffering on seek still requests playback once settled', () => {
  const { coordinator, players } = poolSetup();
  const items = [item(1), item(2), item(3)];
  coordinator.selectAt(items, 0); players[0].ready(); players[1].ready();
  const previous = players[0];
  previous.seekToStart = () => {
    previous.seeks++;
    previous.currentStatus = 'loading';
    previous.listeners.forEach(listener => listener('loading'));
  };
  coordinator.selectAt(items, 1);
  coordinator.setScrolling(true);
  coordinator.selectAt(items, 0);
  assert.equal(previous.playing, false, 'remain paused while the gesture is in progress');
  coordinator.setScrolling(false);
  assert.equal(previous.playing, true, 'seek buffering must not prevent the selected play request');
  assert.equal(previous.loads, 1, 'retained source is reused');
  assert.equal(previous.seeks, 1);
  assert.equal(coordinator.getSnapshot().status, 'loading');
  coordinator.setAppActive(false);
  assert.equal(previous.playing, false);
  coordinator.setAppActive(true);
  assert.equal(previous.playing, true);
  assert.ok(players.filter(player => !player.released).length <= 3);
});

test('rebuffering cannot restart a deselected or failed player', () => {
  const { coordinator, players } = poolSetup();
  const items = [item(1), item(2)];
  coordinator.selectAt(items, 0); players[0].ready(); players[1].ready();
  const previous = players[0];
  coordinator.selectAt(items, 1);
  previous.currentStatus = 'loading';
  previous.listeners.forEach(listener => listener('loading'));
  previous.ready();
  assert.equal(previous.playing, false);
  coordinator.fail(coordinator.getSnapshot().activation);
  players[1].currentStatus = 'loading';
  players[1].listeners.forEach(listener => listener('loading'));
  assert.equal(players[1].playing, false);
});

test('session mute follows selection and retries replace failed players without double release', () => {
  const { coordinator, players } = setup();
  coordinator.select(item(1)); players[0].ready();
  coordinator.toggleMute();
  assert.equal(players[0].muted, false);
  coordinator.fail(coordinator.getSnapshot().activation);
  assert.equal(players[0].playing, false);
  coordinator.retry(); players[1].ready();
  assert.equal(players[1].muted, false);
  assert.equal(players[1].playing, true);
  coordinator.dispose(); coordinator.dispose();
  assert.deepEqual(players.map(player => player.releases), [1, 1]);
  assert.ok(players.every(player => player.listeners.size === 0));
});

test('hydrated sound is applied before first playback and speculative players remain muted', () => {
  for (const muted of [false, true]) {
    const players: FakePlayer[] = [];
    const soundAtPlay: boolean[] = [];
    const coordinator = new PlaybackCoordinator(() => {
      const player = new FakePlayer();
      const originalPlay = player.play.bind(player);
      player.play = () => { soundAtPlay.push(player.muted); originalPlay(); };
      players.push(player);
      return player;
    }, undefined, muted);
    coordinator.setAppActive(true);
    coordinator.selectAt([item(1), item(2)], 0); players[0].ready(); players[1].ready();
    assert.deepEqual(soundAtPlay, [muted]);
    assert.equal(players[1].muted, true);
    coordinator.setMuted(!muted);
    assert.equal(players[0].muted, !muted);
    assert.equal(players[1].muted, true);
    assert.equal(soundAtPlay.length, 1, 'changing sound does not restart the video');
    coordinator.dispose();
  }
});

test('current sound survives refresh-created coordinators independently of the saved startup default', async () => {
  let writes = 0;
  const preferences = new PlaybackPreferences({ getItem: async () => null, setItem: async () => { writes++; } });
  await preferences.hydrate();
  for (const muted of [true, false, true]) {
    preferences.toggleMute();
    assert.equal(preferences.getSnapshot().muted, muted);
    const player = new FakePlayer();
    const coordinator = new PlaybackCoordinator(() => player, undefined, preferences.getSnapshot().muted);
    coordinator.setAppActive(true);
    coordinator.select(item(1)); player.ready();
    assert.equal(player.muted, muted);
    coordinator.dispose();
    assert.equal(preferences.getSnapshot().muted, muted);
    assert.equal(preferences.getSnapshot().startMuted, false);
  }
  assert.equal(writes, 0);
});

test('selecting an unavailable video or footer releases the current player', () => {
  const { coordinator, players } = setup();
  coordinator.select(item(1)); players[0].ready();
  coordinator.select({ ...item(2), playbackUrl: null });
  assert.equal(players[0].released, true);
  assert.equal(coordinator.getSnapshot().player, null);
  coordinator.select(null);
  assert.equal(coordinator.getSnapshot().publicationId, null);
});

test('an old timeout cannot fail the next selected item', () => {
  const { coordinator } = setup();
  coordinator.select(item(1));
  const activation = coordinator.getSnapshot().activation;
  coordinator.select(item(2));
  coordinator.fail(activation);
  assert.equal(coordinator.getSnapshot().failed, false);
});

test('settling on another item replaces it before unpausing after the swipe', () => {
  const { coordinator, players } = setup();
  coordinator.select(item(1)); players[0].ready();
  const priorPlayCalls = players[0].plays;
  const paging = new PagingController(() => coordinator.setScrolling(true), index => {
    coordinator.select(item(index + 1));
    coordinator.setScrolling(false);
  });
  paging.configure(100, 10);
  paging.beginDrag(); paging.endMomentum(100);
  assert.equal(players[0].plays, priorPlayCalls);
  assert.equal(players[0].playing, false);
  assert.equal(players[1].playing, false);
  players[1].ready();
  assert.equal(players[1].playing, true);
});

function pagingSetup() {
  const callbacks = new Set<() => void>();
  const selections: number[] = [];
  let moving = 0;
  const paging = new PagingController(() => moving++, index => selections.push(index), callback => {
    callbacks.add(callback); return () => { callbacks.delete(callback); };
  });
  paging.configure(100, 20);
  return { paging, selections, moving: () => moving, flush: () => [...callbacks].forEach(callback => callback()) };
}

test('drag without momentum settles after scrolling finishes, including a cancelled swipe', () => {
  const { paging, selections, flush, moving } = pagingSetup();
  paging.beginDrag(); paging.scroll(70); paging.endDrag(70); paging.scroll(100);
  assert.equal(selections.length, 0);
  flush();
  assert.deepEqual(selections, [1]);
  paging.beginDrag(); paging.scroll(130); paging.endDrag(130); paging.scroll(100); flush();
  assert.deepEqual(selections, [1, 1]);
  assert.equal(moving(), 2);
});

test('momentum cancels the drag fallback and selects the final flung-to item', () => {
  const { paging, selections, flush } = pagingSetup();
  paging.beginDrag(); paging.endDrag(100); paging.beginMomentum(); paging.scroll(450); flush();
  assert.equal(selections.length, 0);
  paging.endMomentum(500);
  assert.deepEqual(selections, [5]);
});
test('initial FlatList anchoring and layout offsets cannot navigate or interrupt restoration',()=>{
 const {paging,selections,flush,moving}=pagingSetup();
 paging.scroll(100);paging.scroll(0);flush();assert.deepEqual(selections,[]);assert.equal(moving(),0);
 paging.beginProgrammatic();paging.scroll(700);flush();assert.deepEqual(selections,[7]);
 paging.scroll(800);flush();assert.deepEqual(selections,[7]);
 paging.endMomentum(800);assert.deepEqual(selections,[7]);
 paging.beginDrag();paging.scroll(900);paging.suspend();paging.endMomentum(900);flush();assert.deepEqual(selections,[7]);
});
test('an asynchronous play arriving after the next drag stays muted and is stopped with its issue retained',()=>{
 const players:FakePlayer[]=[],diagnostics=new PlaybackDiagnostics();
 const c=new PlaybackCoordinator(()=>{const p=new FakePlayer();players.push(p);return p;},diagnostics.session(),false);
 c.setAppActive(true);c.select(item(1));const p=players[0];p.ready();assert.equal(p.muted,false);
 c.setScrolling(true);assert.equal(p.muted,true);assert.equal(p.playing,false);
 p.playing=true;p.playingListeners.forEach(fn=>fn(true));assert.equal(p.playing,false);assert.equal(p.muted,true);
 assert.equal(diagnostics.report().resources.unexpectedPlayback,1);
 c.setScrolling(false);assert.equal(p.playing,true);assert.equal(p.muted,false);c.dispose();
});
test('paging teardown cancels callbacks and bounds footer/overscroll selection', () => {
  const { paging, selections, flush } = pagingSetup();
  paging.endDrag(100); paging.dispose(); flush();
  assert.equal(selections.length, 0);
  assert.equal(settledIndex(-80, 100, 20), 0);
  assert.equal(settledIndex(10000, 100, 20), 20);
  assert.equal(settledIndex(100, 0, 20), 0);
});

function poolSetup() {
  const players: FakePlayer[] = [];
  const diagnostics = new PlaybackDiagnostics();
  let peak = 0;
  const coordinator = new PlaybackCoordinator(() => {
    const live = players.filter(player => !player.released).length;
    assert.ok(live < 3, 'trim obsolete allocations before creating the next one');
    peak = Math.max(peak, live + 1);
    const player = new FakePlayer(); players.push(player); return player;
  }, diagnostics.session());
  coordinator.setAppActive(true);
  return { coordinator, players, diagnostics, peak: () => peak };
}

test('preloads while paused and promotes the exact prepared player without reloading it', () => {
  const { coordinator, players } = poolSetup();
  const items = [item(1), item(2), item(3)];
  coordinator.selectAt(items, 0);
  assert.equal(players.length, 1, 'current load takes priority over speculative work');
  players[0].ready();
  assert.equal(players.length, 2);
  players[1].ready();
  assert.equal(players[1].playing, false);
  assert.equal(players[1].muted, true);
  coordinator.setScrolling(true);
  coordinator.selectAt(items, 1);
  assert.equal(coordinator.getSnapshot().player, players[1]);
  assert.equal(coordinator.getSnapshot().prepared, true);
  assert.equal(players[1].loads, 1);
  assert.equal(players[0].released, false);
  coordinator.setScrolling(false);
  assert.equal(players[1].playing, true);
  assert.equal(players[0].playing, false);
  assert.equal(players[2].playing, false);
});

test('source replacement completion is timed independently from buffered readiness', async () => {
  let now = 0;
  const diagnostics = new PlaybackDiagnostics(() => now);
  const players: FakePlayer[] = [];
  const c = new PlaybackCoordinator(() => {
    const player = new FakePlayer();
    // AVPlayer may accept play while it continues waiting for buffered data.
    player.play = () => { player.plays += 1; };
    players.push(player); return player;
  }, diagnostics.session());
  c.setAppActive(true); c.selectAt([item(1), item(2)], 0);
  now = 100; players[0].resolveLoad(); await Promise.resolve();
  assert.equal(players[0].playing, false);
  assert.equal(players[0].plays, 1, 'queue selected playback as soon as replacement resolves');
  assert.equal(players.length, 1, 'metadata replacement alone must not trigger speculative work');
  now = 2000; players[0].ready();
  assert.equal(players.length, 2);
  now = 4500; c.selectAt([item(1), item(2)], 1);
  assert.equal(c.getSnapshot().prepared, false);
  now = 5000; players[1].resolveLoad(); await Promise.resolve();
  assert.equal(players[1].playing, false, 'the native player can still be waiting for data');
  assert.equal(players[1].plays, 1, 'selection queues a cold play request after replacement');
  now = 8000; players[1].ready();
  now = 8100; c.firstFrame(c.getSnapshot().activation);
  const rows = diagnostics.report().transitions;
  assert.deepEqual(rows[0].sourceLoad, { startedAtMs: 0, replaceResolvedMs: 100, readyMs: 2000 });
  assert.deepEqual(rows[1].sourceLoad, { startedAtMs: 2000, replaceResolvedMs: 3000, readyMs: 6000 });
  assert.equal(diagnostics.shareReport().slowTransitions[0].firstFrameMs, 3600);
  c.dispose();
});

test('resolved cold source queues only selected eligible playback and never starts its neighbor', async () => {
  const {coordinator: c, players} = poolSetup();
  c.selectAt([item(1), item(2)], 0); players[0].ready();
  players[1].resolveLoad(); await Promise.resolve();
  assert.equal(players[1].plays, 0);
  c.setScrolling(true); c.selectAt([item(1), item(2)], 1);
  assert.equal(players[1].plays, 0);
  c.setScreenEligible(false); c.setScrolling(false);
  assert.equal(players[1].plays, 0);
  c.setScreenEligible(true);
  assert.equal(players[1].plays, 1);
  assert.equal(c.getSnapshot().prepared, false, 'queued playback does not reclassify cold selection');
  assert.equal(players[0].playing, false);
  c.togglePause(); assert.equal(players[1].playing, false);
  c.dispose();
});

test('a displayed frame without playback still times out and late readiness cannot restart it', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const diagnostics = new PlaybackDiagnostics();
  const player = new FakePlayer();
  player.play = () => { player.plays += 1; };
  const c = new PlaybackCoordinator(() => player, diagnostics.session());
  try {
    c.setAppActive(true); c.select(item(1));
    player.resolveLoad(); await Promise.resolve();
    c.firstFrame(c.getSnapshot().activation);
    assert.equal(c.getSnapshot().hasFrame, true);
    assert.equal(c.getSnapshot().playbackStarted, false);
    t.mock.timers.tick(10001);
    assert.equal(c.getSnapshot().failed, true);
    assert.equal(diagnostics.report().issues[0].failureKind, 'startup_timeout');
    player.ready();
    assert.equal(c.getSnapshot().failed, true);
    assert.equal(player.plays, 1, 'late ready must not undo the retryable failure');
  } finally { c.dispose(); t.mock.timers.reset(); }
});

test('startup deadline respects pause, background, observed playing, selection and disposal', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const players: FakePlayer[] = [];
  const c = new PlaybackCoordinator(() => {
    const p = new FakePlayer(); p.play = () => { p.plays += 1; }; players.push(p); return p;
  });
  try {
    c.setAppActive(true); c.select(item(1));
    players[0].resolveLoad(); await Promise.resolve();
    t.mock.timers.tick(9000); c.togglePause();
    t.mock.timers.tick(20000); assert.equal(c.getSnapshot().failed, false);
    c.togglePause(); t.mock.timers.tick(9000); c.setAppActive(false);
    t.mock.timers.tick(20000); assert.equal(c.getSnapshot().failed, false);
    c.setAppActive(true); t.mock.timers.tick(9000);
    c.select(item(2));
    t.mock.timers.tick(2000); assert.equal(c.getSnapshot().failed, false, 'old selection deadline is cancelled');
    players[1].playing = true; players[1].playingListeners.forEach(fn => fn(true));
    assert.equal(c.getSnapshot().playbackStarted, true);
    c.firstFrame(c.getSnapshot().activation);
    t.mock.timers.tick(20000); assert.equal(c.getSnapshot().failed, false);
    c.select(item(3)); c.dispose();
    t.mock.timers.tick(20000); assert.equal(c.getSnapshot().failed, false);
  } finally { c.dispose(); t.mock.timers.reset(); }
});

test('zero-like progress cannot hide stalled startup; retry accepts genuine progress evidence', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const players: FakePlayer[] = [];
  const c = new PlaybackCoordinator(() => {
    const p = new FakePlayer(); p.play = () => { p.plays += 1; }; players.push(p); return p;
  });
  try {
    c.setAppActive(true); c.select(item(1));
    players[0].resolveLoad(); await Promise.resolve();
    players[0].progressListeners.forEach(fn => fn(0.000001));
    assert.equal(c.getSnapshot().playbackStarted, false);
    t.mock.timers.tick(10001); assert.equal(c.getSnapshot().failed, true);
    c.retry(); assert.equal(players[0].released, true);
    assert.equal(c.getSnapshot().failed, false);
    players[1].resolveLoad(); await Promise.resolve();
    c.togglePause(); players[1].progressListeners.forEach(fn => fn(0.25));
    assert.equal(c.getSnapshot().playbackStarted, false, 'paused progress cannot satisfy startup');
    c.togglePause(); players[1].progressListeners.forEach(fn => fn(0.25));
    assert.equal(c.getSnapshot().playbackStarted, true);
    c.firstFrame(c.getSnapshot().activation);
    t.mock.timers.tick(10001); assert.equal(c.getSnapshot().failed, false);
  } finally { c.dispose(); t.mock.timers.reset(); }
});

test('playing without a displayed frame retains the startup deadline', t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const player = new FakePlayer();
  const c = new PlaybackCoordinator(() => player);
  try {
    c.setAppActive(true); c.select(item(1)); player.ready();
    assert.equal(c.getSnapshot().playbackStarted, true);
    assert.equal(c.getSnapshot().hasFrame, false);
    t.mock.timers.tick(10001);
    assert.equal(c.getSnapshot().failed, true);
    assert.equal(player.playing, false);
  } finally { c.dispose(); t.mock.timers.reset(); }
});

test('late native replacement completion cannot record a new load after disposal', async () => {
  const diagnostics = new PlaybackDiagnostics();
  const players: FakePlayer[] = [];
  const c = new PlaybackCoordinator(() => { const player = new FakePlayer(); players.push(player); return player; }, diagnostics.session());
  c.setAppActive(true); c.select(item(1)); c.dispose();
  const before = diagnostics.report();
  players[0].resolveLoad(); await Promise.resolve();
  assert.deepEqual(diagnostics.report().events, before.events);
  assert.equal(diagnostics.report().resources.livePlayers, 0);
});

test('three-player cap holds at every allocation across a long feed and teardown removes all listeners', () => {
  const { coordinator, players, diagnostics, peak } = poolSetup();
  const items = Array.from({ length: 40 }, (_, index) => item(index + 1));
  for (let index = 0; index < items.length; index++) {
    coordinator.selectAt(items, index);
    for (const player of [...players]) if (!player.released) player.ready();
    const active = coordinator.getSnapshot().player;
    assert.ok(players.filter(player => !player.released).length <= 3);
    assert.ok(players.every(player => !player.playing || player === active));
    assert.ok(players.every(player => player.released || player === active || player.muted));
  }
  assert.equal(peak(), 3);
  coordinator.dispose(); coordinator.dispose();
  assert.ok(players.every(player => player.releases === 1));
  assert.ok(players.every(player => player.listeners.size + player.playingListeners.size + player.progressListeners.size === 0));
  assert.equal(diagnostics.report().resources.livePlayers, 0);
  assert.equal(diagnostics.report().resources.allocations, diagnostics.report().resources.releases);
});

test('rapid flings release obsolete prepared entries and reject their late callbacks', async () => {
  const { coordinator, players } = poolSetup();
  const items = Array.from({ length: 15 }, (_, index) => item(index + 1));
  coordinator.selectAt(items, 0); players[0].ready();
  const skipped = players[1];
  coordinator.selectAt(items, 7);
  const selected = coordinator.getSnapshot().player!;
  skipped.lateListeners[0]('readyToPlay'); skipped.resolveLoad();
  selected.ready();
  await Promise.resolve();
  assert.equal(skipped.plays, 0);
  assert.equal(skipped.released, true);
  assert.equal(coordinator.getSnapshot().player, selected);
  assert.equal(selected.playing, true);
});

test('background releases neighbors and foreground rebuilds them without clearing manual pause', () => {
  const { coordinator, players } = poolSetup();
  const items = [item(1), item(2), item(3)];
  coordinator.selectAt(items, 1); players[0].ready();
  assert.equal(coordinator.getSnapshot().livePlayers, 3);
  const current = coordinator.getSnapshot().player!;
  coordinator.togglePause();
  coordinator.setAppActive(false);
  assert.equal(coordinator.getSnapshot().livePlayers, 1);
  assert.equal(current.playing, false);
  coordinator.setAppActive(true);
  assert.equal(coordinator.getSnapshot().livePlayers, 3);
  assert.equal(coordinator.getSnapshot().userPaused, true);
  assert.equal(current.playing, false);
});

test('returning to a retained previous video seeks to its beginning without loading twice', () => {
  const { coordinator, players } = poolSetup();
  const items = [item(1), item(2), item(3)];
  coordinator.selectAt(items, 0); players[0].ready(); players[1].ready();
  coordinator.selectAt(items, 1);
  coordinator.selectAt(items, 0);
  assert.equal(coordinator.getSnapshot().player, players[0]);
  assert.equal(players[0].loads, 1);
  assert.equal(players[0].seeks, 1);
  assert.equal(coordinator.getSnapshot().prepared, false, 'do not claim a seek is a prepared forward transition');
});

test('retry replaces a failed prepared source while staying under the cap', async () => {
  const { coordinator, players } = poolSetup();
  const items = [item(1), item(2), item(3)];
  coordinator.selectAt(items, 0); players[0].ready();
  const failedPreload = players[1];
  failedPreload.rejectLoad(new Error('unreachable'));
  await new Promise(resolve => setImmediate(resolve));
  coordinator.selectAt(items, 1);
  assert.equal(coordinator.getSnapshot().failed, true);
  coordinator.retry();
  const replacement = coordinator.getSnapshot().player!;
  assert.notEqual(replacement, failedPreload);
  assert.equal(failedPreload.released, true);
  replacement.ready();
  assert.equal(replacement.playing, true);
});

test('native and source-load failures retain OS codes without retaining source URLs', async () => {
  const { coordinator, players, diagnostics } = poolSetup();
  coordinator.selectAt([item(1), item(2)], 0);
  players[0].ready();
  players[1].rejectLoad(new Error('Error Domain=NSURLErrorDomain Code=-1009 https://media.test/?Signature=secret'));
  players[0].listeners.forEach(listener => listener('error', { message: 'AVFoundationErrorDomain error -11800 https://media.test/?Signature=secret' }));
  await new Promise(resolve => setImmediate(resolve));
  const issues = diagnostics.shareReport().issues;
  assert.equal(issues.find(issue => issue.failureKind === 'source_load')?.nativeErrorCode, -1009);
  assert.equal(issues.find(issue => issue.failureKind === 'native_error')?.nativeErrorCode, -11800);
  assert.equal(JSON.stringify(issues).includes('Signature'), false);
  assert.equal(JSON.stringify(issues).includes('media.test'), false);
  coordinator.dispose();
});

test('progress before a first-frame event remains observable without claiming presentation', () => {
  const { coordinator, players, diagnostics } = poolSetup();
  coordinator.select(item(1));
  players[0].ready();
  players[0].progressListeners.forEach(listener => listener(0.25));
  const transition = diagnostics.shareReport().recentTransitions[0];
  assert.notEqual(transition.progressMs, null);
  assert.equal(transition.firstFrameMs, null);
  assert.equal(coordinator.getSnapshot().hasFrame, false);
  coordinator.setScrolling(true);
  const progress = diagnostics.report().events.filter(event => event.type === 'progress').length;
  players[0].progressListeners.forEach(listener => listener(0.5));
  assert.equal(diagnostics.report().events.filter(event => event.type === 'progress').length, progress);
  coordinator.dispose();
});

test('allocation failures distinguish an exhausted shared budget from native creation failure', () => {
  for (const allocationFailure of ['budget_exhausted', 'native_creation'] as const) {
    const diagnostics = new PlaybackDiagnostics();
    const budget = new PlayerBudget(0);
    const coordinator = new PlaybackCoordinator<FakePlayer>(() => {
      if (allocationFailure === 'budget_exhausted') budget.acquire(() => new FakePlayer(), player => player.release());
      throw new Error('Native creation failed https://media.test/?Signature=secret');
    }, diagnostics.session());
    coordinator.select(item(1));
    const issue = diagnostics.shareReport().issues.find(issue => issue.failureKind === 'player_allocation');
    assert.equal(issue?.allocationFailure, allocationFailure);
    assert.equal(issue?.activation, coordinator.getSnapshot().activation);
    assert.equal(coordinator.getSnapshot().failed, true);
    assert.equal(JSON.stringify(diagnostics.shareReport()).includes('secret'), false);
    coordinator.dispose();
  }
});

test('unexpected native playback by a neighbor is stopped and recorded', () => {
  const { coordinator, players, diagnostics } = poolSetup();
  coordinator.selectAt([item(1), item(2)], 0); players[0].ready();
  players[1].play();
  assert.equal(players[1].playing, false);
  assert.equal(diagnostics.report().resources.unexpectedPlayback, 1);
  assert.equal(diagnostics.report().issues[0].reason, 'nonselected');
  assert.equal(diagnostics.report().issues[0].selectedPublicationId, 1);
  assert.equal(diagnostics.report().issues[0].publicationId, 2);
});

test('a current player starting during a swipe is stopped with eligibility context', () => {
  const { coordinator, players, diagnostics } = poolSetup();
  coordinator.selectAt([item(1), item(2)], 0); players[0].ready();
  coordinator.setScrolling(true);
  players[0].play();
  assert.equal(players[0].playing, false);
  const issue = diagnostics.report().issues[0];
  assert.equal(issue.reason, 'ineligible');
  assert.equal(issue.scrolling, true);
  assert.equal(issue.appActive, true);
  assert.equal(issue.publicationId, issue.selectedPublicationId);
});

test('a delayed playing event after an already-paused neighbor is not counted as overlapping playback', () => {
  const { coordinator, players, diagnostics } = poolSetup();
  coordinator.selectAt([item(1), item(2)], 0); players[0].ready();
  players[1].playingListeners.forEach(listener => listener(true));
  assert.equal(players[1].playing, false);
  assert.equal(diagnostics.report().resources.unexpectedPlayback, 0);
});

test('queued gestures and retry from an unmounted account feed cannot revive its players', () => {
  const budget = new PlayerBudget(3);
  const diagnostics = new PlaybackDiagnostics();
  const players: FakePlayer[] = [];
  const create = () => {
    const lease = budget.acquire(() => new FakePlayer(), player => FakePlayer.prototype.release.call(player));
    lease.value.release = lease.release;
    players.push(lease.value);
    return lease.value;
  };
  const old = new PlaybackCoordinator(create, diagnostics.session(), false);
  old.setAppActive(true);
  old.selectAt([item(1), item(2), item(3)], 0);
  players[0].ready();
  const oldActivation = old.getSnapshot().activation;
  old.dispose();
  // Native scroll callbacks can already be queued when React removes a feed.
  old.selectAt([item(1), item(2), item(3)], 1);
  old.retry();
  old.setScreenEligible(true);
  old.setAppActive(true);
  old.setScrolling(false);
  old.togglePause();
  old.setMuted(false);
  old.firstFrame(oldActivation);
  old.fail(oldActivation);
  assert.equal(budget.count, 0, 'the removed account must remain fully released');
  assert.equal(old.getSnapshot().player, null);
  assert.equal(old.getSnapshot().publicationId, null);

  const next = new PlaybackCoordinator(create, diagnostics.session(), false);
  next.setAppActive(true);
  next.selectAt([item(1), item(2), item(3)], 1);
  next.getSnapshot().player!.ready();
  assert.equal(next.getSnapshot().failed, false);
  assert.equal(budget.count, 3);
  assert.equal(diagnostics.report().issues.length, 0);
  old.dispose(); // Repeated old cleanup cannot affect the new account.
  next.dispose();
  assert.equal(budget.count, 0);
});

test('synchronous native load failure becomes retryable instead of escaping the Retry handler', () => {
  const players: FakePlayer[] = [];
  const diagnostics = new PlaybackDiagnostics();
  const coordinator = new PlaybackCoordinator(() => {
    const player = new FakePlayer();
    if (players.length < 2) player.load = () => { throw new Error('NSURLErrorDomain error -1009'); };
    players.push(player);
    return player;
  }, diagnostics.session());
  coordinator.setAppActive(true);
  assert.doesNotThrow(() => coordinator.select(item(1)));
  assert.equal(coordinator.getSnapshot().failed, true);
  assert.doesNotThrow(coordinator.retry);
  assert.equal(coordinator.getSnapshot().failed, true);
  assert.doesNotThrow(coordinator.retry);
  players[2].ready();
  assert.equal(coordinator.getSnapshot().failed, false);
  assert.equal(players[2].playing, true);
  assert.equal(diagnostics.report().summary.errors, 2);
  assert.ok(diagnostics.report().issues.some(issue => issue.nativeErrorCode === -1009));
  coordinator.dispose();
  assert.ok(players.every(player => player.released));
});

test('partially subscribed native player setup rolls back its listeners and shared budget', () => {
  const budget = new PlayerBudget(3);
  const players: FakePlayer[] = [];
  const diagnostics = new PlaybackDiagnostics();
  const coordinator = new PlaybackCoordinator(() => {
    const lease = budget.acquire(() => new FakePlayer(), player => FakePlayer.prototype.release.call(player));
    lease.value.release = lease.release;
    if (!players.length) lease.value.subscribePlaying = () => { throw new Error('Native subscription failed'); };
    players.push(lease.value);
    return lease.value;
  }, diagnostics.session());
  coordinator.setAppActive(true);
  assert.doesNotThrow(() => coordinator.select(item(1)));
  assert.equal(coordinator.getSnapshot().failed, true);
  assert.equal(budget.count, 0);
  assert.equal(players[0].listeners.size, 0);
  assert.equal(players[0].released, true);
  assert.doesNotThrow(coordinator.retry);
  players[1].ready();
  assert.equal(coordinator.getSnapshot().failed, false);
  assert.equal(players[1].playing, true);
  const resources = diagnostics.report().resources;
  assert.equal(resources.allocations - resources.releases, budget.count);
  coordinator.dispose();
  assert.equal(budget.count, 0);
});
