import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDiscoveryDescription, discoveryDescription } from '../../src/features/spaces/discoveryDescription';
test('space introduction is optional bounded plain text and projects only the declared field',()=>{
 assert.equal(validateDiscoveryDescription('  Community\nmoderation\u0000  '),'Community\nmoderation');
 for(const value of [false,4,{},[], 'x'.repeat(501)])assert.throws(()=>validateDiscoveryDescription(value),{status:400});
 assert.equal(validateDiscoveryDescription(null),null);assert.equal(validateDiscoveryDescription('  '),null);
 assert.equal(discoveryDescription({discoveryDescription:'hello',privateRule:'secret'}),'hello');
 assert.equal(discoveryDescription({description:'not the introduction'}),null);
 assert.equal(discoveryDescription(JSON.stringify({discoveryDescription:'x'.repeat(600)}))?.length,500);
});
