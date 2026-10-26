import test from 'node:test';
import assert from 'node:assert/strict';
import { RecoveryCoordinator } from '../src/feed/recoveryCoordinator';
test('repeated Retry coalesces reads and route cancellation prevents a late media reload',async()=>{
 const recovery=new RecoveryCoordinator();let complete!:(ok:boolean)=>void,reads=0,reloads=0;
 const read=()=>{reads++;return new Promise<boolean>(r=>complete=r);};
 const a=recovery.run(read,()=>reloads++),b=recovery.run(read,()=>reloads++);assert.equal(a,b);await Promise.resolve();assert.equal(reads,1);
 recovery.cancel();complete(true);assert.equal(await a,false);assert.equal(reloads,0);
 assert.equal(await recovery.run(async()=>true,()=>reloads++),true);assert.equal(reloads,1);
 assert.equal(await recovery.run(async()=>false,()=>reloads++),false);assert.equal(reloads,1);
});
