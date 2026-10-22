import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaptionClock } from '../src/playback/captionClock';
import { cueAt, parseVtt } from '../src/content/vtt';

test('release clock samples selected current time and restores zero interval without diagnostics', () => {
  let callback: ((value: { currentTime: number }) => void) | null = null, subscriptions = 0;
  const source = { currentTime: 2, timeUpdateEventInterval: 0, addListener: (_event: 'timeUpdate', fn: (value: { currentTime: number }) => void) => {
    subscriptions++; callback = fn; return { remove: () => { subscriptions--; callback = null; } };
  } };
  const clock = createCaptionClock(source, 0), seen: number[] = [];
  for (let i = 0; i < 100; i++) {
    const stop = clock.subscribe(time => seen.push(time));
    assert.equal(source.timeUpdateEventInterval, .25); assert.equal(subscriptions, 1); assert.equal(seen.at(-1), 2);
    callback!({ currentTime: .25 }); assert.equal(seen.at(-1), .25);
    stop(); assert.equal(subscriptions, 0); assert.equal(source.timeUpdateEventInterval, 0);
  }
  const stop = clock.subscribe(time => seen.push(time)), queued = callback!, count = seen.length;
  clock.dispose(); queued({ currentTime: 9 }); stop(); assert.equal(seen.length, count); assert.equal(subscriptions, 0);
});
test('diagnostic interval is retained after captions detach; cue changes follow media time including pause/loop/seek', () => {
  let callback: ((value: { currentTime: number }) => void) | null = null;
  const source = { currentTime: 0, timeUpdateEventInterval: .25, addListener: (_event: 'timeUpdate', fn: (value: { currentTime: number }) => void) => {
    callback = fn; return { remove: () => { callback = null; } };
  } };
  const clock = createCaptionClock(source, .25), cues = parseVtt('WEBVTT\n\n00:00.000 --> 00:01.000\nFirst full sentence\n\n00:02.000 --> 00:03.000\nSecond full sentence');
  let text: string | null = null;
  const stop = clock.subscribe(t => { text = cueAt(cues, t); }); assert.equal(text, 'First full sentence');
  for (let i = 0; i < 10; i++) callback!({ currentTime: .5 }); assert.equal(text, 'First full sentence');
  callback!({ currentTime: 2.25 }); assert.equal(text, 'Second full sentence');
  callback!({ currentTime: 0 }); assert.equal(text, 'First full sentence');
  callback!({ currentTime: 1.5 }); assert.equal(text, null);
  stop(); assert.equal(source.timeUpdateEventInterval, .25);
});

test('native clock subscription failure rolls back its listener and interval', () => {
  const source = { currentTime: 0, timeUpdateEventInterval: 0, addListener: () => { throw Error('native unavailable'); } };
  const clock = createCaptionClock(source, 0);
  assert.throws(() => clock.subscribe(() => {})); assert.equal(source.timeUpdateEventInterval, 0);
  clock.dispose();
});
