import assert from 'node:assert/strict';
import test from 'node:test';
import { PlaybackDiagnostics } from '../src/diagnostics/playbackDiagnostics';

test('reset retains live ownership and speculative readiness without partial old transitions', () => {
  let now = 0;
  const diagnostics = new PlaybackDiagnostics(() => now, { kind: 'internal-preview', diagnostics: true, appVersion: '0.1.0', appBuild: '2', sourceId: 'a'.repeat(64), token: 'private' });
  const record = diagnostics.session();
  record({ type: 'context', feedContext: 'space:9', authGeneration: 2 });
  record({ type: 'selection', activation: 1, publicationId: 1 });
  record({ type: 'allocation', publicationId: 1, livePlayers: 1 });
  record({ type: 'allocation', publicationId: 2, livePlayers: 2 });
  record({ type: 'load_started', publicationId: 2 });
  now = 100; record({ type: 'load_resolved', publicationId: 2 });
  record({ type: 'error', activation: 1 });
  now = 200; diagnostics.reset();
  assert.deepEqual(diagnostics.report().resources, { allocations: 0, releases: 0, carriedPlayers: 2, livePlayers: 2, peakPlayers: 2, unexpectedPlayback: 0 });
  assert.deepEqual(diagnostics.report().sample, { startedAtMs: 200, resetCount: 1 });
  record({ type: 'first_frame', activation: 1 });
  record({ type: 'progress', activation: 1, currentTime: 9 });
  assert.equal(diagnostics.report().summary.transitions, 0, 'old activation cannot count as a new timing sample');
  assert.equal(diagnostics.report().issues.length, 0);
  now = 300; record({ type: 'ready', publicationId: 2 });
  now = 400; record({ type: 'selection', publicationId: 2, activation: 2, prepared: true, bufferedSeconds: 6 });
  now = 475; record({ type: 'first_frame', activation: 2 });
  record({ type: 'playing', activation: 2, playing: true });
  const row = diagnostics.shareReport().recentTransitions[0];
  assert.equal(row.initial, false); assert.equal(row.firstFrameMs, 75); assert.equal(row.feedContext, 'space:9');
  assert.deepEqual(row.sourceLoad, { startedAtMs: 0, replaceResolvedMs: 100, readyMs: 300 });
  record({ type: 'release', publicationId: 1, livePlayers: 1 });
  record({ type: 'release', publicationId: 2, livePlayers: 0 });
  const resources = diagnostics.report().resources;
  assert.equal(resources.carriedPlayers! + resources.allocations - resources.releases, resources.livePlayers);
  assert.equal(resources.livePlayers, 0);
  assert.equal(diagnostics.report().summary.normalPreparationRate, 1);
  assert.deepEqual(diagnostics.report().build, diagnostics.shareReport().build);
  assert.equal(JSON.stringify(diagnostics.shareReport()).includes('private'), false);
  diagnostics.report().build!.appBuild = '999';
  assert.equal(diagnostics.report().build!.appBuild, '2');
  diagnostics.reset();
  const next = diagnostics.session(); next({ type: 'selection', activation: 1, publicationId: 1 });
  assert.equal(diagnostics.report().transitions[0].initial, true, 'new feed still has a cold initial selection');
  assert.equal(diagnostics.report().resources.carriedPlayers, 0);
});

test('first-frame timing is monotonic, counted once, and separate from playing/progress evidence', () => {
  let now = 0;
  const diagnostics = new PlaybackDiagnostics(() => now);
  const record = diagnostics.session();
  record({ type: 'selection', activation: 1, publicationId: 9, prepared: true, bufferedSeconds: 3 });
  now = 120; record({ type: 'first_frame', activation: 1 });
  now = 160; record({ type: 'first_frame', activation: 1 });
  now = 200; record({ type: 'playing', activation: 1, playing: true });
  now = 250; record({ type: 'progress', activation: 1, currentTime: 0.25 });
  const report = diagnostics.report();
  assert.equal(report.transitions[0].firstFrameMs, 120);
  assert.equal(report.transitions[0].progressMs, 250);
  assert.equal(report.transitions[0].playingObserved, true);
  assert.equal(report.summary.preparedFrames.p95Ms, 120);
});

test('incomplete, failed, and interrupted transitions remain visible instead of improving the sample', () => {
  const diagnostics = new PlaybackDiagnostics(() => 0);
  const record = diagnostics.session();
  record({ type: 'selection', activation: 1, publicationId: 1, prepared: false });
  record({ type: 'lifecycle', activation: 1, active: false });
  record({ type: 'selection', activation: 2, publicationId: 2, prepared: true });
  record({ type: 'error', activation: 2 });
  const report = diagnostics.report();
  assert.equal(report.summary.transitions, 2);
  assert.equal(report.summary.incomplete, 2);
  assert.equal(report.summary.errors, 1);
  assert.equal(report.transitions[0].interrupted, true);
  assert.equal(report.summary.preparationRate, 0.5);
  assert.equal(report.transitions[0].initial, true);
  assert.equal(report.transitions[1].initial, false);
  assert.equal(report.summary.normalPreparationRate, 1);
});

test('resource counters span refresh sessions and retain release totals', () => {
  const diagnostics = new PlaybackDiagnostics();
  const first = diagnostics.session();
  first({ type: 'allocation', livePlayers: 1 });
  first({ type: 'allocation', livePlayers: 2 });
  first({ type: 'release', livePlayers: 1 });
  first({ type: 'release', livePlayers: 0 });
  const second = diagnostics.session();
  second({ type: 'allocation', livePlayers: 1 });
  assert.deepEqual(diagnostics.report().resources, { allocations: 3, releases: 2, livePlayers: 1, peakPlayers: 2, unexpectedPlayback: 0 });
  second({ type: 'release', livePlayers: 0 });
  assert.equal(diagnostics.report().resources.livePlayers, 0);
});

test('diagnostic storage is bounded and reports discarded history', () => {
  const diagnostics = new PlaybackDiagnostics();
  const record = diagnostics.session();
  for (let activation = 0; activation < 250; activation++) {
    record({ type: 'selection', activation, publicationId: activation });
  }
  for (let i = 0; i < 1100; i++) record({ type: 'ready', publicationId: i });
  const report = diagnostics.report();
  assert.equal(report.transitions.length, 200);
  assert.equal(report.events.length, 1000);
  assert.equal(report.droppedTransitions, 50);
  assert.equal(report.droppedEvents, 350);
});

test('ownership issue details survive progress history rollover and appear in compact reports', () => {
  const diagnostics = new PlaybackDiagnostics(() => 42);
  const record = diagnostics.session();
  record({ type: 'unexpected_playback', publicationId: 2, selectedPublicationId: 1,
    activation: 3, reason: 'nonselected', appActive: true, scrolling: false, userPaused: false });
  for (let i = 0; i < 1100; i++) record({ type: 'progress', currentTime: i / 4 });
  assert.equal(diagnostics.report().events.some(row => row.type === 'unexpected_playback'), false);
  const report = diagnostics.shareReport();
  assert.equal(report.resources.unexpectedPlayback, 1);
  assert.equal(report.issues[0].publicationId, 2);
  assert.equal(report.issues[0].selectedPublicationId, 1);
  assert.equal(report.issues[0].reason, 'nonselected');
  assert.equal(report.issues[0].atMs, 42);
  assert.equal(report.omittedEventDetails, 1000);
  assert.equal(report.droppedEvents, 101);
});

test('compact sharing stays small while disclosing omitted rows and bounded issue history', () => {
  const diagnostics = new PlaybackDiagnostics(() => 123456789.123456);
  const record = diagnostics.session();
  record({ type: 'context', feedContext: 'space:123456789', authGeneration: 12345 });
  for (let activation = 0; activation < 250; activation++) {
    record({ type: 'selection', publicationId: activation, activation, prepared: true, bufferedSeconds: 6 });
    record({ type: 'first_frame', activation });
    record({ type: 'unexpected_playback', publicationId: activation, selectedPublicationId: activation + 1,
      activation, reason: 'nonselected', appActive: true, scrolling: true, userPaused: false });
  }
  for (let i = 0; i < 1100; i++) record({ type: 'progress', currentTime: i / 4 });
  const report = diagnostics.shareReport();
  assert.equal(report.reportKind, 'compact');
  assert.equal(report.summary.transitions, 200);
  assert.equal(report.resources.unexpectedPlayback, 250);
  assert.equal(report.issues.length, 10);
  assert.equal(report.droppedIssues, 240);
  assert.equal(report.omittedTransitionDetails, 195);
  assert.equal(report.recentTransitions.length, 5);
  assert.equal(report.recentTransitions[4].activation, 249);
  assert.equal(report.droppedTransitions, 50);
  assert.ok(JSON.stringify(report).length < 10000, 'avoid the observed clipping threshold');
  report.issues[0].publicationId = -1;
  assert.notEqual(diagnostics.shareReport().issues[0].publicationId, -1);
});

test('compact failures and transitions keep feed context after progress rolls context events out', () => {
  const diagnostics = new PlaybackDiagnostics();
  const channel = diagnostics.session();
  channel({ type: 'context', feedContext: 'space:4', authGeneration: 2 });
  channel({ type: 'selection', activation: 1, publicationId: 9 });
  channel({ type: 'release', livePlayers: 0 });
  const global = diagnostics.session();
  global({ type: 'context', feedContext: 'global', authGeneration: 2 });
  global({ type: 'selection', activation: 1, publicationId: 9 });
  for (let i = 0; i < 1100; i++) global({ type: 'progress', currentTime: i / 4 });
  global({ type: 'error', activation: 1, publicationId: 9, failureKind: 'native_error', nativeErrorDomain: 'NSURLErrorDomain', nativeErrorCode: -1009 });
  const report = diagnostics.shareReport();
  assert.equal(report.issues[0].feedContext, 'global');
  assert.equal(report.issues[0].authGeneration, 2);
  assert.equal(report.issues[0].nativeErrorCode, -1009);
  assert.deepEqual(report.recentTransitions.map(row => row.feedContext), ['space:4', 'global']);
});

test('cold transition retains distinct replacement and readiness timings after event rollover', () => {
  let now = 0;
  const diagnostics = new PlaybackDiagnostics(() => now);
  const record = diagnostics.session();
  record({ type: 'selection', activation: 1, publicationId: 1 });
  now = 5; record({ type: 'load_started', publicationId: 1 });
  now = 1000; record({ type: 'load_resolved', publicationId: 1 });
  now = 2500; record({ type: 'ready', publicationId: 1 });
  now = 3000; record({ type: 'load_started', publicationId: 2 });
  now = 4000; record({ type: 'load_resolved', publicationId: 2 });
  now = 4500; record({ type: 'selection', activation: 2, publicationId: 2, prepared: false });
  now = 7000; record({ type: 'ready', publicationId: 2 });
  now = 7100; record({ type: 'first_frame', activation: 2 });
  record({ type: 'release', publicationId: 1 });
  record({ type: 'release', publicationId: 2 });
  for (let activation = 3; activation <= 10; activation++) {
    record({ type: 'selection', activation, publicationId: activation, prepared: true });
    record({ type: 'first_frame', activation });
  }
  for (let i = 0; i < 1100; i++) record({ type: 'progress', activation: 10, currentTime: i / 4 });
  const report = diagnostics.shareReport();
  assert.equal(report.recentTransitions.some(row => row.publicationId === 2), false);
  assert.equal(report.slowTransitions[0].publicationId, 2);
  assert.equal(report.slowTransitions[0].firstFrameMs, 2600);
  assert.deepEqual(report.slowTransitions[0].sourceLoad, { startedAtMs: 3000, replaceResolvedMs: 1000, readyMs: 4000 });
  assert.equal(report.omittedTransitionDetails, 4, 'count unique recent and outlier rows');
  assert.equal(report.omittedSlowTransitionDetails, 0);
  assert.ok(diagnostics.report().events.every(row => row.type !== 'load_started'));
  report.slowTransitions[0].sourceLoad!.readyMs = -1;
  assert.equal(diagnostics.shareReport().slowTransitions[0].sourceLoad!.readyMs, 4000);
});

test('retry/revisit and different sessions never reuse old source load timings', () => {
  let now = 0;
  const diagnostics = new PlaybackDiagnostics(() => now);
  const record = diagnostics.session();
  record({ type: 'selection', publicationId: 1, activation: 1 });
  record({ type: 'load_started', publicationId: 1 });
  now = 100; record({ type: 'load_resolved', publicationId: 1 });
  now = 200; record({ type: 'ready', publicationId: 1 });
  record({ type: 'release', publicationId: 1 });
  record({ type: 'selection', publicationId: 1, activation: 2 });
  now = 300; record({ type: 'load_started', publicationId: 1 });
  now = 800; record({ type: 'load_resolved', publicationId: 1 });
  now = 900; record({ type: 'ready', publicationId: 1 });
  // A speculative reload of a past publication must not rewrite its history.
  record({ type: 'release', publicationId: 1 });
  record({ type: 'selection', publicationId: 2, activation: 3 });
  now = 1000; record({ type: 'load_started', publicationId: 1 });
  const otherSession = diagnostics.session();
  otherSession({ type: 'selection', publicationId: 1, activation: 1 });
  const rows = diagnostics.report().transitions;
  assert.deepEqual(rows[0].sourceLoad, { startedAtMs: 0, replaceResolvedMs: 100, readyMs: 200 });
  assert.deepEqual(rows[1].sourceLoad, { startedAtMs: 300, replaceResolvedMs: 500, readyMs: 600 });
  assert.equal(rows[2].sourceLoad, undefined);
  assert.equal(rows[3].sourceLoad, undefined);
});

test('compact outliers are bounded, include incomplete selections, and stay small with load timings', () => {
  let now = 123456789.123456;
  const diagnostics = new PlaybackDiagnostics(() => now);
  const record = diagnostics.session();
  record({ type: 'context', feedContext: 'space:123456789', authGeneration: 12345 });
  for (let activation = 1; activation <= 220; activation++) {
    record({ type: 'selection', activation, publicationId: activation });
    record({ type: 'load_started', publicationId: activation });
    now += 4000;
    record({ type: 'load_resolved', publicationId: activation });
    record({ type: 'ready', publicationId: activation });
    if (activation !== 219) record({ type: 'first_frame', activation });
    record({ type: 'release', publicationId: activation });
    record({ type: 'unexpected_playback', activation, publicationId: activation, selectedPublicationId: activation,
      appActive: true, screenEligible: true, scrolling: true, userPaused: false, reason: 'ineligible' });
  }
  const report = diagnostics.shareReport();
  assert.equal(report.slowTransitions.length, 5);
  assert.equal(report.slowTransitions[0].activation, 219);
  assert.equal(report.slowTransitions[0].firstFrameMs, null);
  assert.equal(report.omittedSlowTransitionDetails, 195);
  assert.equal(report.droppedTransitions, 20);
  assert.ok(JSON.stringify(report).length < 10000, 'retain the compact export clipping budget');
});

test('transferring ownership ends the old live source timing while retaining its completed transition history',()=>{
 let now=0;const d=new PlaybackDiagnostics(()=>now),old=d.session(),next=d.session();
 old({type:'selection',publicationId:1,activation:1});old({type:'allocation',publicationId:1,livePlayers:1});old({type:'load_started',publicationId:1});now=10;old({type:'load_resolved',publicationId:1});now=20;old({type:'ready',publicationId:1});
 old({type:'transfer_out',publicationId:1,livePlayers:0});next({type:'transfer_in',publicationId:2,livePlayers:1});
 old({type:'selection',publicationId:1,activation:2});
 const report=d.report();assert.deepEqual(report.transitions[0].sourceLoad,{startedAtMs:0,replaceResolvedMs:10,readyMs:20});assert.equal(report.transitions[1].sourceLoad,undefined);assert.equal(report.resources.allocations,1);assert.equal(report.resources.releases,0);assert.equal(report.resources.livePlayers,1);assert.equal(report.resources.peakPlayers,1);
});

test('access diagnostics are bounded, numeric and allowlisted without tokens or URLs',()=>{
 const d=new PlaybackDiagnostics(()=>10);
 for(let n=0;n<205;n++)d.accessEvent({event:'http',scope:'publication',durationMs:n,httpStatus:503,token:'private-token',url:'https://private.invalid',members:['private']} as any);
 const report=d.report();assert.equal(report.access.length,200);assert.equal(report.droppedAccessRecords,5);
 assert.equal(JSON.stringify(report).includes('private'),false);assert.equal(d.shareReport().access.length,10);assert.equal(d.shareReport().omittedAccessDetails,190);
 const snapshot=report.access[0].durationMs;report.access[0].durationMs=999;assert.equal(d.report().access[0].durationMs,snapshot);
 d.reset();assert.equal(d.report().access.length,0);assert.equal(d.report().droppedAccessRecords,0);
});
