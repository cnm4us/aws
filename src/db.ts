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
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS source_deleted_at DATETIME NULL`);
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS is_system TINYINT(1) NOT NULL DEFAULT 0`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_uploads_user_id ON uploads (user_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_uploads_channel_id ON uploads (channel_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_uploads_space_id ON uploads (space_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_uploads_origin_space_id ON uploads (origin_space_id)`);
  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_uploads_source_deleted_at ON uploads (source_deleted_at, id)`); } catch {}
  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_uploads_kind_system_status ON uploads (kind, is_system, status, id)`); } catch {}

	  await db.query(`
	    CREATE TABLE IF NOT EXISTS logo_configurations (
	      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
	      owner_user_id BIGINT UNSIGNED NOT NULL,
	      name VARCHAR(120) NOT NULL,
	      position ENUM(
	        'top_left','top_center','top_right',
	        'middle_left','middle_center','middle_right',
	        'bottom_left','bottom_center','bottom_right',
	        'center'
	      ) NOT NULL,
	      size_pct_width TINYINT UNSIGNED NOT NULL,
	      opacity_pct TINYINT UNSIGNED NOT NULL,
	      timing_rule ENUM('entire','start_after','first_only','last_only') NOT NULL,
	      timing_seconds INT UNSIGNED NULL,
	      fade ENUM('none','in','out','in_out') NOT NULL,
	      inset_x_preset VARCHAR(16) NULL,
	      inset_y_preset VARCHAR(16) NULL,
	      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	      archived_at TIMESTAMP NULL DEFAULT NULL,
	      KEY idx_logo_cfg_owner_archived (owner_user_id, archived_at, id)
	    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
	  `);
	  await db.query(`ALTER TABLE logo_configurations ADD COLUMN IF NOT EXISTS inset_x_preset VARCHAR(16) NULL`);
	  await db.query(`ALTER TABLE logo_configurations ADD COLUMN IF NOT EXISTS inset_y_preset VARCHAR(16) NULL`);
	  try {
	    await db.query(
	      `ALTER TABLE logo_configurations
	          MODIFY COLUMN position ENUM(
	            'top_left','top_center','top_right',
	            'middle_left','middle_center','middle_right',
	            'bottom_left','bottom_center','bottom_right',
	            'center'
	          ) NOT NULL`
	    )
	  } catch {}

			  await db.query(`
			    CREATE TABLE IF NOT EXISTS audio_configurations (
			      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
			      owner_user_id BIGINT UNSIGNED NOT NULL,
			      name VARCHAR(120) NOT NULL,
			      mode ENUM('replace','mix') NOT NULL DEFAULT 'mix',
			      video_gain_db SMALLINT NOT NULL DEFAULT 0,
			      music_gain_db SMALLINT NOT NULL DEFAULT -18,
			      ducking_enabled TINYINT(1) NOT NULL DEFAULT 0,
			      ducking_amount_db SMALLINT NOT NULL DEFAULT 12,
			      ducking_mode ENUM('none','rolling','abrupt') NOT NULL DEFAULT 'none',
			      ducking_gate ENUM('sensitive','normal','strict') NOT NULL DEFAULT 'normal',
			      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			      archived_at TIMESTAMP NULL DEFAULT NULL,
			      KEY idx_audio_cfg_owner_archived (owner_user_id, archived_at, id),
			      KEY idx_audio_cfg_archived (archived_at, id)
			    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
			  `);

			  // Plan 35: ducking modes + sensitivity (idempotent best-effort).
			  // Use NULL default first so we can backfill safely, then enforce NOT NULL defaults.
			  await db.query(`ALTER TABLE audio_configurations ADD COLUMN IF NOT EXISTS ducking_mode ENUM('none','rolling','abrupt') NULL DEFAULT NULL`);
			  await db.query(`ALTER TABLE audio_configurations ADD COLUMN IF NOT EXISTS ducking_gate ENUM('sensitive','normal','strict') NULL DEFAULT NULL`);
			  try {
			    await db.query(
			      `UPDATE audio_configurations
			          SET ducking_mode = CASE WHEN ducking_enabled = 1 THEN 'rolling' ELSE 'none' END
			        WHERE ducking_mode IS NULL`
			    )
			  } catch {}
			  try { await db.query(`UPDATE audio_configurations SET ducking_gate = 'normal' WHERE ducking_gate IS NULL`); } catch {}
			  try { await db.query(`ALTER TABLE audio_configurations MODIFY COLUMN ducking_mode ENUM('none','rolling','abrupt') NOT NULL DEFAULT 'none'`); } catch {}
			  try { await db.query(`ALTER TABLE audio_configurations MODIFY COLUMN ducking_gate ENUM('sensitive','normal','strict') NOT NULL DEFAULT 'normal'`); } catch {}

			  // Plan 34: optional intro SFX overlay config (idempotent best-effort).
			  // NOTE: uploads.kind + uploads.is_system are created by earlier migrations/scripts.
			  await db.query(`ALTER TABLE audio_configurations ADD COLUMN IF NOT EXISTS intro_sfx_upload_id BIGINT UNSIGNED NULL`);
			  await db.query(`ALTER TABLE audio_configurations ADD COLUMN IF NOT EXISTS intro_sfx_seconds INT UNSIGNED NULL`);
		  await db.query(`ALTER TABLE audio_configurations ADD COLUMN IF NOT EXISTS intro_sfx_gain_db SMALLINT NOT NULL DEFAULT 0`);
		  await db.query(`ALTER TABLE audio_configurations ADD COLUMN IF NOT EXISTS intro_sfx_fade_enabled TINYINT(1) NOT NULL DEFAULT 1`);
		  await db.query(`ALTER TABLE audio_configurations ADD COLUMN IF NOT EXISTS intro_sfx_ducking_enabled TINYINT(1) NOT NULL DEFAULT 0`);
		  await db.query(`ALTER TABLE audio_configurations ADD COLUMN IF NOT EXISTS intro_sfx_ducking_amount_db SMALLINT NOT NULL DEFAULT 12`);
		  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_audio_cfg_intro_sfx ON audio_configurations (intro_sfx_upload_id, archived_at, id)`); } catch {}
		
			  await db.query(`
			    CREATE TABLE IF NOT EXISTS productions (
		      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
	      upload_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      ulid CHAR(26) NULL,
      name VARCHAR(255) NULL,
      status ENUM('pending_media','pending','queued','processing','completed','failed') NOT NULL DEFAULT 'pending',
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
  await db.query(`ALTER TABLE productions ADD COLUMN IF NOT EXISTS name VARCHAR(255) NULL`);
	  try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_productions_ulid ON productions (ulid)`); } catch {}
  // Plan 36: allow 'pending_media' status for async ffmpeg mastering jobs.
  try {
    await db.query(
      `ALTER TABLE productions
         MODIFY COLUMN status ENUM('pending_media','pending','queued','processing','completed','failed') NOT NULL DEFAULT 'pending'`
    )
  } catch {}

	  // --- Media processing jobs (Plan 36 / feature_08) ---
	  // DB-backed queue; logs/artifacts stored in S3 with pointers in DB.
	  await db.query(`
	    CREATE TABLE IF NOT EXISTS media_jobs (
	      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
	      type VARCHAR(64) NOT NULL,
	      status ENUM('pending','processing','completed','failed','dead') NOT NULL DEFAULT 'pending',
	      priority INT NOT NULL DEFAULT 0,
	      attempts INT NOT NULL DEFAULT 0,
	      max_attempts INT NOT NULL DEFAULT 3,
	      run_after TIMESTAMP NULL DEFAULT NULL,
	      locked_at TIMESTAMP NULL DEFAULT NULL,
	      locked_by VARCHAR(128) NULL DEFAULT NULL,
	      input_json JSON NOT NULL,
	      result_json JSON NULL,
	      error_code VARCHAR(64) NULL,
	      error_message TEXT NULL,
	      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	      completed_at TIMESTAMP NULL DEFAULT NULL,
	      KEY idx_media_jobs_status_run (status, run_after, priority, id),
	      KEY idx_media_jobs_locked (locked_at, id),
	      KEY idx_media_jobs_type (type, status, id)
	    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
	  `);

	  await db.query(`
	    CREATE TABLE IF NOT EXISTS media_job_attempts (
	      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
	      job_id BIGINT UNSIGNED NOT NULL,
	      attempt_no INT NOT NULL,
	      worker_id VARCHAR(128) NULL,
	      started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	      finished_at TIMESTAMP NULL DEFAULT NULL,
	      exit_code INT NULL,
	      stdout_s3_bucket VARCHAR(255) NULL,
	      stdout_s3_key VARCHAR(1024) NULL,
	      stderr_s3_bucket VARCHAR(255) NULL,
	      stderr_s3_key VARCHAR(1024) NULL,
	      artifacts_s3_bucket VARCHAR(255) NULL,
	      artifacts_s3_prefix VARCHAR(1024) NULL,
	      scratch_manifest_json JSON NULL,
	      KEY idx_media_job_attempts_job (job_id, attempt_no),
	      KEY idx_media_job_attempts_started (started_at, id)
	    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
	  `);
	  try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_media_job_attempt_no ON media_job_attempts (job_id, attempt_no)`); } catch {}

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
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS slug VARCHAR(64) NULL`);
  try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_slug ON users (slug)`); } catch {}

  await db.query(`
    CREATE TABLE IF NOT EXISTS profiles (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      display_name VARCHAR(255) NOT NULL,
      avatar_url VARCHAR(512) NULL,
      bio TEXT NULL,
      is_public TINYINT(1) NOT NULL DEFAULT 1,
      show_bio TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_profiles_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS space_credibility (
      user_id BIGINT UNSIGNED NOT NULL,
      space_id BIGINT UNSIGNED NOT NULL,
      label VARCHAR(64) NOT NULL,
      effective_from DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      effective_to DATETIME NULL,
      PRIMARY KEY (user_id, space_id),
      KEY idx_sc_space (space_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS space_credibility_log (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      space_id BIGINT UNSIGNED NOT NULL,
      label VARCHAR(64) NOT NULL,
      reason VARCHAR(255) NULL,
      source VARCHAR(64) NOT NULL,
      moderator_id BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_scl_user_space (user_id, space_id),
      KEY idx_scl_space (space_id, created_at)
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
      ulid CHAR(26) NULL,
      name VARCHAR(128) NOT NULL,
      slug VARCHAR(128) NOT NULL,
      settings JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_spaces_type (type),
      KEY idx_spaces_owner (owner_user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  // Idempotent add for upgrades
  await db.query(`ALTER TABLE spaces ADD COLUMN IF NOT EXISTS ulid CHAR(26) NULL`);
  try {
    await db.query(`ALTER TABLE spaces DROP INDEX slug`);
  } catch {}
  try {
    await db.query(`ALTER TABLE spaces ADD UNIQUE INDEX idx_spaces_type_slug (type, slug)`);
  } catch {}
  try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_spaces_ulid ON spaces (ulid)`); } catch {}

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
    CREATE TABLE IF NOT EXISTS space_user_follows (
      follower_user_id BIGINT UNSIGNED NOT NULL,
      target_user_id BIGINT UNSIGNED NOT NULL,
      space_id BIGINT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (follower_user_id, target_user_id, space_id),
      KEY idx_suf_space (space_id),
      KEY idx_suf_target (target_user_id)
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
  // Expand suspensions.kind to support 'ban' (idempotent best-effort)
  try {
    await db.query(`ALTER TABLE suspensions MODIFY COLUMN kind ENUM('posting','ban') NOT NULL DEFAULT 'posting'`);
  } catch {}

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

  // Site-wide editable pages (Markdown-backed)
  await db.query(`
    CREATE TABLE IF NOT EXISTS pages (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      slug VARCHAR(255) NOT NULL,
      title VARCHAR(255) NOT NULL,
      markdown MEDIUMTEXT NOT NULL,
      html MEDIUMTEXT NOT NULL,
      visibility ENUM('public','authenticated','space_moderator','space_admin') NOT NULL DEFAULT 'public',
      layout VARCHAR(64) NOT NULL DEFAULT 'default',
      created_by BIGINT UNSIGNED NULL,
      updated_by BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_pages_slug (slug)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // Dedicated moderation actions with optional linkage to rule versions
  await db.query(`
    CREATE TABLE IF NOT EXISTS moderation_actions (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      actor_user_id BIGINT UNSIGNED NOT NULL,
      target_type VARCHAR(32) NOT NULL,
      target_id BIGINT UNSIGNED NULL,
      action_type VARCHAR(64) NOT NULL,
      reason VARCHAR(255) NULL,
      rule_version_id BIGINT UNSIGNED NULL,
      detail JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_ma_actor (actor_user_id, created_at),
      KEY idx_ma_target (target_type, target_id, created_at),
      KEY idx_ma_rule_version (rule_version_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // Rule categories (for moderation UI grouping)
  await db.query(`
    CREATE TABLE IF NOT EXISTS rule_categories (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_rule_categories_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // Cultures (collections of rule categories; used for per-space moderation configuration)
  await db.query(`
    CREATE TABLE IF NOT EXISTS cultures (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_cultures_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // Cultures ↔ Categories (many-to-many)
  await db.query(`
    CREATE TABLE IF NOT EXISTS culture_categories (
      culture_id BIGINT UNSIGNED NOT NULL,
      category_id BIGINT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (culture_id, category_id),
      KEY idx_culture_categories_category (category_id, culture_id),
      KEY idx_culture_categories_culture (culture_id, category_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // Spaces ↔ Cultures (many-to-many)
  await db.query(`
    CREATE TABLE IF NOT EXISTS space_cultures (
      space_id BIGINT UNSIGNED NOT NULL,
      culture_id BIGINT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (space_id, culture_id),
      KEY idx_space_cultures_culture (culture_id, space_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // Versioned rules metadata and content
  await db.query(`
    CREATE TABLE IF NOT EXISTS rules (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      slug VARCHAR(255) NOT NULL,
      title VARCHAR(255) NOT NULL,
      category_id BIGINT UNSIGNED NULL,
      visibility ENUM('public','authenticated','space_moderator','space_admin') NOT NULL DEFAULT 'public',
      current_version_id BIGINT UNSIGNED NULL,
      created_by BIGINT UNSIGNED NULL,
      updated_by BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_rules_slug (slug),
      KEY idx_rules_category (category_id),
      KEY idx_rules_current_version (current_version_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS rule_versions (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      rule_id BIGINT UNSIGNED NOT NULL,
      version INT UNSIGNED NOT NULL,
      markdown MEDIUMTEXT NOT NULL,
      html MEDIUMTEXT NOT NULL,
      short_description TEXT NULL,
      allowed_examples_markdown MEDIUMTEXT NULL,
      allowed_examples_html MEDIUMTEXT NULL,
      disallowed_examples_markdown MEDIUMTEXT NULL,
      disallowed_examples_html MEDIUMTEXT NULL,
      guidance_markdown MEDIUMTEXT NULL,
      guidance_html MEDIUMTEXT NULL,
      guidance_moderators_markdown MEDIUMTEXT NULL,
      guidance_moderators_html MEDIUMTEXT NULL,
      guidance_agents_markdown MEDIUMTEXT NULL,
      guidance_agents_html MEDIUMTEXT NULL,
      change_summary VARCHAR(512) NULL,
      created_by BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_rule_versions_rule_version (rule_id, version),
      KEY idx_rule_versions_rule (rule_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // Best-effort foreign key from moderation actions to rule versions
  try {
    await db.query(`
      ALTER TABLE moderation_actions
      ADD CONSTRAINT fk_moderation_actions_rule_version
      FOREIGN KEY (rule_version_id) REFERENCES rule_versions(id)
    `);
  } catch {}

  // Ensure cultures can evolve (idempotent best-effort)
  await db.query(`ALTER TABLE cultures ADD COLUMN IF NOT EXISTS description TEXT NULL`);
  try {
    await db.query(`ALTER TABLE cultures ADD UNIQUE KEY uniq_cultures_name (name)`);
  } catch {}

  // Best-effort foreign keys for space/culture joins
  try {
    await db.query(`
      ALTER TABLE space_cultures
      ADD CONSTRAINT fk_space_cultures_space
      FOREIGN KEY (space_id) REFERENCES spaces(id)
    `);
  } catch {}
  try {
    await db.query(`
      ALTER TABLE space_cultures
      ADD CONSTRAINT fk_space_cultures_culture
      FOREIGN KEY (culture_id) REFERENCES cultures(id)
    `);
  } catch {}

  // Best-effort foreign keys for culture/category joins
  try {
    await db.query(`
      ALTER TABLE culture_categories
      ADD CONSTRAINT fk_culture_categories_culture
      FOREIGN KEY (culture_id) REFERENCES cultures(id)
    `);
  } catch {}
  try {
    await db.query(`
      ALTER TABLE culture_categories
      ADD CONSTRAINT fk_culture_categories_category
      FOREIGN KEY (category_id) REFERENCES rule_categories(id)
    `);
  } catch {}

  // Ensure rule category column exists (idempotent best-effort)
  await db.query(`ALTER TABLE rules ADD COLUMN IF NOT EXISTS category_id BIGINT UNSIGNED NULL`);
  // Ensure rule version moderation fields exist (idempotent)
  await db.query(`ALTER TABLE rule_versions ADD COLUMN IF NOT EXISTS short_description TEXT NULL`);
  await db.query(`ALTER TABLE rule_versions ADD COLUMN IF NOT EXISTS allowed_examples_markdown MEDIUMTEXT NULL`);
  await db.query(`ALTER TABLE rule_versions ADD COLUMN IF NOT EXISTS allowed_examples_html MEDIUMTEXT NULL`);
  await db.query(`ALTER TABLE rule_versions ADD COLUMN IF NOT EXISTS disallowed_examples_markdown MEDIUMTEXT NULL`);
  await db.query(`ALTER TABLE rule_versions ADD COLUMN IF NOT EXISTS disallowed_examples_html MEDIUMTEXT NULL`);
  await db.query(`ALTER TABLE rule_versions ADD COLUMN IF NOT EXISTS guidance_markdown MEDIUMTEXT NULL`);
  await db.query(`ALTER TABLE rule_versions ADD COLUMN IF NOT EXISTS guidance_html MEDIUMTEXT NULL`);
  await db.query(`ALTER TABLE rule_versions ADD COLUMN IF NOT EXISTS guidance_moderators_markdown MEDIUMTEXT NULL`);
  await db.query(`ALTER TABLE rule_versions ADD COLUMN IF NOT EXISTS guidance_moderators_html MEDIUMTEXT NULL`);
  await db.query(`ALTER TABLE rule_versions ADD COLUMN IF NOT EXISTS guidance_agents_markdown MEDIUMTEXT NULL`);
  await db.query(`ALTER TABLE rule_versions ADD COLUMN IF NOT EXISTS guidance_agents_html MEDIUMTEXT NULL`);

  // Ensure rule drafts exist and can evolve (idempotent)
  await db.query(`
    CREATE TABLE IF NOT EXISTS rule_drafts (
      rule_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
      markdown MEDIUMTEXT NOT NULL,
      html MEDIUMTEXT NOT NULL,
      short_description TEXT NULL,
      allowed_examples_markdown MEDIUMTEXT NULL,
      allowed_examples_html MEDIUMTEXT NULL,
      disallowed_examples_markdown MEDIUMTEXT NULL,
      disallowed_examples_html MEDIUMTEXT NULL,
      guidance_markdown MEDIUMTEXT NULL,
      guidance_html MEDIUMTEXT NULL,
      guidance_moderators_markdown MEDIUMTEXT NULL,
      guidance_moderators_html MEDIUMTEXT NULL,
      guidance_agents_markdown MEDIUMTEXT NULL,
      guidance_agents_html MEDIUMTEXT NULL,
      updated_by BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  await db.query(`ALTER TABLE rule_drafts ADD COLUMN IF NOT EXISTS short_description TEXT NULL`);
  await db.query(`ALTER TABLE rule_drafts ADD COLUMN IF NOT EXISTS allowed_examples_markdown MEDIUMTEXT NULL`);
  await db.query(`ALTER TABLE rule_drafts ADD COLUMN IF NOT EXISTS allowed_examples_html MEDIUMTEXT NULL`);
  await db.query(`ALTER TABLE rule_drafts ADD COLUMN IF NOT EXISTS disallowed_examples_markdown MEDIUMTEXT NULL`);
  await db.query(`ALTER TABLE rule_drafts ADD COLUMN IF NOT EXISTS disallowed_examples_html MEDIUMTEXT NULL`);
  await db.query(`ALTER TABLE rule_drafts ADD COLUMN IF NOT EXISTS guidance_markdown MEDIUMTEXT NULL`);
  await db.query(`ALTER TABLE rule_drafts ADD COLUMN IF NOT EXISTS guidance_html MEDIUMTEXT NULL`);
  await db.query(`ALTER TABLE rule_drafts ADD COLUMN IF NOT EXISTS guidance_moderators_markdown MEDIUMTEXT NULL`);
  await db.query(`ALTER TABLE rule_drafts ADD COLUMN IF NOT EXISTS guidance_moderators_html MEDIUMTEXT NULL`);
  await db.query(`ALTER TABLE rule_drafts ADD COLUMN IF NOT EXISTS guidance_agents_markdown MEDIUMTEXT NULL`);
  await db.query(`ALTER TABLE rule_drafts ADD COLUMN IF NOT EXISTS guidance_agents_html MEDIUMTEXT NULL`);
  await db.query(`ALTER TABLE rule_drafts ADD COLUMN IF NOT EXISTS updated_by BIGINT UNSIGNED NULL`);

  // Best-effort backfill: legacy guidance -> moderators guidance.
  await db.query(
    `UPDATE rule_versions
        SET guidance_moderators_markdown = guidance_markdown
      WHERE guidance_moderators_markdown IS NULL
        AND guidance_markdown IS NOT NULL`
  );
  await db.query(
    `UPDATE rule_versions
        SET guidance_moderators_html = guidance_html
      WHERE guidance_moderators_html IS NULL
        AND guidance_html IS NOT NULL`
  );
  await db.query(
    `UPDATE rule_drafts
        SET guidance_moderators_markdown = guidance_markdown
      WHERE guidance_moderators_markdown IS NULL
        AND guidance_markdown IS NOT NULL`
  );
  await db.query(
    `UPDATE rule_drafts
        SET guidance_moderators_html = guidance_html
      WHERE guidance_moderators_html IS NULL
        AND guidance_html IS NOT NULL`
  );

  // Best-effort foreign key from rules to categories
  try {
    await db.query(`
      ALTER TABLE rules
      ADD CONSTRAINT fk_rules_category
      FOREIGN KEY (category_id) REFERENCES rule_categories(id)
    `);
  } catch {}

  // Best-effort foreign key from drafts to rules
  try {
    await db.query(`
      ALTER TABLE rule_drafts
      ADD CONSTRAINT fk_rule_drafts_rule
      FOREIGN KEY (rule_id) REFERENCES rules(id)
    `);
  } catch {}

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
      likes_count INT UNSIGNED NOT NULL DEFAULT 0,
      comments_count INT UNSIGNED NOT NULL DEFAULT 0,
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
  await db.query(`ALTER TABLE space_publications ADD COLUMN IF NOT EXISTS likes_count INT UNSIGNED NOT NULL DEFAULT 0`);
  await db.query(`ALTER TABLE space_publications ADD COLUMN IF NOT EXISTS comments_count INT UNSIGNED NOT NULL DEFAULT 0`);
  // Retroactive cleanup: clear legacy Personal ⇒ Global coupling
  try {
    await db.query(`
      UPDATE space_publications sp
      JOIN spaces s ON sp.space_id = s.id
      SET sp.visible_in_global = 0
      WHERE s.type = 'personal' AND sp.visible_in_global = 1
    `)
  } catch {}
  // Retroactive alignment: ensure Global space publications participate in the Global feed
  try {
    await db.query(`
      UPDATE space_publications sp
      JOIN spaces s ON sp.space_id = s.id
      SET sp.visible_in_global = 1
      WHERE sp.visible_in_global = 0
        AND (s.slug = 'global' OR s.slug = 'global-feed')
    `)
  } catch {}
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

  // Publication Likes (per publication, per user)
  await db.query(`
    CREATE TABLE IF NOT EXISTS publication_likes (
      publication_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (publication_id, user_id),
      KEY idx_publication_likes_user_created (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // Publication Comments (top-level + replies via parent_id)
  await db.query(`
    CREATE TABLE IF NOT EXISTS publication_comments (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      publication_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      parent_id BIGINT UNSIGNED NULL,
      body TEXT NOT NULL,
      status ENUM('visible','hidden') NOT NULL DEFAULT 'visible',
      edited_at DATETIME NULL,
      deleted_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_pc_pub_created (publication_id, created_at, id),
      KEY idx_pc_pub_parent_created (publication_id, parent_id, created_at, id),
      KEY idx_pc_user_created (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // Publication Reports (end-user reporting for moderation; scoped to a specific publication in a specific space)
  await db.query(`
    CREATE TABLE IF NOT EXISTS space_publication_reports (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      space_publication_id BIGINT UNSIGNED NOT NULL,
      space_id BIGINT UNSIGNED NOT NULL,
      production_id BIGINT UNSIGNED NULL,
      reporter_user_id BIGINT UNSIGNED NOT NULL,
      rule_id BIGINT UNSIGNED NOT NULL,
      rule_version_id BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_space_publication_reports_pub_reporter (space_publication_id, reporter_user_id),
      KEY idx_space_publication_reports_pub_created (space_publication_id, created_at),
      KEY idx_space_publication_reports_space_created (space_id, created_at),
      KEY idx_space_publication_reports_reporter_created (reporter_user_id, created_at),
      KEY idx_space_publication_reports_rule_created (rule_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // Best-effort foreign keys for publication reports
  try {
    await db.query(`
      ALTER TABLE space_publication_reports
      ADD CONSTRAINT fk_space_publication_reports_publication
      FOREIGN KEY (space_publication_id) REFERENCES space_publications(id)
    `);
  } catch {}
  try {
    await db.query(`
      ALTER TABLE space_publication_reports
      ADD CONSTRAINT fk_space_publication_reports_space
      FOREIGN KEY (space_id) REFERENCES spaces(id)
    `);
  } catch {}
  try {
    await db.query(`
      ALTER TABLE space_publication_reports
      ADD CONSTRAINT fk_space_publication_reports_production
      FOREIGN KEY (production_id) REFERENCES productions(id)
    `);
  } catch {}
  try {
    await db.query(`
      ALTER TABLE space_publication_reports
      ADD CONSTRAINT fk_space_publication_reports_reporter
      FOREIGN KEY (reporter_user_id) REFERENCES users(id)
    `);
  } catch {}
  try {
    await db.query(`
      ALTER TABLE space_publication_reports
      ADD CONSTRAINT fk_space_publication_reports_rule
      FOREIGN KEY (rule_id) REFERENCES rules(id)
    `);
  } catch {}
  try {
    await db.query(`
      ALTER TABLE space_publication_reports
      ADD CONSTRAINT fk_space_publication_reports_rule_version
      FOREIGN KEY (rule_version_id) REFERENCES rule_versions(id)
    `);
  } catch {}
}

// Seed baseline roles/permissions mappings for RBAC+
export async function seedRbac(db: DB) {
  const roles = [
    'viewer',
    'uploader',
    'publisher',
    'site_member',
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
    // site_member baseline own-permissions
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
    // Moderation & subscriptions (space scope)
    'moderation:suspend_posting',
    'moderation:ban',
    'subscription:manage_plans',
    'subscription:view_subscribers',
    'subscription:grant_comp',
    'subscription:gate_content',
    // Comments
    'comment:create',
    'comment:moderate',
    'comment:delete_any',
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
  // New: baseline permissions for all users (site_member)
  await give('site_member', [
    'video:upload',
    'video:edit_own',
    'video:delete_own',
    'video:publish_own',
    'video:unpublish_own',
    'comment:create',
  ]);
  await give('moderator', ['video:moderate', 'video:approve', 'comment:moderate', 'comment:delete_any']);
  await give('space_moderator', [
    'space:view_private',
    'video:publish_space',
    'video:unpublish_space',
    'video:approve_space',
    'moderation:suspend_posting',
    'subscription:view_subscribers',
    'comment:moderate',
    'comment:delete_any',
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
    'moderation:suspend_posting',
    'moderation:ban',
    'subscription:view_subscribers',
    'subscription:manage_plans',
    'subscription:grant_comp',
    'comment:moderate',
    'comment:delete_any',
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
    'comment:moderate',
    'comment:delete_any',
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
    'comment:moderate',
    'comment:delete_any',
  ]);
  await give('channel_member', ['video:publish_space']);
  // Admin gets all permissions
  await give('admin', perms);

  // Idempotent backfill: ensure every user has the site_member role
  try {
    await db.query(
      `INSERT IGNORE INTO user_roles (user_id, role_id)
       SELECT u.id, r.id
         FROM users u
         JOIN roles r ON r.name = 'site_member'`
    );
  } catch (e) {
    // ignore
  }

  // Idempotent backfill: ensure all channel members also have space_poster so they can post (with review policy enforced)
  try {
    await db.query(
      `INSERT IGNORE INTO user_space_roles (user_id, space_id, role_id)
         SELECT usr.user_id, usr.space_id, rposter.id
           FROM user_space_roles usr
           JOIN spaces s ON s.id = usr.space_id AND s.type = 'channel'
           JOIN roles rposter ON rposter.name = 'space_poster'
          WHERE NOT EXISTS (
                  SELECT 1 FROM user_space_roles x
                   WHERE x.user_id = usr.user_id AND x.space_id = usr.space_id AND x.role_id = rposter.id
                )`
    );
  } catch (e) {
    // ignore
  }
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

export type ProductionStatus = 'pending_media' | 'pending' | 'queued' | 'processing' | 'completed' | 'failed';

export type ProductionRow = {
  id: number;
  upload_id: number;
  user_id: number;
  name?: string | null;
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
