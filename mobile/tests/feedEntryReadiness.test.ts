import assert from 'node:assert/strict';
import test from 'node:test';
import { FeedEntryReadiness,type FeedEntryInput } from '../src/playback/feedEntryReadiness';
import type { NativeReadinessEvidence } from '../src/playback/readinessEvidence';
const flush=async()=>{for(let n=0;n<8;n++)await Promise.resolve();};
function setup(){
 let valid=true,active=true;const cancelled:string[]=[],work:Array<{attempt:string;seconds:number;resolve:(e:NativeReadinessEvidence)=>void;reject:(e:Error)=>void}>=[];
 const gate=new FeedEntryReadiness<object>({valid:()=>valid,active:()=>active,
  prepare:(_player,attempt,seconds)=>new Promise((resolve,reject)=>work.push({attempt,seconds,resolve,reject})),cancel:id=>cancelled.push(id)});
 const input:FeedEntryInput<object>={key:'source1:activation1',player:{},seconds:7,duration:20,sourceReady:true,hasFrame:false,failed:false,empty:false,enabled:true};
 const finish=(index=0,patch:Partial<NativeReadinessEvidence>={})=>{const w=work[index];w.resolve({attempt:w.attempt,kind:'target_decoded',targetSeconds:w.seconds,timelineSeconds:w.seconds,decodedFrameSeconds:w.seconds,seekCompletedMs:10,decodedFrameMs:20,width:720,height:1280,rate:0,muted:true,...patch});};
 return {gate,work,input,finish,cancelled,valid:(v:boolean)=>{valid=v;},active:(v:boolean)=>{active=v;}};
}
test('entry waits for completed source replacement, native target and the view frame; presentation is explicit',async()=>{
 const h=setup();try{
  h.gate.update({...h.input,sourceReady:false,hasFrame:true});assert.equal(h.work.length,0);assert.equal(h.gate.present(),false);
  h.gate.update({...h.input,hasFrame:true});assert.equal(h.work.length,1);assert.equal(h.gate.getSnapshot().phase,'preparing');
  h.finish();await flush();assert.equal(h.gate.getSnapshot().phase,'ready');assert.equal(h.gate.present(),true);assert.equal(h.gate.getSnapshot().phase,'presented');
  h.gate.update({...h.input,key:'next-slide',player:{}});assert.equal(h.work.length,1);assert.equal(h.gate.getSnapshot().phase,'presented');
 }finally{h.gate.dispose();}
});
test('decoded evidence cannot reveal before the independently delayed view frame',async()=>{
 const h=setup();try{h.gate.update(h.input);h.finish();await flush();assert.equal(h.gate.present(),false);
  h.gate.update({...h.input,hasFrame:true});assert.equal(h.gate.getSnapshot().phase,'ready');assert.equal(h.gate.present(),true);
 }finally{h.gate.dispose();}
});
test('source/activation replacement cancels old evidence and a late completion cannot satisfy the new entry',async()=>{
 const h=setup();try{h.gate.update(h.input);h.gate.update({...h.input,key:'source2:activation2',player:{},hasFrame:true});assert.equal(h.cancelled.length,1);
  h.finish(0);await flush();assert.equal(h.gate.getSnapshot().phase,'preparing');h.finish(1);await flush();assert.equal(h.gate.getSnapshot().phase,'ready');
 }finally{h.gate.dispose();}
});
test('authority is rechecked after decoding and immediately at presentation',async()=>{
 for(const atPresent of [false,true]){const h=setup();try{h.gate.update({...h.input,hasFrame:true});if(atPresent){h.finish();await flush();}
  h.valid(false);if(!atPresent){h.finish();await flush();}assert.equal(h.gate.present(),false);assert.equal(h.gate.getSnapshot().phase,'failed');
 }finally{h.gate.dispose();}}
});
test('cover/background cancels native work and foreground gets a fresh attempt',async()=>{
 const h=setup();try{h.gate.update(h.input);h.active(false);h.gate.update({...h.input,enabled:false});assert.equal(h.cancelled.length,1);
  h.finish();await flush();assert.equal(h.gate.getSnapshot().phase,'waiting');h.active(true);h.gate.update({...h.input,hasFrame:true});h.finish(1);await flush();assert.equal(h.gate.getSnapshot().phase,'ready');
 }finally{h.gate.dispose();}
});
test('source, frame and native stalls terminate with a retryable error and disposal cancels timers',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const part of ['source','native','frame']){const h=setup();h.gate.update({...h.input,sourceReady:part!=='source'});if(part==='frame'){h.finish();await flush();}
  t.mock.timers.tick(20000);assert.equal(h.gate.getSnapshot().phase,'failed');assert.equal(h.gate.present(),false);h.gate.dispose();}
 const h=setup();h.gate.update(h.input);h.gate.dispose();h.finish();await flush();t.mock.timers.tick(20000);assert.equal(h.gate.present(),false);assert.equal(h.cancelled.length,1);
});
test('stale/wrong-time/unmuted/native-playing evidence is rejected without exposing native error contents',async()=>{
 for(const patch of [{attempt:'old'},{decodedFrameSeconds:0},{timelineSeconds:0},{rate:1},{muted:false},{width:0}]){const h=setup();try{
  h.gate.update({...h.input,hasFrame:true});h.finish(0,patch);await flush();assert.equal(h.gate.getSnapshot().phase,'failed');
 }finally{h.gate.dispose();}}
 const h=setup();h.gate.update(h.input);h.work[0].reject(Error('https://private.invalid/secret'));await flush();assert.equal(h.gate.getSnapshot().phase,'failed');assert.ok(!h.gate.getSnapshot().error?.includes('https'));h.gate.dispose();
});
test('empty/unplayable feeds expose their normal actions without waiting for impossible video readiness',()=>{
 const h=setup();h.gate.update({...h.input,empty:true,failed:true,player:null});assert.equal(h.gate.present(),true);assert.equal(h.work.length,0);h.gate.dispose();
});
test('restored targets clamp to loaded duration',async()=>{
 const h=setup();h.gate.update({...h.input,duration:6,hasFrame:true});assert.equal(h.work[0].seconds,5.9);h.finish();await flush();assert.equal(h.gate.present(),true);h.gate.dispose();
});
