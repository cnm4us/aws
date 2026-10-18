import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { once } from 'node:events';
import { createNativeSessionRouter } from '../../src/routes/native-session';
import * as sessions from '../../src/features/native-sessions/service';
import { verifyPassword } from '../../src/security/credentials';
import { sessionParse } from '../../src/middleware/sessionParse';

const token='nv1_'+'a'.repeat(64);
async function harness(overrides: Partial<typeof sessions>, run:(base:string)=>Promise<void>) {
  const deps={...sessions,nativeEnabled:()=>true,requireNativeTransport:()=>{},consumeLoginLimit:async()=>{},
    createNativeSession:async()=>({token,expiresAt:'2030-01-01T00:00:00.000Z',viewer:{id:1,displayName:'Viewer'}}),
    resolveNativeSession:async()=>({source:'native' as const,viewer:{id:1,displayName:'Viewer'},expiresAt:'2030-01-01T00:00:00.000Z'}),
    revokeNativeSession:async()=>{},...overrides};
  const app=express();app.use(express.json());app.use('/session',createNativeSessionRouter(deps));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  try {await run(`http://127.0.0.1:${(server.address() as any).port}/session`);}
  finally {server.close();server.closeAllConnections();}
}
test('native login returns JSON, no cookies, and validation never echoes a token',async()=>{
  await harness({},async base=>{
    const r=await fetch(base,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'a@example.invalid',password:'test-password'})});
    assert.equal(r.status,201);assert.equal(r.headers.get('set-cookie'),null);assert.equal(r.headers.get('cache-control'),'no-store');
    const v=await fetch(base,{headers:{authorization:`Bearer ${token}`}});const body=await v.json() as any;
    assert.equal(v.status,200);assert.equal(body.token,undefined);
    assert.equal((await fetch(base,{method:'DELETE',headers:{authorization:`Bearer ${token}`}})).status,204);
  });
});
test('missing and malformed bearer credentials cannot use the native session',async()=>{
  await harness({},async base=>{for(const auth of ['', 'Bearer invalid','Basic dGVzdA==']){
    assert.equal((await fetch(base,{headers:auth?{authorization:auth}:{}})).status,401);
    assert.equal((await fetch(base,{method:'DELETE',headers:auth?{authorization:auth}:{}})).status,401);
  }});
});
test('supplied cookie and bearer are ambiguous and login rejects ambient credentials',async()=>{
  await harness({},async base=>{
    assert.equal((await fetch(base,{headers:{authorization:`Bearer ${token}`,cookie:'sid=stale'}})).status,400);
    assert.equal((await fetch(base,{method:'POST',headers:{'content-type':'application/json',cookie:'sid=stale'},body:'{}'})).status,400);
  });
});
test('disabled sessions fail closed and preserve cache policy',async()=>{
  await harness({nativeEnabled:()=>false},async base=>{const r=await fetch(base);assert.equal(r.status,503);assert.equal(r.headers.get('cache-control'),'no-store');});
});
test('login limits produce Retry-After and do not verify another password',async()=>{
  let called=false;
  await harness({consumeLoginLimit:async()=>{throw new sessions.ViewerApiError(429,'rate_limited',60)},createNativeSession:async()=>{called=true;throw Error()}},async base=>{
    const r=await fetch(base,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'x',password:'y'})});
    assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'60');assert.equal(called,false);
  });
});
test('native errors sanitize store failures without exposing server details',async()=>{
  await harness({resolveNativeSession:async()=>{throw Error('database_password=do-not-expose')}},async base=>{
    const r=await fetch(base,{headers:{authorization:`Bearer ${token}`}});assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'service_unavailable'});
  });
});
test('expired/revoked login is explicit rather than an anonymous success',async()=>{
  await harness({resolveNativeSession:async()=>{throw new sessions.ViewerApiError(401,'unauthorized')}},async base=>{
    assert.equal((await fetch(base,{headers:{authorization:`Bearer ${token}`}})).status,401);
  });
});
test('invalid bodies and excessive credential fields are rejected',async()=>{
  await harness({},async base=>{for(const body of [{},{email:'x',password:5},{email:'x',password:'x'.repeat(1025)}]){
    assert.equal((await fetch(base,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).status,400);
  }});
});
test('password verification is compatible with s2, rejects corruption and unknown accounts',async()=>{
  const salt=crypto.randomBytes(16).toString('hex');const hash=crypto.scryptSync('password',salt,64).toString('hex');
  assert.equal(await verifyPassword('password',`s2$16384$${salt}$${hash}`),true);
  assert.equal(await verifyPassword('wrong',`s2$16384$${salt}$${hash}`),false);
  assert.equal(await verifyPassword('password','s2$999999999$x$y'),false);
  assert.equal(await verifyPassword('password',null),false);
});
test('forwarded transport is trusted only from explicitly configured loopback proxy',()=>{
  const prev=process.env.NATIVE_TRUST_LOOPBACK_PROXY;
  try {
    const req={secure:false,socket:{remoteAddress:'127.0.0.1'},headers:{'x-forwarded-proto':'https','x-forwarded-for':'spoofed, 192.0.2.10'}} as any;
    delete process.env.NATIVE_TRUST_LOOPBACK_PROXY;assert.equal(sessions.requestTransport(req).secure,false);
    process.env.NATIVE_TRUST_LOOPBACK_PROXY='1';assert.equal(sessions.requestTransport(req).ip,'192.0.2.10');assert.equal(sessions.requestTransport(req).secure,true);
    req.socket.remoteAddress='192.0.2.11';assert.equal(sessions.requestTransport(req).secure,false);
  } finally {if(prev===undefined) delete process.env.NATIVE_TRUST_LOOPBACK_PROXY;else process.env.NATIVE_TRUST_LOOPBACK_PROXY=prev;}
});
test('browser session-store failure is retryable rather than treated as invalid credentials',async()=>{
  const dbModule=require('../../src/db');const original=dbModule.getPool;
  dbModule.getPool=()=>({query:async()=>{throw Error('database unavailable');}});
  try {
    const req={headers:{cookie:'sid=valid-cookie'},path:'/api/viewer/v1/me/spaces'} as any;
    await sessionParse(req,{} as any,()=>{});assert.equal(req.sessionParseFailed,true);
    await assert.rejects(sessions.resolveViewer(req,true),(e:unknown)=>e instanceof sessions.ViewerApiError && e.status===503);
  }finally{dbModule.getPool=original;}
});
