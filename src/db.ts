import 'dotenv/config';
import mysql from 'mysql2/promise';

export type DB = mysql.Pool;

let pool: mysql.Pool | undefined;

export function getPool(): DB {
  if (pool) return pool;

  const host = process.env.DB_HOST || '127.0.0.1';
  const port = Number(process.env.DB_PORT || 3306);
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_NAME || 'aws';

  pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    connectionLimit: Number(process.env.DB_POOL_LIMIT || 10),
    waitForConnections: true,
    queueLimit: 0,
    // Helpful defaults for MariaDB
    dateStrings: true,
  });

  const close = async () => {
    try { await pool!.end(); } catch {}
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);

  return pool;
}

export async function ensureSchema(db: DB) {
  const ddl = `
    CREATE TABLE IF NOT EXISTS uploads (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      s3_bucket VARCHAR(255) NOT NULL,
      s3_key VARCHAR(1024) NOT NULL,
      original_filename VARCHAR(512) NOT NULL,
      content_type VARCHAR(255) NULL,
      size_bytes BIGINT UNSIGNED NULL,
      width INT NULL,
      height INT NULL,
      duration_seconds INT NULL,
      status ENUM('signed','uploading','uploaded','failed','queued','processing','completed') NOT NULL DEFAULT 'signed',
      etag VARCHAR(128) NULL,
      mediaconvert_job_id VARCHAR(128) NULL,
      output_prefix VARCHAR(1024) NULL,
      asset_uuid CHAR(36) NULL,
      date_ymd CHAR(10) NULL,
      profile VARCHAR(128) NULL,
      orientation ENUM('portrait','landscape') NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      uploaded_at TIMESTAMP NULL DEFAULT NULL,
      UNIQUE KEY uniq_bucket_key (s3_bucket, s3_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await db.query(ddl);

  // Add new columns if migrating from an older schema
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS width INT NULL`);
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS height INT NULL`);
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS duration_seconds INT NULL`);
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS profile VARCHAR(128) NULL`);
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS asset_uuid CHAR(36) NULL`);
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS date_ymd CHAR(10) NULL`);
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS orientation ENUM('portrait','landscape') NULL`);
  // Ownership/scoping (optional; supports RBAC+ checks)
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS user_id BIGINT UNSIGNED NULL`);
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS channel_id BIGINT UNSIGNED NULL`);
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS space_id BIGINT UNSIGNED NULL`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_uploads_user_id ON uploads (user_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_uploads_channel_id ON uploads (channel_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_uploads_space_id ON uploads (space_id)`);

  // --- RBAC+ core tables ---
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NULL,
      display_name VARCHAR(255) NULL,
      org_id BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(64) NOT NULL UNIQUE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS permissions (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(96) NOT NULL UNIQUE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id BIGINT UNSIGNED NOT NULL,
      permission_id BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (role_id, permission_id),
      KEY idx_rp_perm (permission_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id BIGINT UNSIGNED NOT NULL,
      role_id BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (user_id, role_id),
      KEY idx_ur_role (role_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS channels (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      org_id BIGINT UNSIGNED NULL,
      name VARCHAR(128) NOT NULL,
      slug VARCHAR(128) NOT NULL UNIQUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS user_channel_roles (
      user_id BIGINT UNSIGNED NOT NULL,
      channel_id BIGINT UNSIGNED NOT NULL,
      role_id BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (user_id, channel_id, role_id),
      KEY idx_ucr_channel (channel_id),
      KEY idx_ucr_role (role_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS grants (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      resource_type VARCHAR(32) NOT NULL,
      resource_id BIGINT UNSIGNED NOT NULL,
      action VARCHAR(96) NOT NULL,
      effect ENUM('allow','deny') NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_grants_user (user_id),
      KEY idx_grants_resource (resource_type, resource_id),
      KEY idx_grants_action (action)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // Unified spaces model (personal/group/channel) with policy settings
  await db.query(`
    CREATE TABLE IF NOT EXISTS spaces (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      type ENUM('personal','group','channel') NOT NULL,
      org_id BIGINT UNSIGNED NULL,
      owner_user_id BIGINT UNSIGNED NULL,
      name VARCHAR(128) NOT NULL,
      slug VARCHAR(128) NOT NULL UNIQUE,
      settings JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_spaces_type (type),
      KEY idx_spaces_owner (owner_user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS user_space_roles (
      user_id BIGINT UNSIGNED NOT NULL,
      space_id BIGINT UNSIGNED NOT NULL,
      role_id BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (user_id, space_id, role_id),
      KEY idx_usr_space (space_id),
      KEY idx_usr_role (role_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS space_subscriptions (
      user_id BIGINT UNSIGNED NOT NULL,
      space_id BIGINT UNSIGNED NOT NULL,
      tier VARCHAR(64) NULL,
      status ENUM('active','canceled','past_due') NOT NULL DEFAULT 'active',
      started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ended_at TIMESTAMP NULL DEFAULT NULL,
      PRIMARY KEY (user_id, space_id),
      KEY idx_ss_space (space_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS space_follows (
      follower_id BIGINT UNSIGNED NOT NULL,
      space_id BIGINT UNSIGNED NOT NULL,
      followed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (follower_id, space_id),
      KEY idx_sf_space (space_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
}

// Seed baseline roles/permissions mappings for RBAC+
export async function seedRbac(db: DB) {
  const roles = [
    'viewer',
    'uploader',
    'publisher',
    'contributor',
    'member',
    'moderator',
    'channel_admin',
    'admin',
    'subscriber',
  ];
  const perms = [
    'video:upload',
    'video:edit_own',
    'video:delete_own',
    'video:publish_own',
    'video:unpublish_own',
    'video:moderate',
    'video:delete_any',
    'video:approve',
    'space:manage',
    'space:invite',
    'space:kick',
    'space:assign_roles',
    'space:view_private',
    'space:post',
  ];

  // Insert roles/permissions
  for (const r of roles) {
    await db.query(`INSERT IGNORE INTO roles (name) VALUES (?)`, [r]);
  }
  for (const p of perms) {
    await db.query(`INSERT IGNORE INTO permissions (name) VALUES (?)`, [p]);
  }

  // Load ids
  const [roleRows] = await db.query(`SELECT id, name FROM roles`);
  const [permRows] = await db.query(`SELECT id, name FROM permissions`);
  const roleIdByName = new Map<string, number>();
  const permIdByName = new Map<string, number>();
  (roleRows as any[]).forEach(r => roleIdByName.set(r.name, Number(r.id)));
  (permRows as any[]).forEach(p => permIdByName.set(p.name, Number(p.id)));

  const give = async (roleName: string, permNames: string[]) => {
    const rid = roleIdByName.get(roleName);
    if (!rid) return;
    for (const pn of permNames) {
      const pid = permIdByName.get(pn);
      if (!pid) continue;
      await db.query(`INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`, [rid, pid]);
    }
  };

  // Role permission mappings
  await give('viewer', []);
  await give('member', ['space:view_private']);
  await give('subscriber', ['space:view_private']);
  await give('uploader', ['video:upload', 'video:edit_own', 'video:delete_own']);
  await give('contributor', ['video:upload', 'video:edit_own', 'video:delete_own', 'space:post']);
  await give('publisher', ['video:upload', 'video:edit_own', 'video:delete_own', 'video:publish_own', 'video:unpublish_own']);
  await give('moderator', ['video:moderate', 'video:approve']);
  await give('channel_admin', ['space:manage', 'space:invite', 'space:kick', 'space:assign_roles', 'video:moderate', 'video:approve']);
  // Admin gets all permissions
  await give('admin', perms);
}

export type UploadRow = {
  id: bigint | number;
  s3_bucket: string;
  s3_key: string;
  original_filename: string;
  content_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  status: string;
  etag: string | null;
  mediaconvert_job_id: string | null;
  output_prefix: string | null;
  asset_uuid: string | null;
  date_ymd: string | null;
  profile: string | null;
  orientation: 'portrait' | 'landscape' | null;
  created_at: string;
  uploaded_at: string | null;
};
