import assert from 'node:assert/strict';
import { once } from 'node:events';
import { buildServer } from '../src/app';
import { getPool } from '../src/db';
import { seedNativeViewerFixtures } from './native-viewer-fixtures';

async function main() {
  process.env.NATIVE_SESSIONS_ENABLED='1';process.env.NATIVE_ALLOW_INSECURE_LOOPBACK='1';
  const f=await seedNativeViewerFixtures();const db=getPool();
  const server=buildServer().listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${(server.address() as any).port}`;
  let checks=0;const eq=(a:any,b:any)=>{try{assert.deepEqual(a,b);}catch{throw Error(`check ${checks+1}: ${JSON.stringify({expected:b,actual:a})}`)}checks++;};
  const call=async(path:string,headers:Record<string,string>={})=>{
    const r=await fetch(base+path,{headers});eq(r.headers.get('cache-control'),'no-store');
    return {status:r.status,body:await r.json() as any};
  };
  try {
    const anonymous=await call('/api/viewer/v1/feed/global');eq(anonymous.status,200);eq(anonymous.body.context,{kind:'global'});
    eq((await call('/api/viewer/v1/me/spaces')).status,401);
    const r=await fetch(base+'/api/native/v1/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(f.users.a)});
    eq(r.status,201);const n=await r.json() as any;const auth={authorization:`Bearer ${n.token}`};
    const b=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(f.users.a)});
    const cookie={cookie:b.headers.getSetCookie().map(h=>h.split(';')[0]).join('; ')};
    const matrix=[];
    for (const [label,id] of Object.entries(f.spaces)) {
      const denied=['personalB','groupB','banned'].includes(label);const path=`/api/viewer/v1/spaces/${id}/feed?limit=5`;
      const native=await call(path,auth),web=await call(path,cookie);
      eq(native.status,denied?403:200);eq(web.status,native.status);
      if (denied) {eq(Object.keys(native.body),['error']);} else {
        eq(native.body.context.space.id,id);eq(native.body.items.map((x:any)=>x.publicationId),web.body.items.map((x:any)=>x.publicationId));
        for(const item of native.body.items) {
          eq(Object.keys(item).sort(),['publicationId','uploadId','spaceId','productionUlid','playbackUrl','posterUrl','creator','description','width','height','durationSeconds','hasStory','storyPreview','hasCaptions'].sort());
          eq(Object.keys(item.creator).sort(),['id','displayName','avatarUrl'].sort());
        }
      }
      matrix.push({label,status:native.status});
    }
    const mine=await call('/api/viewer/v1/me/spaces',auth);eq(mine.body.personal.id,f.spaces.personalA);eq(mine.body.groups.some((s:any)=>s.id===f.spaces.groupB),false);
    const second=await fetch(base+'/api/native/v1/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(f.users.b)});
    eq(second.status,201);const secondSession=await second.json() as any;const secondAuth={authorization:`Bearer ${secondSession.token}`};
    try {
      const secondSpaces=await call('/api/viewer/v1/me/spaces',secondAuth);eq(secondSpaces.body.personal.id,f.spaces.personalB);
      eq(secondSpaces.body.groups.some((s:any)=>s.id===f.spaces.groupA),false);
      eq((await call(`/api/viewer/v1/spaces/${f.spaces.groupB}/feed`,secondAuth)).status,200);
      eq((await call(`/api/viewer/v1/spaces/${f.spaces.personalA}/feed`,secondAuth)).status,403);
      eq((await call('/api/viewer/v1/me/spaces',auth)).body.personal.id,f.spaces.personalA);
    }finally {await fetch(base+'/api/native/v1/session',{method:'DELETE',headers:secondAuth});}
    const page1=await call(`/api/viewer/v1/spaces/${f.spaces.groupA}/feed?limit=3`,auth);
    const page2=await call(`/api/viewer/v1/spaces/${f.spaces.groupA}/feed?limit=3&cursor=${encodeURIComponent(page1.body.nextCursor)}`,auth);
    eq(page2.status,200);eq(page2.body.items.some((i:any)=>page1.body.items.some((j:any)=>i.publicationId===j.publicationId)),false);
    const [pubs]=await db.query('SELECT id FROM space_publications WHERE space_id=? ORDER BY id DESC LIMIT 2',[f.spaces.public]);
    const [memberOnly,hidden]=(pubs as any[]).map(p=>p.id);
    try {
      await db.query("UPDATE space_publications SET visibility='members' WHERE id=?",[memberOnly]);
      await db.query('UPDATE space_publications SET visible_in_space=0 WHERE id=?',[hidden]);
      for(const path of [`/api/viewer/v1/spaces/${f.spaces.public}/feed`,`/api/spaces/${f.spaces.public}/feed`]) {
        const response=await fetch(base+path,{headers:cookie});const body=await response.json() as any;
        eq(body.items.some((i:any)=>[memberOnly,hidden].includes(i.publicationId??i.publication?.id)),false);
      }
      await db.query("UPDATE space_publications SET visibility='inherit',visible_in_space=1,status=IF(id=?,'pending','unpublished') WHERE id IN (?,?)",[memberOnly,memberOnly,hidden]);
      const unpublished=await call(`/api/viewer/v1/spaces/${f.spaces.public}/feed`,auth);
      eq(unpublished.body.items.some((i:any)=>[memberOnly,hidden].includes(i.publicationId)),false);
    } finally {await db.query("UPDATE space_publications SET status='published',visibility='inherit',visible_in_space=1 WHERE id IN (?,?)",[memberOnly,hidden]);}
    const [spaceBefore]=await db.query('SELECT settings FROM spaces WHERE id=?',[f.spaces.public]);
    const [memberRole]=await db.query("SELECT id FROM roles WHERE name='space_member' LIMIT 1");const roleId=(memberRole as any[])[0].id;
    try {
      // Exercise actual membership, without owner/public/subscriber shortcuts masking removal.
      await db.query('UPDATE spaces SET settings=? WHERE id=?',[JSON.stringify({visibility:'private'}),f.spaces.public]);
      await db.query('INSERT IGNORE INTO user_space_roles (user_id,space_id,role_id) VALUES (?,?,?)',[f.users.a.id,f.spaces.public,roleId]);
      const member=await call(`/api/viewer/v1/spaces/${f.spaces.public}/feed?limit=1`,auth);eq(member.status,200);
      await db.query('DELETE FROM user_space_roles WHERE user_id=? AND space_id=? AND role_id=?',[f.users.a.id,f.spaces.public,roleId]);
      eq((await call(`/api/viewer/v1/spaces/${f.spaces.public}/feed?cursor=${encodeURIComponent(member.body.nextCursor)}`,auth)).status,403);
      eq((await call('/api/viewer/v1/me/spaces',auth)).body.groups.some((s:any)=>s.id===f.spaces.public),false);
    } finally {
      await db.query('DELETE FROM user_space_roles WHERE user_id=? AND space_id=? AND role_id=?',[f.users.a.id,f.spaces.public,roleId]);
      await db.query('UPDATE spaces SET settings=? WHERE id=?',[(spaceBefore as any[])[0].settings,f.spaces.public]);
    }
    try {
      await db.query('UPDATE space_subscriptions SET ended_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE user_id=? AND space_id=?',[f.users.a.id,f.spaces.subscribed]);
      eq((await call(`/api/viewer/v1/spaces/${f.spaces.subscribed}/feed`,auth)).status,403);
      eq((await call('/api/viewer/v1/me/spaces',auth)).body.channels.some((s:any)=>s.id===f.spaces.subscribed),false);
    } finally {await db.query('UPDATE space_subscriptions SET ended_at=NULL WHERE user_id=? AND space_id=?',[f.users.a.id,f.spaces.subscribed]);}
    eq((await call('/api/viewer/v1/spaces/999999999/feed',auth)).status,404);
    eq((await call('/api/viewer/v1/feed/global?cursor=bad',auth)).status,400);
    eq((await call('/api/viewer/v1/feed/global',{authorization:'Bearer invalid'})).status,401);
    eq((await call('/api/viewer/v1/feed/global',{...cookie,...auth})).status,400);
    await fetch(base+'/api/native/v1/session',{method:'DELETE',headers:auth});
    eq((await call('/api/viewer/v1/feed/global',auth)).status,401);
    eq((await call('/api/viewer/v1/feed/global')).status,200);
    console.log(JSON.stringify({viewerIntegration:'passed',checks,matrix,media:'public test assets only'}));
  } finally {server.close();server.closeAllConnections();await db.end();}
}
main().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
