import assert from 'node:assert/strict';
import test from 'node:test';
import { readEnvironment } from '../src/config/environment';

test('normalizes an HTTPS API prefix without copying secrets', () => {
  assert.deepEqual(readEnvironment(' https://example.com/service/// '), {
    ok: true, value: { apiBaseUrl: 'https://example.com/service' },
  });
});

test('rejects absent, non-HTTPS, credential-bearing, or phone-local configuration', () => {
  for (const value of ['', ' ', 'not-a-url', 'http://example.com', 'https://user:secret@example.com',
    'https://example.com?token=secret', 'https://example.com/#fragment',
    'https://localhost:3300', 'https://127.0.0.1:3300', 'https://[::1]:3300']) {
    const result = readEnvironment(value);
    assert.equal(result.ok, false, value);
    if (!result.ok) assert.ok(!result.message.includes('secret'));
  }
});
