/** Opt-in development fixtures. Reuses public media; never publishes these rows to Global. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getPool } from '../src/db';
import { ulidMonotonic } from '../src/utils/ulid';
import { assignDefaultMemberRoles } from '../src/services/spaceMembership';

export async function seedNativeViewerFixtures() {
  const file = path.resolve('.codex-local/plan168-fixtures.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const connection = await getPool().getConnection();
  const db = connection as any;
  await connection.beginTransaction();
  try {
  const users: any = {};
  for (const label of ['a', 'b']) {
    const email = `native-plan168-${label}-${crypto.randomBytes(4).toString('hex')}@example.invalid`;
    const password = crypto.randomBytes(24).toString('base64url');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64, { N: 16384 }).toString('hex');
    const [result]: any = await db.query('INSERT INTO users (email,password_hash,display_name) VALUES (?,?,?)',
      [email, `s2$16384$${salt}$${hash}`, `Native viewer ${label.toUpperCase()}`]);
    users[label] = { id: Number(result.insertId), email, password };
    await db.query("INSERT INTO user_roles (user_id,role_id) SELECT ?,id FROM roles WHERE name='site_member'", [result.insertId]);
  }
  const spaces: Record<string, number> = {};
  const definitions = [
    ['personalA','personal','private','a'], ['personalB','personal','private','b'],
    ['groupA','group','private','a'], ['groupB','group','private','b'],
    ['channelA','channel','members_only','a'], ['subscribed','channel','members_only','b'],
    ['public','group','public','b'], ['empty','group','private','a'], ['banned','group','public','b'],
  ];
  const [media]: any = await db.query("SELECT DISTINCT upload_id,production_id FROM space_publications WHERE status='published' AND visible_in_global=1 ORDER BY id DESC LIMIT 24");
  for (const [label,type,visibility,owner] of definitions) {
    const [ins]: any = await db.query('INSERT INTO spaces (type,owner_user_id,ulid,name,slug,settings) VALUES (?,?,?,?,?,?)',
      [type,users[owner].id,ulidMonotonic(),`Native test ${label}`,`native-plan168-${label.toLowerCase()}-${users.a.id}`,
        JSON.stringify({visibility,membership:'invite',publishing:'owner_only'})]);
    const id = Number(ins.insertId); spaces[label] = id;
    if (!['subscribed','public','banned'].includes(label)) {
      await assignDefaultMemberRoles(db,{ id,type: type as any,owner_user_id:users[owner].id },users[owner].id);
    }
    if (label !== 'empty') for (const source of media) {
      await db.query("INSERT INTO space_publications (upload_id,production_id,space_id,status,owner_user_id,visibility,visible_in_space,visible_in_global,published_at) VALUES (?,?,?,'published',?,'inherit',1,0,NOW())",
        [source.upload_id,source.production_id,id,users[owner].id]);
    }
  }
  await db.query("INSERT INTO space_subscriptions (user_id,space_id,status) VALUES (?,?,'active')",[users.a.id,spaces.subscribed]);
  await db.query("INSERT INTO suspensions (user_id,target_type,target_id,kind,degree,reason,created_by) VALUES (?,'space',?,'ban',1,'Plan 168 fixture',?)",[users.a.id,spaces.banned,users.b.id]);
  const fixtures = { users, spaces, note:'Only public Global media reused; no confidential media protection asserted.' };
  fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,JSON.stringify(fixtures,null,2),{mode:0o600});
  await connection.commit();
  return fixtures;
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

if (require.main === module) seedNativeViewerFixtures().then(f=>{
  console.log(JSON.stringify({userIds:Object.values(f.users).map((u:any)=>u.id),spaces:f.spaces,credentials:'Stored only in ignored .codex-local/plan168-fixtures.json'}));
}).catch(e=>{console.error(e.code || 'fixture_setup_failed');process.exitCode=1;}).finally(()=>getPool().end());
