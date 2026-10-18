import assert from 'node:assert/strict';
import test from 'node:test';
import { playerErrorDetails } from '../src/playback/playerError';

test('native error details retain only recognized domains and numeric codes', () => {
  assert.deepEqual(playerErrorDetails(new Error('Error Domain=AVFoundationErrorDomain Code=-11800 "Unknown error"')), {
    nativeErrorDomain: 'AVFoundationErrorDomain', nativeErrorCode: -11800,
  });
  assert.deepEqual(playerErrorDetails({ message: 'The operation could not be completed. (NSURLErrorDomain error -1009.) https://media.test/private?token=secret' }), {
    nativeErrorDomain: 'NSURLErrorDomain', nativeErrorCode: -1009,
  });
  for (const error of [null, 'secret', {}, { message: 'https://media.test/private?Signature=secret' }, new Error('UnrecognizedDomain error -5')]) {
    assert.deepEqual(playerErrorDetails(error), {});
  }
});
