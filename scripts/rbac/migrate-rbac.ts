import 'dotenv/config';
import { getPool } from '../../src/db';
import { permissionSeeds, roleSeeds } from './seeds';

async function main() {
  const db = getPool();
  const dry = process.argv.includes('--dry');

  const exec = async (sql: string, params: any[] = []) => {
    if (dry) {
      console.log('[DRY] SQL:', sql, params.length ? JSON.stringify(params) : '');
      return [{ affectedRows: 0 } as any, undefined];
    }
    return db.query(sql, params);
  };

  console.log('--- RBAC migrate: adding columns if missing ---');
  await exec(`ALTER TABLE permissions ADD COLUMN IF NOT EXISTS scope VARCHAR(16) NOT NULL DEFAULT 'space'`);
  await exec(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS scope VARCHAR(16) NOT NULL DEFAULT 'space'`);
  await exec(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS space_type VARCHAR(16) NULL`);

  console.log('--- RBAC migrate: seeding permissions ---');
  for (const p of permissionSeeds) {
    await exec(`INSERT IGNORE INTO permissions (name, scope) VALUES (?, ?)`, [p.name, p.scope]);
  }

  // Fetch ids
  const [permRows] = await exec(`SELECT id, name FROM permissions`);
  const permIdByName = new Map<string, number>();
  (permRows as any[]).forEach(r => permIdByName.set(String(r.name), Number(r.id)));

  console.log('--- RBAC migrate: seeding roles ---');
  for (const r of roleSeeds) {
    await exec(`INSERT IGNORE INTO roles (name, scope, space_type) VALUES (?, ?, ?)`, [r.name, r.scope, r.space_type ?? null]);
  }
  const [roleRows] = await exec(`SELECT id, name FROM roles`);
  const roleIdByName = new Map<string, number>();
  (roleRows as any[]).forEach(r => roleIdByName.set(String(r.name), Number(r.id)));

  console.log('--- RBAC migrate: linking role_permissions ---');
  for (const role of roleSeeds) {
    const rid = roleIdByName.get(role.name);
    if (!rid) continue;

    if (role.grants.length === 1 && role.grants[0] === '*') {
      // Grant all permissions to this role
      for (const [name, pid] of permIdByName.entries()) {
        await exec(`INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`, [rid, pid]);
      }
      continue;
    }

    for (const permName of role.grants) {
      const pid = permIdByName.get(permName);
      if (!pid) {
        console.warn(`[warn] permission not found for role ${role.name}: ${permName}`);
        continue;
      }
      await exec(`INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`, [rid, pid]);
    }
  }

  console.log('RBAC migration complete.', dry ? '(dry run)' : '');
  if (!dry) process.exit(0);
}

main().catch((err) => {
  console.error('RBAC migration failed', err);
  process.exit(1);
});

