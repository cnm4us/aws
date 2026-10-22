/** Disposable text fixtures. Public media/pointers are copied; no Global publication or processing job. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getPool } from '../src/db';
import { ulidMonotonic } from '../src/utils/ulid';
import { assignDefaultMemberRoles } from '../src/services/spaceMembership';

export async function seedTextFixtures() {
  const file = path.resolve('.codex-local/plan170-fixtures.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const db = await getPool().getConnection();
  await db.beginTransaction();
  try {
    const users: any = {}, spaces: any = {}, publications: any[] = [];
    for (const label of ['a', 'b']) {
      const password = crypto.randomBytes(24).toString('base64url'), salt = crypto.randomBytes(16).toString('hex');
      const email = `native-plan170-${label}-${crypto.randomBytes(4).toString('hex')}@example.invalid`;
      const hash = crypto.scryptSync(password, salt, 64, { N: 16384 }).toString('hex');
      const [ins]: any = await db.query('INSERT INTO users(email,password_hash,display_name) VALUES(?,?,?)', [email, `s2$16384$${salt}$${hash}`, `Text test ${label.toUpperCase()}`]);
      users[label] = { id: Number(ins.insertId), email, password };
      await db.query("INSERT INTO user_roles(user_id,role_id) SELECT ?,id FROM roles WHERE name='site_member'", [ins.insertId]);
    }
    for (const [label, type, owner] of [['origin', 'group', 'a'], ['personalA', 'personal', 'a'], ['personalB', 'personal', 'b']]) {
      const [ins]: any = await db.query('INSERT INTO spaces(type,owner_user_id,ulid,name,slug,settings) VALUES(?,?,?,?,?,?)',
        [type, users[owner].id, ulidMonotonic(), `Text test ${label}`, `native-plan170-${label.toLowerCase()}-${users.a.id}`, JSON.stringify({ visibility: 'private', membership: 'invite', publishing: 'owner_only' })]);
      spaces[label] = Number(ins.insertId);
      await assignDefaultMemberRoles(db as any, { id: ins.insertId, type: type as any, owner_user_id: users[owner].id }, users[owner].id);
    }
    await assignDefaultMemberRoles(db as any, { id: spaces.personalB, type: 'personal', owner_user_id: users.b.id }, users.a.id);
    const [media]: any = await db.query(`SELECT sp.id AS global_id,sp.upload_id,sp.production_id FROM space_publications sp
      JOIN uploads u ON u.id=sp.upload_id JOIN productions p ON p.id=sp.production_id
      LEFT JOIN production_captions pc ON pc.production_id=p.id AND pc.status='ready'
      WHERE sp.status='published' AND sp.visible_in_global=1 AND sp.visibility<>'members' AND u.status='completed'
      ORDER BY (pc.id IS NOT NULL) DESC,sp.id DESC LIMIT 8`);
    if (!media.length) throw Error('public_fixture_media_required');
    for (const [index, source] of media.entries()) {
      const [copy]: any = await db.query(`INSERT INTO uploads(user_id,s3_bucket,s3_key,original_filename,content_type,size_bytes,status,output_prefix,asset_uuid,date_ymd,profile,orientation,width,height,duration_seconds,description)
        SELECT ?,s3_bucket,CONCAT(?,SUBSTRING_INDEX(s3_key,'/',-1)),original_filename,content_type,size_bytes,status,output_prefix,asset_uuid,date_ymd,profile,orientation,width,height,duration_seconds,'Text fixture description' FROM uploads WHERE id=?`,
        [users.b.id, `native-fixtures/plan170/${crypto.randomBytes(12).toString('hex')}/`, source.upload_id]);
      const [prod]: any = await db.query(`INSERT INTO productions(upload_id,user_id,ulid,name,status,output_prefix,completed_at,default_story_text)
        SELECT ?,?,?,'Text fixture','completed',output_prefix,NOW(),'Production default must not replace the publication story' FROM productions WHERE id=?`, [copy.insertId, users.b.id, ulidMonotonic(), source.production_id]);
      if (index !== 1) await db.query(`INSERT INTO production_captions(production_id,provider,transcript_id,format,language,s3_bucket,s3_key,status)
        SELECT ?,provider,transcript_id,format,language,s3_bucket,s3_key,status FROM production_captions WHERE production_id=? AND status='ready'`, [prod.insertId, source.production_id]);
      const row: any = { productionId: Number(prod.insertId), sourceGlobalId: Number(source.global_id) };
      for (const label of ['origin', 'personalB']) {
        const story = index === 2 ? null : `${label === 'origin' ? 'Origin story' : 'Personal story'} ${index + 1}\n${'A written narrative for this publication. '.repeat(index === 0 ? 35 : 2)}`;
        const [pub]: any = await db.query(`INSERT INTO space_publications(upload_id,production_id,space_id,status,owner_user_id,visibility,visible_in_space,visible_in_global,published_at,story_text,story_source)
          VALUES(?,?,?,'published',?,'inherit',1,0,DATE_SUB(NOW(),INTERVAL ? SECOND),?,'custom')`, [copy.insertId, prod.insertId, spaces[label], users.b.id, index, story]);
        row[label] = Number(pub.insertId);
      }
      publications.push(row);
    }
    const fixtures = { users, spaces, publications, note: 'Public media/ready production caption pointers copied to disposable identities; no Global fixture publications.' };
    await db.commit();
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(fixtures, null, 2), { mode: 0o600 });
    return fixtures;
  } catch (error) { await db.rollback(); throw error; }
  finally { db.release(); }
}
if (require.main === module) seedTextFixtures().then(f => console.log(JSON.stringify({ spaces: f.spaces, publications: f.publications.length, credentials: 'Stored privately in .codex-local/plan170-fixtures.json' })))
  .catch(e => { console.error(e.code || 'fixture_setup_failed'); process.exitCode = 1; }).finally(() => getPool().end());
