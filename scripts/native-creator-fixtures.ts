/** Opt-in disposable fixtures. Copies public asset metadata, never publishes to Global. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getPool } from '../src/db';
import { ulidMonotonic } from '../src/utils/ulid';
import { assignDefaultMemberRoles } from '../src/services/spaceMembership';

export async function seedCreatorFixtures() {
  const file = path.resolve('.codex-local/plan169-fixtures.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const db = await getPool().getConnection();
  await db.beginTransaction();
  try {
    const users: any = {}, spaces: Record<string, number> = {};
    for (const label of ['a', 'b', 'hidden', 'missing', 'deleted']) {
      const password = crypto.randomBytes(24).toString('base64url'), salt = crypto.randomBytes(16).toString('hex');
      const email = `native-plan169-${label}-${crypto.randomBytes(4).toString('hex')}@example.invalid`;
      const hash = crypto.scryptSync(password, salt, 64, { N: 16384 }).toString('hex');
      const [result]: any = await db.query('INSERT INTO users(email,password_hash,display_name,deleted_at) VALUES(?,?,?,?)',
        [email, `s2$16384$${salt}$${hash}`, `Creator test ${label}`, label === 'deleted' ? '2026-01-01 00:00:00' : null]);
      users[label] = { id: Number(result.insertId), email, password };
      await db.query("INSERT INTO user_roles(user_id,role_id) SELECT ?,id FROM roles WHERE name='site_member'", [result.insertId]);
      if (label !== 'missing') await db.query('INSERT INTO profiles(user_id,display_name,avatar_url,bio,is_public,show_bio) VALUES(?,?,?,?,?,1)',
        [result.insertId, `Profile test ${label}`, null, `Biography test ${label}`, label === 'hidden' ? 0 : 1]);
    }
    for (const [label, type, owner] of [['origin', 'group', 'a'], ['personalA', 'personal', 'a'], ['personalB', 'personal', 'b'], ['empty', 'personal', 'missing']]) {
      const [result]: any = await db.query('INSERT INTO spaces(type,owner_user_id,ulid,name,slug,settings) VALUES(?,?,?,?,?,?)',
        [type, users[owner].id, ulidMonotonic(), `Creator test ${label}`, `native-plan169-${label.toLowerCase()}-${users.a.id}`,
          JSON.stringify({ visibility: label === 'personalB' ? 'public' : 'private', membership: 'invite', publishing: 'owner_only' })]);
      spaces[label] = Number(result.insertId);
      await assignDefaultMemberRoles(db as any, { id: spaces[label], type: type as any, owner_user_id: users[owner].id }, users[owner].id);
    }
    await assignDefaultMemberRoles(db as any, { id: spaces.personalB, type: 'personal', owner_user_id: users.b.id }, users.a.id);
    await assignDefaultMemberRoles(db as any, { id: spaces.empty, type: 'personal', owner_user_id: users.missing.id }, users.a.id);
    const [media]: any = await db.query("SELECT sp.upload_id,sp.production_id FROM space_publications sp JOIN uploads u ON u.id=sp.upload_id WHERE sp.status='published' AND sp.visible_in_global=1 AND u.status='completed' ORDER BY sp.id DESC LIMIT 24");
    if (!media.length) throw Error('public_fixture_media_required');
    const seenProductions = new Set<number>();
    for (const source of media) {
      if (source.production_id && seenProductions.has(Number(source.production_id))) continue;
      if (source.production_id) seenProductions.add(Number(source.production_id));
      const [copy]: any = await db.query(`INSERT INTO uploads(user_id,s3_bucket,s3_key,original_filename,content_type,size_bytes,status,output_prefix,asset_uuid,date_ymd,profile,orientation,width,height,duration_seconds,description)
        SELECT ?,s3_bucket,CONCAT(?,SUBSTRING_INDEX(s3_key,'/',-1)),original_filename,content_type,size_bytes,status,output_prefix,asset_uuid,date_ymd,profile,orientation,width,height,duration_seconds,description FROM uploads WHERE id=?`, [users.b.id, `native-fixtures/plan169/${crypto.randomBytes(12).toString('hex')}/`, source.upload_id]);
      for (const spaceId of [spaces.origin, spaces.personalB]) await db.query(`INSERT INTO space_publications(upload_id,production_id,space_id,status,owner_user_id,visibility,visible_in_space,visible_in_global,published_at)
        VALUES(?,?,?,'published',?,'inherit',1,0,NOW())`, [copy.insertId, source.production_id, spaceId, users.b.id]);
    }
    const fixtures = { users, spaces, note: 'Disposable accounts and metadata copies of public media only; no Global publications.' };
    await db.commit();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(fixtures, null, 2), { mode: 0o600 });
    return fixtures;
  } catch (error) { await db.rollback(); throw error; }
  finally { db.release(); }
}
if (require.main === module) seedCreatorFixtures().then(f => console.log(JSON.stringify({ userIds: Object.values(f.users).map((u: any) => u.id), spaces: f.spaces,
  credentials: 'Stored only in ignored .codex-local/plan169-fixtures.json' }))).catch(e => { console.error(e.code || e.message); process.exitCode = 1; }).finally(() => getPool().end());
