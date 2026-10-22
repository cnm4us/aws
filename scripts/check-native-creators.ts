import assert from 'node:assert/strict';
import { once } from 'node:events';
import { buildServer } from '../src/app';
import { getPool } from '../src/db';
import { seedCreatorFixtures } from './native-creator-fixtures';

async function main() {
  process.env.NATIVE_SESSIONS_ENABLED = '1'; process.env.NATIVE_ALLOW_INSECURE_LOOPBACK = '1';
  const f = await seedCreatorFixtures(), db = getPool();
  const server = buildServer().listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  let checks = 0;
  const eq = (actual: unknown, expected: unknown) => { assert.deepEqual(actual, expected, `creator contract check ${++checks}`); };
  const tokens: string[] = [];
  const call = async (path: string, headers: Record<string, string> = {}) => {
    const r = await fetch(base + path, { headers }); eq(r.headers.get('cache-control'), 'no-store');
    return { status: r.status, body: await r.json() as any };
  };
  const signIn = async (label: string) => {
    const r = await fetch(base + '/api/native/v1/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f.users[label]) });
    eq(r.status, 201); const session = await r.json() as any; tokens.push(session.token);
    return { authorization: `Bearer ${session.token}` };
  };
  try {
    const auth = await signIn('a'), owner = await signIn('b');
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f.users.a) });
    eq(login.status, 200);
    const cookie = { cookie: login.headers.getSetCookie().map(h => h.split(';')[0]).join('; ') };
    const creator = `/api/viewer/v1/creators/${f.users.b.id}`, feed = `/api/viewer/v1/spaces/${f.spaces.personalB}/feed`;
    const anonymous = await call(creator); eq(anonymous.status, 200); eq(anonymous.body.personalEntry, { state: 'sign_in_required' });
    eq(Object.keys(anonymous.body.creator).sort(), ['id', 'displayName', 'handle', 'avatarUrl', 'bio'].sort());
    eq((await call(creator, auth)).body.personalEntry.space.id, f.spaces.personalB);
    eq((await call(creator, cookie)).body, (await call(creator, auth)).body);
    eq((await call(creator, owner)).body.personalEntry.state, 'allowed');
    for (const label of ['hidden', 'missing']) {
      const r = await call(`/api/viewer/v1/creators/${f.users[label].id}`, auth); eq(r.status, 200);
      eq(r.body.creator.displayName, `Creator test ${label}`); eq(r.body.creator.bio, null); eq(r.body.creator.avatarUrl, null);
    }
    eq((await call(`/api/viewer/v1/creators/${f.users.deleted.id}`)).status, 404);
    eq((await call('/api/viewer/v1/creators/999999999')).status, 404);
    eq((await call('/api/viewer/v1/creators/1.2')).status, 400);
    eq((await call(creator, { authorization: 'Bearer bad' })).status, 401);
    eq((await call(creator, { ...auth, ...cookie })).status, 400);
    const empty = await call(`/api/viewer/v1/spaces/${f.spaces.empty}/feed`, auth); eq(empty.status, 200); eq(empty.body.items, []);
    const origin = await call(`/api/viewer/v1/spaces/${f.spaces.origin}/feed?limit=20`, auth);
    eq(origin.status, 200); eq(origin.body.items.every((i: any) => i.creator.id === f.users.b.id), true);
    const page = await call(feed + '?limit=5', auth); eq(page.status, 200);
    const selected = page.body.items[2].publicationId;
    const restored = await call(feed + `?anchorPublicationId=${selected}&limit=6`, auth);
    eq(restored.body.resume, { requestedPublicationId: selected, restoredPublicationId: selected, outcome: 'restored' });
    eq(restored.body.items.length, 6); eq(restored.body.items[1].publicationId, selected);
    const next = await call(feed + `?cursor=${encodeURIComponent(restored.body.nextCursor)}&limit=5`, auth);
    eq(next.body.items.some((i: any) => restored.body.items.some((j: any) => i.publicationId === j.publicationId)), false);
    const one = await call(feed + `?anchorPublicationId=${selected}&limit=1`, auth); eq(one.body.items.length, 1); eq(one.body.items[0].publicationId, selected);
    const wrong = await call(feed + `?anchorPublicationId=${origin.body.items[0].publicationId}`, auth);
    eq(wrong.body.resume.outcome, 'unavailable'); eq(wrong.body.items.every((i: any) => i.spaceId === f.spaces.personalB), true);
    eq((await call(feed + `?anchorPublicationId=${selected}&cursor=bad`, auth)).status, 400);
    await db.query("UPDATE space_publications SET status='unpublished' WHERE id=? AND space_id=?", [selected, f.spaces.personalB]);
    try {
      const removed = await call(feed + `?anchorPublicationId=${selected}`, auth);
      eq(removed.body.resume.outcome, 'unavailable'); eq(removed.body.items.some((i: any) => i.publicationId === selected), false);
    } finally { await db.query("UPDATE space_publications SET status='published' WHERE id=? AND space_id=?", [selected, f.spaces.personalB]); }
    const global = await call('/api/viewer/v1/feed/global?limit=5');
    if (global.body.items.length) {
      const id = global.body.items[0].publicationId;
      eq((await call(`/api/viewer/v1/feed/global?anchorPublicationId=${id}&limit=5`)).body.resume.outcome, 'restored');
    }
    const [roles] = await db.query('SELECT role_id FROM user_space_roles WHERE user_id=? AND space_id=?', [f.users.a.id, f.spaces.personalB]);
    await db.query('DELETE FROM user_space_roles WHERE user_id=? AND space_id=?', [f.users.a.id, f.spaces.personalB]);
    let subscriptionAdded = false;
    try {
      const [sub]: any = await db.query("INSERT INTO space_subscriptions(user_id,space_id,status) VALUES(?,?,'active')", [f.users.a.id, f.spaces.personalB]);
      subscriptionAdded = true;
      eq((await call(creator, auth)).body.personalEntry, { state: 'unavailable' });
      for (const headers of [auth, cookie]) {
        const denied = await call(feed, headers); eq(denied.status, 403); eq(Object.keys(denied.body), ['error']);
        eq((await fetch(base + `/api/spaces/${f.spaces.personalB}/feed`, { headers: cookie })).status, 403);
      }
      eq((await call('/api/native/v1/session', auth)).status, 200);
    } finally {
      if (subscriptionAdded) await db.query('DELETE FROM space_subscriptions WHERE user_id=? AND space_id=?', [f.users.a.id, f.spaces.personalB]);
      for (const role of roles as any[]) await db.query('INSERT IGNORE INTO user_space_roles(user_id,space_id,role_id) VALUES(?,?,?)', [f.users.a.id, f.spaces.personalB, role.role_id]);
    }
    const [ban]: any = await db.query("INSERT INTO suspensions(user_id,target_type,target_id,kind,degree,reason,created_by) VALUES(?,'space',?,'ban',1,'Plan 169 test',?)", [f.users.b.id, f.spaces.personalB, f.users.a.id]);
    try { eq((await call(creator, owner)).body.personalEntry.state, 'unavailable'); eq((await call(feed, owner)).status, 403); }
    finally { await db.query('DELETE FROM suspensions WHERE id=? AND user_id=?', [ban.insertId, f.users.b.id]); }
    const originalQuery = db.query;
    try {
      db.query = function(sql: any, ...args: any[]) { if (typeof sql === 'string' && sql.includes('FROM suspensions')) throw Error('private_database_error'); return (originalQuery as any).call(db, sql, ...args); } as any;
      const failed = await call(creator, auth); eq(failed.status, 503); eq(failed.body, { error: 'service_unavailable' });
    } finally { db.query = originalQuery; }
    eq((await call(creator, auth)).body.personalEntry.state, 'allowed');
    console.log(JSON.stringify({ creatorIntegration: 'passed', checks, media: 'public output metadata copies only', fixtureRestoration: 'passed' }));
  } finally {
    for (const token of tokens) await fetch(base + '/api/native/v1/session', { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
    server.close(); server.closeAllConnections(); await db.end();
  }
}
main().catch(e => { console.error(e.message || e.code); process.exitCode = 1; });
