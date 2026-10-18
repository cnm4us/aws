import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { buildServer } from '../src/app';
import { getPool } from '../src/db';
import { seedNativeViewerFixtures } from './native-viewer-fixtures';
import { ensureNativeSessionSchema } from '../src/features/native-sessions/schema';

async function main() {
  process.env.NATIVE_SESSIONS_ENABLED='1';process.env.NATIVE_ALLOW_INSECURE_LOOPBACK='1';
  await ensureNativeSessionSchema(getPool());await ensureNativeSessionSchema(getPool());
  const f=await seedNativeViewerFixtures();
  const server=buildServer().listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${(server.address() as any).port}`;
  let checks=0;
  const check=(actual:any,expected:any)=>{assert.deepEqual(actual,expected);checks++;};
  const login=async()=>{
    const r=await fetch(`${base}/api/native/v1/session`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(f.users.a)});
    check(r.status,201);check(r.headers.get('set-cookie'),null);return await r.json() as any;
  };
  const get=async(path:string,token:string)=>fetch(base+path,{headers:{authorization:`Bearer ${token}`}});
  try {
    const n=await login();check((await get('/api/native/v1/session',n.token)).status,200);
    const [rows]=await getPool().query('SELECT token_hash FROM native_sessions WHERE token_hash=?',[createHash('sha256').update(n.token).digest()]);
    check((rows as any[]).length,1);check(Buffer.isBuffer((rows as any[])[0].token_hash),true);
    check((await(await get('/api/me',n.token)).json() as any).userId,null);
    check((await get('/api/uploads/summary',n.token)).status,401);
    check((await get('/api/admin/users',n.token)).status,401);
    const browser=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(f.users.a)});
    check(browser.status,200);const cookie=browser.headers.getSetCookie().map(h=>h.split(';')[0]).join('; ');
    check((await(await fetch(base+'/api/me',{headers:{cookie}})).json() as any).userId,f.users.a.id);
    const csrf=/csrf=([^;]+)/.exec(cookie)![1];
    const mutation={method:'PUT',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({slug:`native-fixture-${f.users.a.id}`})};
    check((await fetch(base+'/api/profile/slug',mutation)).status,403);
    const [before]=await getPool().query('SELECT slug FROM users WHERE id=?',[f.users.a.id]);
    try {check((await fetch(base+'/api/profile/slug',{...mutation,headers:{...mutation.headers,'x-csrf-token':csrf}})).status,200);}
    finally {await getPool().query('UPDATE users SET slug=? WHERE id=?',[(before as any[])[0].slug,f.users.a.id]);}
    check((await fetch(base+'/api/native/v1/session',{method:'DELETE',headers:{authorization:`Bearer ${n.token}`}})).status,204);
    check((await get('/api/native/v1/session',n.token)).status,401);
    check((await(await fetch(base+'/api/me',{headers:{cookie}})).json() as any).userId,f.users.a.id);
    const expired=await login();await getPool().query('UPDATE native_sessions SET expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE token_hash=?',[createHash('sha256').update(expired.token).digest()]);
    check((await get('/api/native/v1/session',expired.token)).status,401);
    const changed=await login();const [u]=await getPool().query('SELECT password_hash FROM users WHERE id=?',[f.users.a.id]);
    try {await getPool().query('UPDATE users SET password_hash=NULL WHERE id=?',[f.users.a.id]);check((await get('/api/native/v1/session',changed.token)).status,401);}
    finally {await getPool().query('UPDATE users SET password_hash=? WHERE id=?',[(u as any[])[0].password_hash,f.users.a.id]);}
    try {
      await getPool().query('UPDATE users SET deleted_at=NOW() WHERE id=?',[f.users.a.id]);check((await get('/api/native/v1/session',changed.token)).status,401);
      check((await(await fetch(base+'/api/me',{headers:{cookie}})).json() as any).userId,null);
    }
    finally {await getPool().query('UPDATE users SET deleted_at=NULL WHERE id=?',[f.users.a.id]);}
    await fetch(base+'/logout',{headers:{cookie}});
    check((await(await fetch(base+'/api/me',{headers:{cookie}})).json() as any).userId,null);
    console.log(JSON.stringify({nativeSessionIntegration:'passed',checks,rawCredentialsExported:false}));
  } finally {
    await getPool().query('UPDATE native_sessions SET revoked_at=NOW() WHERE user_id IN (?,?) AND revoked_at IS NULL',[f.users.a.id,f.users.b.id]);
    server.close();server.closeAllConnections();await getPool().end();
  }
}
main().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
