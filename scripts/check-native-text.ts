import assert from 'node:assert/strict';
import { once } from 'node:events';
import { buildServer } from '../src/app';
import { getPool } from '../src/db';
import { seedTextFixtures } from './native-text-fixtures';
import { ulidMonotonic } from '../src/utils/ulid';

async function main() {
  process.env.NATIVE_SESSIONS_ENABLED = '1'; process.env.NATIVE_ALLOW_INSECURE_LOOPBACK = '1';
  const f = await seedTextFixtures(), db = getPool(), tokens: string[] = [], cookies: string[] = [];
  const server = buildServer().listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  let checks = 0;
  const eq = (a: unknown, b: unknown) => assert.deepEqual(a, b, `text contract ${++checks}`);
  const call = async (path: string, headers: any = {}) => {
    const r = await fetch(base + path, { headers }); eq(r.headers.get('cache-control'), 'no-store');
    const isVtt = r.headers.get('content-type')?.startsWith('text/vtt');
    // Compare legacy text content independently of expiring identity transport metadata.
    const raw:any=isVtt?await r.text():await r.json();const responseBody:any=!isVtt&&raw&&typeof raw==='object'?(({access,...domain})=>domain)(raw):raw;
    return { status:r.status,body:responseBody };
  };
  const space = (label: string, id: number) => `/api/viewer/v1/spaces/${f.spaces[label]}/publications/${id}`;
  try {
    const login = await fetch(base + '/api/native/v1/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f.users.a) });
    eq(login.status, 201); const session: any = await login.json(); tokens.push(session.token);
    const auth = { authorization: `Bearer ${session.token}` };
    const browser = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f.users.a) });
    eq(browser.status, 200); const cookie = { cookie: browser.headers.getSetCookie().map(h => h.split(';')[0]).join('; ') }; cookies.push(cookie.cookie);
    const p = f.publications[0], origin = space('origin', p.origin), personal = space('personalB', p.personalB);
    const a = await call(origin + '/story', auth), b = await call(personal + '/story', auth);
    eq(a.status, 200); eq(b.status, 200); eq(a.body.storyText.startsWith('Origin story'), true); eq(b.body.storyText.startsWith('Personal story'), true);
    eq((await call(origin + '/story', cookie)).body, a.body);
    eq((await call(origin + '/story')).status, 401);
    eq((await call(origin + '/story', { authorization: 'Bearer bad' })).status, 401);
    eq((await call(origin + '/story', { ...auth, ...cookie })).status, 400);
    for (const id of ['0', '1.2', '9007199254740992']) eq((await call(`/api/viewer/v1/feed/global/publications/${id}/story`)).status, 400);
    eq((await call(space('origin', p.personalB) + '/story', auth)).body, { error: 'publication_not_found' });
    eq((await call(`/api/viewer/v1/feed/global/publications/${p.personalB}/story`, auth)).body, { error: 'publication_not_found' });
    const global = `/api/viewer/v1/feed/global/publications/${p.sourceGlobalId}`;
    eq((await call(global + '/story')).status, 200);
    eq((await call(global + '/story', { authorization: 'Bearer bad' })).status, 401);
    const vtt = await call(origin + '/captions.vtt', auth); eq(vtt.status, 200); eq(vtt.body.trimStart().startsWith('WEBVTT'), true);
    eq((await call(personal + '/captions.vtt', auth)).body, vtt.body);
    eq((await call(global + '/captions.vtt')).status, 200);
    eq((await call(space('origin', f.publications[1].origin) + '/captions.vtt', auth)).body, { error: 'captions_not_found' });
    eq((await call(space('origin', f.publications[2].origin) + '/story', auth)).body.storyText, null);
    const metadata = await call(`/api/viewer/v1/spaces/${f.spaces.origin}/feed`, auth);
    eq(metadata.status, 200); eq(metadata.body.items[0].hasStory, true); eq(metadata.body.items[0].hasCaptions, true);
    eq(Object.keys(metadata.body.items[0]).includes('storyText'), false);
    for (const column of ['visible_in_space', 'status']) {
      const value = column === 'visible_in_space' ? 0 : 'unpublished';
      await db.query(`UPDATE space_publications SET ${column}=? WHERE id=? AND space_id=?`, [value, p.origin, f.spaces.origin]);
      try { eq((await call(origin + '/story', auth)).body, { error: 'publication_not_found' }); eq((await call(origin + '/captions.vtt', auth)).status, 404); }
      finally { await db.query(`UPDATE space_publications SET ${column}=? WHERE id=? AND space_id=?`, [column === 'status' ? 'published' : 1, p.origin, f.spaces.origin]); }
    }
    const [roles]: any = await db.query('SELECT role_id FROM user_space_roles WHERE user_id=? AND space_id=?', [f.users.a.id, f.spaces.personalB]);
    await db.query('DELETE FROM user_space_roles WHERE user_id=? AND space_id=?', [f.users.a.id, f.spaces.personalB]);
    try {
      eq((await call(personal + '/story', auth)).status, 403); eq((await call(personal + '/captions.vtt', auth)).status, 403);
      eq((await call('/api/native/v1/session', auth)).status, 200);
    } finally { for (const role of roles) await db.query('INSERT IGNORE INTO user_space_roles(user_id,space_id,role_id) VALUES(?,?,?)', [f.users.a.id, f.spaces.personalB, role.role_id]); }
    eq((await call(personal + '/story', auth)).status, 200);
    const [ban]: any = await db.query("INSERT INTO suspensions(user_id,target_type,target_id,kind,degree,reason,created_by) VALUES(?,'space',?,'ban',1,'Plan 170 fixture access check',?)", [f.users.a.id, f.spaces.origin, f.users.b.id]);
    try { eq((await call(origin + '/story', auth)).status, 403); eq((await call(origin + '/captions.vtt', auth)).status, 403); }
    finally { await db.query('DELETE FROM suspensions WHERE id=? AND user_id=?', [ban.insertId, f.users.a.id]); }
    const [publicSpace]: any = await db.query("INSERT INTO spaces(type,owner_user_id,ulid,name,slug,settings) VALUES('group',?,?,'Text contract temporary',?,'{\"visibility\":\"public\"}')", [f.users.b.id, ulidMonotonic(), `text-contract-${ulidMonotonic()}`]);
    let temporaryPublication: number | null = null;
    try {
      const [pub]: any = await db.query(`INSERT INTO space_publications(upload_id,production_id,space_id,status,owner_user_id,visibility,visible_in_space,visible_in_global,published_at,story_text)
        SELECT upload_id,production_id,?,'published',owner_user_id,'members',1,0,NOW(),'Members only text' FROM space_publications WHERE id=? AND space_id=?`, [publicSpace.insertId, p.origin, f.spaces.origin]);
      temporaryPublication = Number(pub.insertId);
      const path = `/api/viewer/v1/spaces/${publicSpace.insertId}/publications/${temporaryPublication}`;
      eq((await call(path + '/story', auth)).body, { error: 'publication_not_found' });
      eq((await call(path + '/captions.vtt', auth)).status, 404);
      await db.query("UPDATE space_publications SET visibility='inherit' WHERE id=? AND space_id=?", [temporaryPublication, publicSpace.insertId]);
      eq((await call(path + '/story', auth)).body.storyText, 'Members only text');
    } finally {
      if (temporaryPublication) await db.query('DELETE FROM space_publications WHERE id=? AND space_id=?', [temporaryPublication, publicSpace.insertId]);
      await db.query('DELETE FROM spaces WHERE id=? AND owner_user_id=?', [publicSpace.insertId, f.users.b.id]);
    }
    // Existing owner editing/default propagation contracts remain functional on these isolated rows.
    const ownerLogin = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f.users.b) });
    eq(ownerLogin.status, 200);
    const ownerCookie = ownerLogin.headers.getSetCookie().map(h => h.split(';')[0]).join('; '); cookies.push(ownerCookie);
    const csrf = decodeURIComponent(ownerCookie.split('; ').find(h => h.startsWith('csrf='))?.slice(5) || '');
    const ownerHeaders = { cookie: ownerCookie, 'x-csrf-token': csrf, 'content-type': 'application/json' };
    try {
      const reset = await fetch(base + `/api/publications/${p.origin}/story/reset`, { method: 'POST', headers: ownerHeaders }); eq(reset.status, 200);
      eq((await call(origin + '/story', auth)).body.storyText, 'Production default must not replace the publication story');
      const edit = await fetch(base + `/api/publications/${p.origin}/story`, { method: 'PATCH', headers: ownerHeaders, body: JSON.stringify({ storyText: 'Fixture override' }) }); eq(edit.status, 200);
      eq((await call(origin + '/story', auth)).body.storyText, 'Fixture override');
    } finally { await db.query("UPDATE space_publications SET story_text=?,story_source='custom' WHERE id=? AND space_id=?", [a.body.storyText, p.origin, f.spaces.origin]); }
    // Supplied native credentials never authorize legacy publication-edit/read paths.
    eq((await fetch(base + `/api/publications/${p.origin}/story`, { headers: auth })).status, 401);
    await fetch(base + '/api/native/v1/session', { method: 'DELETE', headers: auth });
    eq((await call(personal + '/story', auth)).status, 401); eq((await call(personal + '/captions.vtt', auth)).status, 401);
    console.log(JSON.stringify({ textIntegration: 'passed', checks, vttBytes: Buffer.byteLength(vtt.body), scopedFixtureRestoration: 'passed' }));
  } finally {
    for (const token of tokens) await fetch(base + '/api/native/v1/session', { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
    for (const cookie of cookies) await fetch(base + '/logout', { headers: { cookie }, redirect: 'manual' });
    server.close(); server.closeAllConnections(); await db.end();
  }
}
main().catch(e => { console.error(e.code || e.message); process.exitCode = 1; });
