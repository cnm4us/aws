import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, cpSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readBuildPolicy, sanitizeBuildIdentity } from '../src/config/buildPolicy';

test('internal diagnostics require the exact build kind and opt-in; ordinary Release is inert', () => {
  assert.deepEqual(readBuildPolicy(true), { kind: 'development', diagnostics: true });
  assert.deepEqual(readBuildPolicy(false, 'internal-preview', '1'), { kind: 'internal-preview', diagnostics: true });
  for (const kind of [undefined, '', 'production', 'release', 'development', 'internal-preview ']) {
    assert.deepEqual(readBuildPolicy(false, kind, '1'), { kind: 'release', diagnostics: false });
  }
  for (const flag of [undefined, '', 'true', '0', '01', '1 ']) assert.equal(readBuildPolicy(false, 'internal-preview', flag).diagnostics, false);
});

test('report identity copies only bounded public values and ignores arbitrary secrets', () => {
  const safe = { kind: 'internal-preview', diagnostics: true, appVersion: '0.1.0', appBuild: '2', sourceId: 'a'.repeat(64) };
  assert.deepEqual(sanitizeBuildIdentity({ ...safe, token: 'secret', url: 'https://private.test', text: 'private story' }), safe);
  assert.deepEqual(sanitizeBuildIdentity({ ...safe, appVersion: 'secret', appBuild: '9'.repeat(100), sourceId: 'https://private.test' }),
    { kind: 'internal-preview', diagnostics: true });
  assert.equal(sanitizeBuildIdentity({ kind: 'private', diagnostics: true }), undefined);
  assert.equal(sanitizeBuildIdentity(null), undefined);
});

test('preview digest identifies included dirty source and ignores its generated stamp/local state', () => {
  const require = createRequire(import.meta.url);
  const { identify } = require('../scripts/preview-build.cjs');
  const root = resolve(import.meta.dirname, '..'), temp = mkdtempSync(join(tmpdir(), 'viewer-identity-'));
  try {
    const source = identify(root);
    for (const { file } of source.inputs) cpSync(join(root, file), join(temp, file), { recursive: true });
    assert.deepEqual(identify(temp), source);
    writeFileSync(join(temp, '.env'), 'DO_NOT_INCLUDE=secret');
    writeFileSync(join(temp, 'src/config/buildIdentity.json'), '{"sourceId":"different"}');
    assert.deepEqual(identify(temp), source);
    writeFileSync(join(temp, 'App.tsx'), readFileSync(join(temp, 'App.tsx'), 'utf8') + '\n// included edit\n');
    assert.notEqual(identify(temp).sourceId, source.sourceId);
    assert.ok(!JSON.stringify(source).includes('DO_NOT_INCLUDE'));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
