import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {canonicalViewerUrl,spacePath} from '../../src/features/discovery/paths';
import {publicCulture,readerRevision,issueReceipt,validReceipt,ANONYMOUS_RECEIPT_AGE} from '../../src/features/discovery/policy';
import {createDefaultCultureDefinitionV1} from '../../src/features/cultures/defaults';

test('legacy Global links keep exact publication/range, diagnostics and fragment',()=>{
  const query='?pin=01J00000000000000000000000&publication_id=730&t=0&t_end=7&debug=network#context';
  assert.equal(canonicalViewerUrl('/'+query),'/global'+query);
  for(const p of ['/global/','/channels/global','/channels/global-feed/'])assert.equal(canonicalViewerUrl(p+query),'/global'+query);
  for(const p of ['/','/?campaign=abc','/?t=-1','/?publication_id=0','/groups/example?t=7','/admin','/global'])assert.equal(canonicalViewerUrl(p),null);
  assert.equal(spacePath({slug:'global-feed',type:'channel'}),'/global');
  assert.equal(spacePath({slug:'cooking & arts',type:'group'}),'/groups/cooking%20%26%20arts');
  assert.equal(spacePath({slug:'private-owner',type:'personal'}),'/personal');
  assert.equal(spacePath({slug:'global',type:'group'}),'/groups/global');
  assert.equal(spacePath({slug:'global',type:'personal'}),'/personal');
});
test('anonymous receipts are bounded and bind Global, current revision, expiry and secret',()=>{
  const secret=randomBytes(32),revision=readerRevision({welcome:'Welcome'}),now=100000;
  const token=issueReceipt(secret,29,revision,now);
  assert.ok(validReceipt(token,secret,29,revision,now));
  for(const args of [[secret,30,revision,now],[randomBytes(32),29,revision,now],[secret,29,'other',now],[secret,29,revision,now+ANONYMOUS_RECEIPT_AGE]] as const)
    assert.equal(validReceipt(token,args[0],args[1],args[2],args[3]),false);
  assert.equal(validReceipt(token.slice(0,-1)+'?',secret,29,revision,now),false);
  assert.equal(validReceipt('x'.repeat(513),secret,29,revision,now),false);
});
test('reader projection never exports internal AI or moderator fields and revisions track material text',()=>{
  const definition=createDefaultCultureDefinitionV1({cultureKey:'test',cultureName:'Friendly'});
  const source={id:1,name:'Friendly',description:null,definition_json:{...definition,summary:'Be welcoming.',internal_notes:'PRIVATE',ai_hint:'supportive_environment'}};
  const projected=publicCulture(source);
  assert.equal(projected.configured,true);assert.equal(projected.summary,'Be welcoming.');
  assert.ok(!JSON.stringify(projected).includes('PRIVATE'));assert.ok(!JSON.stringify(projected).includes('ai_hint'));
  assert.equal(readerRevision(projected),readerRevision(publicCulture({...source,definition_json:{...source.definition_json,internal_notes:'Changed private note'}})));
  assert.notEqual(readerRevision(projected),readerRevision(publicCulture({...source,definition_json:{...source.definition_json,summary:'New expectations.'}})));
  assert.equal(readerRevision({welcome:'# Hello\n\nBe **kind**.'}),readerRevision({welcome:'Hello\nBe kind.'}));
  assert.equal(publicCulture({...source,definition_json:'malformed'}).configured,false);
});

test('web resume persistence keeps simultaneous space changes in separate revision streams',async()=>{
  const {ResumePersistence}=await import('../../frontend/src/discovery/ResumePersistence');
  const writes:any[]=[];let finish!:()=>void;
  const persistence=new ResumePersistence(async(path,body:any)=>{
    if(path.endsWith('/resume'))return {revision:0,checkpoint:null,outcome:'new'};
    writes.push({path,body});if(path.includes('/global/'))await new Promise<void>(resolve=>{finish=resolve});return {revision:1};
  });
  const checkpoint={publicationId:1,productionUlid:'01J00000000000000000000000',positionSeconds:7,userPaused:true};
  const first=persistence.save('global',checkpoint);await new Promise(resolve=>setImmediate(resolve));
  await persistence.save('66',{...checkpoint,publicationId:2,positionSeconds:9});finish();await first;
  assert.equal(writes.length,2);assert.equal(writes[0].path,'/spaces/global/visit');assert.equal(writes[0].body.checkpoint.publicationId,1);
  assert.equal(writes[1].path,'/spaces/66/visit');assert.equal(writes[1].body.revision,0);assert.equal(writes[1].body.checkpoint.positionSeconds,9);
});
