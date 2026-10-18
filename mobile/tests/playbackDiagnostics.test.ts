import assert from 'node:assert/strict';
import test from 'node:test';
import { PlaybackDiagnostics } from '../src/diagnostics/playbackDiagnostics';

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
