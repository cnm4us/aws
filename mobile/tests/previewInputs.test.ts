import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const { identify } = createRequire(import.meta.url)('../scripts/preview-build.cjs');

test('preview identity includes local native module code/configuration and rejects private inputs before hashing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'viewer-native-inputs-'));
  try {
    mkdirSync(join(directory, 'scripts'));
    mkdirSync(join(directory, 'modules/readiness/ios'), {recursive:true});
    writeFileSync(join(directory, 'app.json'), JSON.stringify({expo:{version:'0.1.0',ios:{buildNumber:'27'}}}));
    writeFileSync(join(directory, 'scripts/preview-build.cjs'), '// public helper');
    writeFileSync(join(directory, 'modules/readiness/expo-module.config.json'), '{"platforms":["apple"]}');
    const swift = join(directory, 'modules/readiness/ios/Readiness.swift');
    writeFileSync(swift, '// native source v1');
    const first = identify(directory);
    assert.ok(first.inputs.some((entry:{file:string}) => entry.file==='modules/readiness/ios/Readiness.swift'));
    assert.ok(first.inputs.some((entry:{file:string}) => entry.file==='modules/readiness/expo-module.config.json'));
    writeFileSync(swift, '// native source v2');
    assert.notEqual(identify(directory).sourceId,first.sourceId);
    writeFileSync(join(directory, 'modules/readiness/.env'), 'FAKE_EXAMPLE=not-a-secret');
    assert.throws(()=>identify(directory),/Private or generated file/);
  } finally { rmSync(directory,{recursive:true,force:true}); }
});
