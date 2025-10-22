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
      modified_filename VARCHAR(512) NULL,
      description TEXT NULL,
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
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS modified_filename VARCHAR(512) NULL`);
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS description TEXT NULL`);
  // Ownership/scoping (optional; supports RBAC+ checks)
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS user_id BIGINT UNSIGNED NULL`);
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS channel_id BIGINT UNSIGNED NULL`);
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS space_id BIGINT UNSIGNED NULL`);
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS origin_space_id BIGINT UNSIGNED NULL`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_uploads_user_id ON uploads (user_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_uploads_channel_id ON uploads (channel_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_uploads_space_id ON uploads (space_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_uploads_origin_space_id ON uploads (origin_space_id)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS productions (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      upload_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      ulid CHAR(26) NULL,
      status ENUM('pending','queued','processing','completed','failed') NOT NULL DEFAULT 'pending',
      config JSON NULL,
      output_prefix VARCHAR(1024) NULL,
      mediaconvert_job_id VARCHAR(128) NULL,
      error_message TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at TIMESTAMP NULL DEFAULT NULL,
      completed_at TIMESTAMP NULL DEFAULT NULL,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_productions_ulid (ulid),
      KEY idx_productions_upload (upload_id),
      KEY idx_productions_user (user_id),
      KEY idx_productions_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  // Add new columns/indexes for productions table if upgrading
  await db.query(`ALTER TABLE productions ADD COLUMN IF NOT EXISTS ulid CHAR(26) NULL`);
  try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_productions_ulid ON productions (ulid)`); } catch {}

  // --- RBAC+ core tables ---
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NULL,
      display_name VARCHAR(255) NULL,
      org_id BIGINT UNSIGNED NULL,
      email_verified_at DATETIME NULL,
      phone_number VARCHAR(32) NULL,
      phone_verified_at DATETIME NULL,
      verification_level TINYINT UNSIGNED NULL DEFAULT 0,
      kyc_status ENUM('none','pending','verified','rejected') NOT NULL DEFAULT 'none',
      deleted_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  // Ensure new user columns exist for older schemas
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at DATETIME NULL`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number VARCHAR(32) NULL`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified_at DATETIME NULL`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_level TINYINT UNSIGNED NULL DEFAULT 0`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_status ENUM('none','pending','verified','rejected') NOT NULL DEFAULT 'none'`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS can_create_group TINYINT(1) NULL`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS can_create_channel TINYINT(1) NULL`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS credibility_score INT DEFAULT 0`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS require_review_global TINYINT(1) NOT NULL DEFAULT 0`);

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
      slug VARCHAR(128) NOT NULL,
      settings JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_spaces_type (type),
      KEY idx_spaces_owner (owner_user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  try {
    await db.query(`ALTER TABLE spaces DROP INDEX slug`);
  } catch {}
  try {
    await db.query(`ALTER TABLE spaces ADD UNIQUE INDEX idx_spaces_type_slug (type, slug)`);
  } catch {}

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

  await db.query(`
    CREATE TABLE IF NOT EXISTS space_invitations (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      space_id BIGINT UNSIGNED NOT NULL,
      inviter_user_id BIGINT UNSIGNED NOT NULL,
      invitee_user_id BIGINT UNSIGNED NOT NULL,
      status ENUM('pending','accepted','declined','revoked') NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      responded_at TIMESTAMP NULL DEFAULT NULL,
      UNIQUE KEY uniq_space_invitee (space_id, invitee_user_id),
      KEY idx_space_status (space_id, status),
      KEY idx_invitee_status (invitee_user_id, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS site_settings (
      id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
      allow_group_creation TINYINT(1) NOT NULL DEFAULT 1,
      allow_channel_creation TINYINT(1) NOT NULL DEFAULT 1,
      require_group_review TINYINT(1) NOT NULL DEFAULT 0,
      require_channel_review TINYINT(1) NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  await db.query(`INSERT IGNORE INTO site_settings (id) VALUES (1)`);
  // Ensure new columns exist for older schemas
  await db.query(`ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS require_group_review TINYINT(1) NOT NULL DEFAULT 0`);
  await db.query(`ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS require_channel_review TINYINT(1) NOT NULL DEFAULT 0`);

  // Suspensions (posting only for now)
  await db.query(`
    CREATE TABLE IF NOT EXISTS suspensions (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      target_type ENUM('site','space') NOT NULL,
      target_id BIGINT UNSIGNED NULL,
      kind ENUM('posting') NOT NULL DEFAULT 'posting',
      degree TINYINT UNSIGNED NOT NULL,
      starts_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
      ends_at DATETIME NULL,
      reason VARCHAR(255) NULL,
      created_by BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_susp_user (user_id),
      KEY idx_susp_target (target_type, target_id),
      KEY idx_susp_active (user_id, kind, ends_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // Action log (auditing)
  await db.query(`
    CREATE TABLE IF NOT EXISTS action_log (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NULL,
      action VARCHAR(64) NOT NULL,
      resource_type VARCHAR(32) NOT NULL,
      resource_id BIGINT UNSIGNED NOT NULL,
      detail JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_al_user (user_id),
      KEY idx_al_resource (resource_type, resource_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS space_publications (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      upload_id BIGINT UNSIGNED NOT NULL,
      production_id BIGINT UNSIGNED NULL,
      space_id BIGINT UNSIGNED NOT NULL,
      status ENUM('draft','pending','approved','published','unpublished','rejected') NOT NULL DEFAULT 'draft',
      requested_by BIGINT UNSIGNED NULL,
      approved_by BIGINT UNSIGNED NULL,
      is_primary TINYINT(1) NOT NULL DEFAULT 0,
      visibility ENUM('inherit','members','public') NOT NULL DEFAULT 'inherit',
      distribution_flags JSON NULL,
      owner_user_id BIGINT UNSIGNED NULL,
      visible_in_space TINYINT(1) NOT NULL DEFAULT 1,
      visible_in_global TINYINT(1) NOT NULL DEFAULT 0,
      comments_enabled TINYINT(1) NULL,
      published_at DATETIME NULL,
      unpublished_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_space_publications_production_space (production_id, space_id),
      KEY idx_space_publications_space_status (space_id, status, published_at, id),
      KEY idx_space_publications_space_feed (space_id, status, visible_in_space, published_at, id),
      KEY idx_space_publications_global_feed (visible_in_global, status, published_at, id),
      KEY idx_space_publications_owner_feed (owner_user_id, status, published_at, id),
      KEY idx_space_publications_upload (upload_id),
      KEY idx_space_publications_primary (is_primary)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // Comments policy related columns
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS default_comments_enabled TINYINT(1) NOT NULL DEFAULT 1`);
  await db.query(`ALTER TABLE space_publications ADD COLUMN IF NOT EXISTS comments_enabled TINYINT(1) NULL`);
  // Publication-centric + visibility columns for upgrades (idempotent)
  await db.query(`ALTER TABLE space_publications ADD COLUMN IF NOT EXISTS production_id BIGINT UNSIGNED NULL`);
  await db.query(`ALTER TABLE space_publications ADD COLUMN IF NOT EXISTS owner_user_id BIGINT UNSIGNED NULL`);
  await db.query(`ALTER TABLE space_publications ADD COLUMN IF NOT EXISTS visible_in_space TINYINT(1) NOT NULL DEFAULT 1`);
  await db.query(`ALTER TABLE space_publications ADD COLUMN IF NOT EXISTS visible_in_global TINYINT(1) NOT NULL DEFAULT 0`);
  // Drop legacy unique (upload_id, space_id) if present
  try { await db.query(`DROP INDEX uniq_space_publications_upload_space ON space_publications`); } catch {}
  // Supporting indexes (best-effort)
  try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_space_publications_production_space ON space_publications (production_id, space_id)`); } catch {}
  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_space_publications_space_feed ON space_publications (space_id, status, visible_in_space, published_at, id)`); } catch {}
  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_space_publications_global_feed ON space_publications (visible_in_global, status, published_at, id)`); } catch {}
  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_space_publications_owner_feed ON space_publications (owner_user_id, status, published_at, id)`); } catch {}

  await db.query(`
    CREATE TABLE IF NOT EXISTS space_publication_events (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      publication_id BIGINT UNSIGNED NOT NULL,
      actor_user_id BIGINT UNSIGNED NULL,
      action VARCHAR(64) NOT NULL,
      detail JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_space_publication_events_pub (publication_id),
      KEY idx_space_publication_events_created (created_at)
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
    'space_admin',
    'space_member',
    'space_poster',
    'space_moderator',
    'space_subscriber',
    'group_admin',
    'group_member',
    'channel_admin',
    'channel_member',
    'admin',
    'subscriber',
  ];
  const perms = [
    'video:upload',
    'video:edit_own',
    'video:delete_own',
    'video:publish_own',
    'video:unpublish_own',
    'video:publish_space',
    'video:unpublish_space',
    'video:approve_space',
    'video:moderate',
    'video:delete_any',
    'video:approve',
    'space:manage',
    'space:invite',
    'space:kick',
    'space:assign_roles',
    'space:view_private',
    'space:post',
    'space:create_group',
    'space:create_channel',
    'space:manage_members',
    'space:invite_members',
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
  await give('space_member', ['space:view_private']);
  await give('subscriber', ['space:view_private']);
  await give('uploader', ['video:upload', 'video:edit_own', 'video:delete_own', 'space:create_group', 'space:create_channel']);
  await give('contributor', ['video:upload', 'video:edit_own', 'video:delete_own', 'space:post']);
  await give('space_poster', ['video:upload', 'video:edit_own', 'video:delete_own', 'space:post']);
  await give('publisher', ['video:upload', 'video:edit_own', 'video:delete_own', 'video:publish_own', 'video:unpublish_own']);
  await give('moderator', ['video:moderate', 'video:approve']);
  await give('space_moderator', [
    'space:view_private',
    'video:publish_space',
    'video:unpublish_space',
    'video:approve_space',
  ]);
  await give('space_admin', [
    'space:manage',
    'space:invite',
    'space:kick',
    'space:assign_roles',
    'space:manage_members',
    'space:invite_members',
    'space:view_private',
    'video:publish_space',
    'video:unpublish_space',
    'video:approve_space',
  ]);
  await give('group_admin', [
    'space:manage',
    'space:invite',
    'space:kick',
    'space:assign_roles',
    'space:manage_members',
    'space:invite_members',
    'video:publish_space',
    'video:unpublish_space',
    'video:approve_space',
  ]);
  await give('group_member', ['video:publish_space']);
  await give('channel_admin', [
    'space:manage',
    'space:invite',
    'space:kick',
    'space:assign_roles',
    'space:manage_members',
    'space:invite_members',
    'video:moderate',
    'video:approve',
    'video:publish_space',
    'video:unpublish_space',
    'video:approve_space',
  ]);
  await give('channel_member', ['video:publish_space']);
  // Admin gets all permissions
  await give('admin', perms);
}

export type UploadRow = {
  id: bigint | number;
  s3_bucket: string;
  s3_key: string;
  original_filename: string;
  modified_filename: string | null;
  description: string | null;
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
  user_id?: number | null;
  channel_id?: number | null;
  space_id?: number | null;
  origin_space_id?: number | null;
};

export type SpacePublicationStatus = 'draft' | 'pending' | 'approved' | 'published' | 'unpublished' | 'rejected';

export type SpacePublicationVisibility = 'inherit' | 'members' | 'public';

export type SpacePublicationRow = {
  id: number;
  upload_id: number;
  production_id?: number | null;
  space_id: number;
  status: SpacePublicationStatus;
  requested_by: number | null;
  approved_by: number | null;
  is_primary: boolean;
  visibility: SpacePublicationVisibility;
  distribution_flags: any | null;
  published_at: string | null;
  unpublished_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SpacePublicationEventRow = {
  id: number;
  publication_id: number;
  actor_user_id: number | null;
  action: string;
  detail: any | null;
  created_at: string;
};

export type ProductionStatus = 'pending' | 'queued' | 'processing' | 'completed' | 'failed';

export type ProductionRow = {
  id: number;
  upload_id: number;
  user_id: number;
  status: ProductionStatus;
  config: any;
  output_prefix: string | null;
  mediaconvert_job_id: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string | null;
};
