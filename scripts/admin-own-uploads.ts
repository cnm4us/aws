import 'dotenv/config';
import { getPool, ensureSchema, seedRbac } from '../src/db';

async function main() {
  const emailArg = process.argv.find((a) => a.startsWith('--email='));
  if (!emailArg) {
    console.error('Usage: ts-node scripts/admin-own-uploads.ts --email=user@example.com');
    process.exit(1);
  }
  const email = emailArg.split('=')[1].trim().toLowerCase();
  const db = getPool();
  await ensureSchema(db as any);
  await seedRbac(db as any);
  // Find user
  const [rows] = await db.query(`SELECT id, display_name FROM users WHERE email = ? LIMIT 1`, [email]);
  const user = (rows as any[])[0];
  if (!user) {
    console.error('User not found for email:', email);
    process.exit(2);
  }
  const userId = Number(user.id);
  // Promote to admin
  await db.query(`INSERT IGNORE INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE name = 'admin'`, [userId]);
  // Ensure personal space exists
  const [sp] = await db.query(`SELECT id FROM spaces WHERE type='personal' AND owner_user_id = ? LIMIT 1`, [userId]);
  let spaceId: number;
  if ((sp as any[]).length) {
    spaceId = Number((sp as any[])[0].id);
  } else {
    const baseSlug = (user.display_name || email.split('@')[0] || 'user').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'user';
    let slug = `u-${baseSlug}`;
    let n = 1;
    while (true) {
      const [exists] = await db.query(`SELECT id FROM spaces WHERE slug = ? LIMIT 1`, [slug]);
      if ((exists as any[]).length === 0) break;
      n += 1; slug = `u-${baseSlug}-${n}`;
    }
    const settings = { visibility: 'public', membership: 'none', publishing: 'owner_only', moderation: 'none', follow_enabled: true };
    const [insSpace] = await db.query(`INSERT INTO spaces (type, owner_user_id, name, slug, settings) VALUES ('personal', ?, ?, ?, ?)`, [userId, user.display_name || email, slug, JSON.stringify(settings)]);
    spaceId = Number((insSpace as any).insertId);
  }
  // Assign space roles for owner
  await db.query(`INSERT IGNORE INTO user_space_roles (user_id, space_id, role_id) SELECT ?, ?, id FROM roles WHERE name IN ('channel_admin','publisher','member')`, [userId, spaceId]);
  // Own all uploads with no owner
  await db.query(`UPDATE uploads SET user_id = ? WHERE user_id IS NULL`, [userId]);
  await db.query(`UPDATE uploads SET space_id = ? WHERE space_id IS NULL`, [spaceId]);
  console.log('Backfill complete. User', email, 'now admin and owns unassigned uploads in space', spaceId);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

