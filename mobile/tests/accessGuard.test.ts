import test from 'node:test';
import assert from 'node:assert/strict';
import { AccessGuard } from '../src/auth/accessGuard';
import { ApiError } from '../src/api/client';
import { PlayerBudget } from '../src/playback/playerBudget';

const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};};
test('protected access is withheld until validation completes and backgrounding discards late success',async()=>{
  const gate=deferred();const guard=new AccessGuard(()=>gate.promise,()=>{});
  guard.setActive(true);const pending=guard.check();assert.equal(guard.getSnapshot().checking,true);assert.equal(guard.getSnapshot().authorized,false);
  guard.setActive(false);gate.resolve();assert.equal(await pending,false);assert.equal(guard.getSnapshot().authorized,false);
});
test('foreground/retry and explicit checks coalesce while pausing eligibility',async()=>{
  let checks=0;const guard=new AccessGuard(async()=>{checks++;},()=>{});
  guard.setActive(true);await guard.check();assert.equal(guard.getSnapshot().authorized,true);
  const one=guard.check(),two=guard.check();assert.equal(one,two);assert.equal(guard.getSnapshot().authorized,false);
  await one;assert.equal(checks,2);assert.equal(guard.getSnapshot().authorized,true);guard.dispose();
});
test('space denial clears through its callback and transient network failure stays retryable',async()=>{
  let fail=403,denials=0;
  const guard=new AccessGuard(async()=>{if(fail)throw new ApiError('cannot access',fail);},()=>{denials++;});
  guard.setActive(true);await guard.check();assert.equal(denials,1);assert.equal(guard.getSnapshot().authorized,false);
  fail=503;await guard.check();assert.equal(denials,1);assert.ok(guard.getSnapshot().error);
  fail=0;await guard.check();assert.equal(guard.getSnapshot().authorized,true);guard.dispose();
});
test('a disposed context cannot publish its validation result into a replacement',async()=>{
  const gate=deferred();const old=new AccessGuard(()=>gate.promise,()=>{throw Error('stale denial');});old.setActive(true);const p=old.check();old.dispose();
  const current=new AccessGuard(async()=>{},()=>{});current.setActive(true);await current.check();gate.resolve();await p;
  assert.equal(old.getSnapshot().authorized,false);assert.equal(current.getSnapshot().authorized,true);current.dispose();
});
test('app-wide player budget caps live native allocations and recovers after factory/release failures',()=>{
  const budget=new PlayerBudget();const a=budget.acquire(()=>1,()=>{}),b=budget.acquire(()=>2,()=>{}),c=budget.acquire(()=>3,()=>{});
  assert.throws(()=>budget.acquire(()=>4,()=>{}));assert.equal(budget.count,3);a.release();a.release();assert.equal(budget.count,2);
  assert.throws(()=>budget.acquire(()=>{throw Error('allocation');},()=>{}));assert.equal(budget.count,2);
  const failed=budget.acquire(()=>4,()=>{throw Error('release');});assert.throws(failed.release);assert.equal(budget.count,2);b.release();c.release();assert.equal(budget.count,0);
});
