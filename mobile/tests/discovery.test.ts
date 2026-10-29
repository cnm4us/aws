import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptCard,adaptEntry,adaptResume} from '../src/discovery/api';
import {ResumeWriter} from '../src/discovery/resumeWriter';
import {ApiError} from '../src/api/client';
const checkpoint={publicationId:1,productionUlid:'01J00000000000000000000000',positionSeconds:7,userPaused:true};
const card={id:9,name:'A space',slug:'a-space',type:'group',global:false,path:'/groups/a-space',description:null,artworkUrl:null,saved:false,requiresSignIn:false};
test('discovery adapters copy only safe fields and reject unsupported navigation/artwork/identity',()=>{
  assert.equal((adaptCard({...card,token:'PRIVATE'}) as any).token,undefined);
  for(const changed of [{path:'https://other.test/'},{artworkUrl:'/api/private/image'},{id:'9'},{saved:1}])assert.throws(()=>adaptCard({...card,...changed}));
  assert.throws(()=>adaptResume({revision:1,outcome:'restored',checkpoint:{...checkpoint,positionSeconds:NaN}}));
  const document={name:'A space',welcome:'Welcome',purpose:null,cultures:[],rules:[]};
  const entry=adaptEntry({schemaVersion:1,space:card,document,revision:'a'.repeat(64),canView:true,requiresSignIn:false,requiresAcknowledgment:true,acknowledgmentEnabled:true,accepted:false,ai:'SECRET'});
  assert.equal((entry as any).ai,undefined);assert.equal(entry.requiresAcknowledgment,true);
});
test('resume writes serialize CAS revisions, drop conflicting work and stop at identity replacement',async()=>{
  let revision=0,valid=true,conflict=false;const writes:any[]=[];
  const writer=new ResumeWriter({getJson:async()=>({revision,outcome:'new',checkpoint:null}),postJson:async(_path,body:any)=>{writes.push(body);if(conflict){conflict=false;revision=8;throw new ApiError('Conflict',409,'resume_conflict')}assert.equal(body.revision,revision);return {revision:++revision};}},()=>valid);
  await writer.write('9',checkpoint);await writer.write('9',{...checkpoint,positionSeconds:8});
  assert.deepEqual(writes.map(w=>w.revision),[0,1]);
  conflict=true;await writer.write('9',{...checkpoint,positionSeconds:9});assert.equal(writes.length,3);
  await writer.write('9',{...checkpoint,positionSeconds:10});assert.equal(writes[3].revision,8);
  valid=false;await writer.write('9',{...checkpoint,positionSeconds:11});assert.equal(writes.length,4);writer.dispose();
});
test('late resume reads do not make a disposed/account-replaced writer send state',async()=>{
  let resolve!:(value:unknown)=>void,writes=0;
  const writer=new ResumeWriter({getJson:()=>new Promise(r=>{resolve=r}),postJson:async()=>{writes++;return {revision:1}}},()=>true);
  const pending=writer.write('global',checkpoint);writer.dispose();resolve({revision:0,outcome:'new',checkpoint:null});await pending;assert.equal(writes,0);
});
