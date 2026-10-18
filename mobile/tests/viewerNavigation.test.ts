import assert from 'node:assert/strict';
import test from 'node:test';
import { CommonActions, StackActions, StackRouter } from '@react-navigation/routers';
import { returnToFeed } from '../src/navigation/returnToFeed';
import { PlaybackCoordinator, type PlayerPort, type PlaybackStatus } from '../src/playback/coordinator';
import { PlayerBudget } from '../src/playback/playerBudget';
import { PlaybackDiagnostics } from '../src/diagnostics/playbackDiagnostics';
import type { FeedVideoItem } from '../src/feed/types';

const videos: FeedVideoItem[] = Array.from({ length: 40 }, (_, index) => ({
  publicationId: index + 1, playbackUrl: `https://media.test/${index}.m3u8`,
  uploadId: null, productionUlid: null, spaceId: 1, posterUrl: null,
  creator: { id: 1, displayName: 'Creator', avatarUrl: null }, description: null,
  width: null, height: null, durationSeconds: null,
}));

class Player implements PlayerPort {
  playing = false;
  released = false;
  muted = true;
  load = async () => {};
  status = (): PlaybackStatus => 'readyToPlay';
  bufferedSeconds = () => 6;
  play = () => { assert.equal(this.released, false); this.playing = true; };
  pause = () => { assert.equal(this.released, false); this.playing = false; };
  setMuted = (muted: boolean) => { this.muted = muted; };
  seekToStart = () => {};
  subscribe = () => () => {};
  release = () => {};
}

// Use the installed stack reducer, plus actual coordinators and the app-wide
// budget. Blurred stack routes retain their current player just as the UI does.
function setup() {
  const router = StackRouter({ initialRouteName: 'Feed' });
  const options = { routeNames: ['Feed', 'Spaces', 'Account', 'Settings'], routeParamList: {}, routeGetIdList: {} };
  let state = router.getInitialState(options);
  let context = 'global';
  const owners = new Map<string, { context: string; playback: PlaybackCoordinator<Player> }>();
  const players: Player[] = [];
  const budget = new PlayerBudget(3);
  const diagnostics = new PlaybackDiagnostics();
  const createPlayer = () => {
    const lease = budget.acquire(() => new Player(), player => {
      assert.equal(player.released, false); player.released = true; player.playing = false;
    });
    lease.value.release = lease.release;
    players.push(lease.value);
    return lease.value;
  };
  const reconcile = () => {
    const feedRoutes = state.routes.filter(route => route.name === 'Feed');
    const focused = state.routes[state.index].key;
    for (const [key, owner] of owners) {
      if (!feedRoutes.some(route => route.key === key) || owner.context !== context) {
        owner.playback.dispose(); owners.delete(key);
      } else owner.playback.setScreenEligible(key === focused);
    }
    for (const route of feedRoutes) {
      if (owners.has(route.key)) continue;
      const record = diagnostics.session();
      record({ type: 'context', feedContext: context, authGeneration: 2 });
      const playback = new PlaybackCoordinator(createPlayer, record, false);
      playback.setScreenEligible(route.key === focused);
      playback.setAppActive(true);
      playback.selectAt(videos, 0);
      owners.set(route.key, { context, playback });
    }
  };
  const dispatch = (action: Parameters<typeof router.getStateForAction>[1]) => {
    const next = router.getStateForAction(state, action, options);
    assert.ok(next && next.stale === false); state = next; reconcile();
  };
  const navigation = () => {
    const source = state.routes[state.index].key;
    return {
      isFocused: () => state.routes[state.index].key === source,
      popTo: (name: 'Feed') => dispatch({ ...StackActions.popTo(name), source, target: state.key }),
    };
  };
  const focused = () => {
    const playback = owners.get(state.routes[state.index].key)?.playback;
    assert.ok(playback); return playback;
  };
  reconcile();
  return {
    dispatch, get navigation() { return navigation(); }, focused, budget, diagnostics, players,
    routes: () => state.routes,
    resetIdentity: () => { state = router.getInitialState(options); reconcile(); },
    selectContext: (next: string) => { context = next; reconcile(); },
    dispose: () => { owners.forEach(owner => owner.playback.dispose()); owners.clear(); },
  };
}
// Flush native load promises and the resulting neighbor preparation.
const ready = () => new Promise<void>(resolve => setImmediate(resolve));

test('legacy navigate-to-Feed accumulates hidden owners and reproduces budget exhaustion', async () => {
  const app = setup();
  try {
    await ready();
    for (const context of ['space:2', 'global', 'space:2']) {
      app.dispatch(CommonActions.navigate('Spaces'));
      app.selectContext(context);
      app.dispatch(CommonActions.navigate('Feed'));
      await ready();
    }
    assert.equal(app.routes().filter(route => route.name === 'Feed').length, 4);
    assert.equal(app.budget.count, 3);
    assert.equal(app.focused().getSnapshot().failed, true);
    assert.ok(app.diagnostics.shareReport().issues.some(issue => issue.allocationFailure === 'budget_exhausted'));
  } finally { app.dispose(); }
  assert.equal(app.budget.count, 0);
});

test('space returns reuse one Feed route and retain preloading across repeated signed-in switches', async () => {
  const app = setup();
  const originalFeedKey = app.routes()[0].key;
  try {
    await ready();
    for (let cycle = 0; cycle < 20; cycle++) {
      app.dispatch(CommonActions.navigate('Spaces'));
      app.selectContext(cycle % 2 ? 'global' : 'space:2');
      returnToFeed(app.navigation);
      await ready();
      assert.deepEqual(app.routes().map(route => route.name), ['Feed']);
      assert.equal(app.routes()[0].key, originalFeedKey);
      for (let index = 1; index < 12; index++) {
        app.focused().setScrolling(true);
        app.focused().selectAt(videos, index);
        app.focused().setScrolling(false);
        assert.equal(app.focused().getSnapshot().failed, false);
        assert.equal(app.focused().getSnapshot().prepared, true);
        await ready();
        assert.ok(app.budget.count <= 3);
        assert.equal(app.players.filter(player => player.playing).length, 1);
      }
    }
    assert.equal(app.diagnostics.shareReport().issues.length, 0);
    assert.equal(app.diagnostics.report().resources.peakPlayers, 3);
  } finally { app.dispose(); }
  assert.equal(app.budget.count, 0);
  assert.ok(app.players.every(player => player.released));
  const resources = app.diagnostics.report().resources;
  assert.equal(resources.allocations, resources.releases);
});

test('Account Done and backing out of temporary screens preserve the feed, position and manual pause', async () => {
  const app = setup();
  try {
    await ready();
    app.focused().selectAt(videos, 1); await ready();
    app.focused().togglePause();
    const playback = app.focused(), player = playback.getSnapshot().player;
    for (const screen of ['Account', 'Settings', 'Spaces']) {
      app.dispatch(CommonActions.navigate(screen));
      if (screen === 'Account') returnToFeed(app.navigation);
      else app.dispatch(CommonActions.goBack());
      await ready();
      assert.equal(app.focused(), playback);
      assert.equal(playback.getSnapshot().player, player);
      assert.equal(playback.getSnapshot().publicationId, 2);
      assert.equal(playback.getSnapshot().userPaused, true);
      assert.equal(app.players.filter(player => player.playing).length, 0);
      assert.deepEqual(app.routes().map(route => route.name), ['Feed']);
    }
  } finally { app.dispose(); }
  assert.equal(app.budget.count, 0);
});

test('late Account completion after an auth-group reset does not target a removed route', async () => {
  const app = setup();
  try {
    await ready();
    app.dispatch(CommonActions.navigate('Account'));
    const oldAccount = app.navigation;
    app.resetIdentity(); await ready();
    const feedKey = app.routes()[0].key;
    assert.equal(oldAccount.isFocused(), false);
    returnToFeed(oldAccount);
    assert.deepEqual(app.routes().map(route => route.name), ['Feed']);
    assert.equal(app.routes()[0].key, feedKey);
    assert.equal(app.focused().getSnapshot().failed, false);
  } finally { app.dispose(); }
  assert.equal(app.budget.count, 0);
});
