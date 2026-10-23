import test from 'node:test';
import assert from 'node:assert/strict';
import { VerifiedRefresh, type Verified } from '../src/auth/verifiedRefresh';
import { AccessGuard } from '../src/auth/accessGuard';
import { ApiError } from '../src/api/client';

const flush = async () => { for(let i=0;i<6;i++)await Promise.resolve(); };
for(const failure of [401,403,503])test(`quiet guard renewal retains authority until failure ${failure}, then Retry verifies afresh`,async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let now=0,calls=0,denied=0;
  let reject!:(error:Error)=>void;
  const guard=new AccessGuard(async()=>{calls++;if(calls===2)await new Promise<void>((_r,j)=>{reject=j;});},()=>denied++,()=>now);
  t.after(()=>{guard.dispose();t.mock.timers.reset();});
  guard.setActive(true);await guard.check();assert.equal(guard.getSnapshot().authorized,true);
  now=45_000;t.mock.timers.tick(45_000);await flush();
  assert.equal(calls,2);assert.equal(guard.getSnapshot().checking,true);assert.equal(guard.getSnapshot().authorized,true);
  reject(new ApiError('failed',failure));await flush();
  assert.equal(guard.getSnapshot().authorized,false);assert.equal(denied,failure===503?0:1);
  await guard.check();assert.equal(calls,3);assert.equal(guard.getSnapshot().authorized,true);
});
test('pending renewal expires at the original hard deadline, aborts and ignores late success',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let now=0,calls=0,resolve!:(sample:Verified<string>)=>void,signal!:AbortSignal;
  const refresh=new VerifiedRefresh<string>(async s=>{signal=s;calls++;if(calls===1)return{value:'protected',verifiedAt:now};return new Promise(r=>{resolve=r;});},{protected:true,now:()=>now});
  t.after(()=>{refresh.dispose();t.mock.timers.reset();});refresh.setActive(true);await flush();
  now=45_000;t.mock.timers.tick(45_000);await flush();assert.equal(refresh.getSnapshot().value,'protected');assert.equal(calls,2);
  now=59_999;t.mock.timers.tick(14_999);assert.equal(refresh.getSnapshot().value,'protected');
  now=60_000;t.mock.timers.tick(1);assert.equal(signal.aborted,true);assert.equal(refresh.getSnapshot().value,undefined);assert.match(refresh.getSnapshot().error!.message,/expired/);
  resolve({value:'late',verifiedAt:45_000});await flush();assert.equal(refresh.getSnapshot().value,undefined);
});
test('a cached verification keeps its original deadline and delayed completion cannot bypass expiry',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let now=55_000,resolve!:(sample:Verified<string>)=>void,calls=0;
  const refresh=new VerifiedRefresh<string>(async()=>{calls++;if(calls===1)return{value:'cached',verifiedAt:0};return new Promise(r=>resolve=r);},{protected:true,now:()=>now});
  t.after(()=>{refresh.dispose();t.mock.timers.reset();});refresh.setActive(true);await flush();
  assert.equal(refresh.getSnapshot().value,'cached');t.mock.timers.tick(0);await flush();assert.equal(calls,2);
  // Resolve before dispatching the expiry callback: completion must independently check the clock.
  now=60_001;resolve({value:'too late',verifiedAt:55_000});await flush();assert.equal(refresh.getSnapshot().value,undefined);
});
test('background/foreground invalidates a pending renewal and requires a new blocking verification',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let now=0,calls=0;
  const pending:{resolve:(sample:Verified<number>)=>void;signal:AbortSignal}[]=[];
  const refresh=new VerifiedRefresh<number>(signal=>{calls++;return new Promise(resolve=>pending.push({resolve,signal}));},{protected:true,now:()=>now});
  t.after(()=>{refresh.dispose();t.mock.timers.reset();});refresh.setActive(true);await flush();pending[0].resolve({value:1,verifiedAt:0});await flush();
  now=45_000;t.mock.timers.tick(45_000);await flush();assert.equal(refresh.getSnapshot().value,1);
  refresh.setActive(false);assert.equal(pending[1].signal.aborted,true);refresh.setActive(true);await flush();assert.equal(calls,3);assert.equal(refresh.getSnapshot().value,undefined);
  pending[1].resolve({value:99,verifiedAt:45_000});await flush();assert.equal(refresh.getSnapshot().value,undefined);
  pending[2].resolve({value:2,verifiedAt:45_000});await flush();assert.equal(refresh.getSnapshot().value,2);
});
test('explicit Refresh blocks even during a quiet request; repeated calls coalesce',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let now=0,calls=0,resolve!:(value:Verified<boolean>)=>void;
 const refresh=new VerifiedRefresh<boolean>(async()=>{calls++;if(calls===1)return{value:true,verifiedAt:now};return new Promise(r=>resolve=r);},{protected:true,now:()=>now});
 t.after(()=>{refresh.dispose();t.mock.timers.reset();});refresh.setActive(true);await flush();now=45_000;t.mock.timers.tick(45_000);await flush();
 assert.equal(refresh.getSnapshot().value,true);const one=refresh.refresh(),two=refresh.refresh();assert.equal(one,two);assert.equal(refresh.getSnapshot().value,undefined);assert.equal(calls,2);
 resolve({value:true,verifiedAt:45_000});assert.equal(await one,true);assert.equal(refresh.getSnapshot().value,true);
});
