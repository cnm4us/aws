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

  return pool;
}

async function tableExists(db: DB, tableName: string): Promise<boolean> {
  const [rows] = await db.query(`SHOW TABLES LIKE ?`, [tableName])
  return Array.isArray(rows) && rows.length > 0
}

async function columnExists(db: DB, tableName: string, columnName: string): Promise<boolean> {
  const ident = /^[A-Za-z0-9_]+$/
  if (!ident.test(tableName) || !ident.test(columnName)) throw new Error('invalid_column_lookup')
  const [rows] = await db.query(`SHOW COLUMNS FROM \`${tableName}\` LIKE ?`, [columnName])
  return Array.isArray(rows) && rows.length > 0
}

async function migrateColumnNameIfNeeded(
  db: DB,
  tableName: string,
  oldName: string,
  newName: string,
  newDefinition: string
): Promise<void> {
  const ident = /^[A-Za-z0-9_]+$/
  if (!ident.test(tableName) || !ident.test(oldName) || !ident.test(newName)) throw new Error('invalid_column_name')
  if (oldName === newName) return

  const [oldExists, newExists] = await Promise.all([
    columnExists(db, tableName, oldName),
    columnExists(db, tableName, newName),
  ])

  if (oldExists && !newExists) {
    await db.query(`ALTER TABLE \`${tableName}\` CHANGE COLUMN \`${oldName}\` \`${newName}\` ${newDefinition}`)
    return
  }

  await db.query(`ALTER TABLE \`${tableName}\` ADD COLUMN IF NOT EXISTS \`${newName}\` ${newDefinition}`)

  if (oldExists && newExists) {
    await db.query(`UPDATE \`${tableName}\` SET \`${newName}\` = \`${oldName}\` WHERE \`${oldName}\` IS NOT NULL`)
    try { await db.query(`ALTER TABLE \`${tableName}\` DROP COLUMN \`${oldName}\``) } catch {}
  }
}

async function renameTableIfNeeded(db: DB, oldName: string, newName: string): Promise<void> {
  const ident = /^[A-Za-z0-9_]+$/
  if (!ident.test(oldName) || !ident.test(newName)) throw new Error('invalid_table_name')
  if (oldName === newName) return
  const [oldExists, newExists] = await Promise.all([
    tableExists(db, oldName),
    tableExists(db, newName),
  ])
  if (oldExists && !newExists) {
    await db.query(`RENAME TABLE \`${oldName}\` TO \`${newName}\``)
  }
}

async function assertNoDuplicateMessageCampaignKeys(db: DB): Promise<void> {
  const [rows] = await db.query(
    `
      SELECT campaign_key, COUNT(*) AS cnt
      FROM feed_messages
      WHERE campaign_key IS NOT NULL
        AND TRIM(campaign_key) <> ''
      GROUP BY campaign_key
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC, campaign_key ASC
      LIMIT 25
    `
  )
  const dupes = Array.isArray(rows) ? (rows as any[]) : []
  if (!dupes.length) return
  const sample = dupes.map((r) => `${String(r.campaign_key)}(${Number(r.cnt)})`).join(', ')
  throw new Error(`duplicate_message_campaign_keys:${sample}`)
}

async function reconcileLegacyPromptNamedTables(db: DB): Promise<void> {
  const oldMessagesExists = await tableExists(db, 'feed_prompts')
  const newMessagesExists = await tableExists(db, 'feed_messages')
  if (oldMessagesExists && newMessagesExists) {
    await db.query(`
      INSERT IGNORE INTO feed_messages
        (
          id,
          name,
          headline,
          body,
          cta_primary_label,
          cta_primary_href,
          cta_secondary_label,
          cta_secondary_href,
          media_upload_id,
          creative_json,
          type,
          applies_to_surface,
          tie_break_strategy,
          campaign_key,
          priority,
          status,
          starts_at,
          ends_at,
          created_by,
          updated_by,
          created_at,
          updated_at
        )
      SELECT
        id,
        name,
        headline,
        body,
        cta_primary_label,
        cta_primary_href,
        cta_secondary_label,
        cta_secondary_href,
        media_upload_id,
        creative_json,
        prompt_type,
        applies_to_surface,
        tie_break_strategy,
        campaign_key,
        priority,
        status,
        starts_at,
        ends_at,
        created_by,
        updated_by,
        created_at,
        updated_at
      FROM feed_prompts
    `)
    await db.query(`DROP TABLE IF EXISTS feed_prompts`)
  }

  const oldDecisionExists = await tableExists(db, 'prompt_decision_sessions')
  const newDecisionExists = await tableExists(db, 'message_decision_sessions')
  if (oldDecisionExists && newDecisionExists) {
    await db.query(`
      INSERT IGNORE INTO message_decision_sessions
        (
          session_id, surface, viewer_state,
          slides_viewed, watch_seconds,
          messages_shown_this_session, slides_since_last_message,
          converted_message_ids_json,
          last_message_shown_at, last_shown_message_id,
          last_decision_reason,
          created_at, updated_at
        )
      SELECT
        session_id, surface, viewer_state,
        slides_viewed, watch_seconds,
        prompts_shown_this_session, slides_since_last_prompt,
        converted_prompt_ids_json,
        last_prompt_shown_at, last_shown_prompt_id,
        last_decision_reason,
        created_at, updated_at
      FROM prompt_decision_sessions
    `)
    await db.query(`DROP TABLE IF EXISTS prompt_decision_sessions`)
  }

  const oldEventsExists = await tableExists(db, 'feed_prompt_events')
  const newEventsExists = await tableExists(db, 'feed_message_events')
  if (oldEventsExists && newEventsExists) {
    await db.query(`
      INSERT IGNORE INTO feed_message_events
        (
          event_type, surface, viewer_state,
          session_id, user_id,
          message_id, message_campaign_key,
          cta_kind, attributed,
          occurred_at, dedupe_bucket_start, dedupe_key,
          created_at
        )
      SELECT
        event_type, surface, viewer_state,
        session_id, user_id,
        prompt_id, prompt_campaign_key,
        cta_kind, attributed,
        occurred_at, dedupe_bucket_start, dedupe_key,
        created_at
      FROM feed_prompt_events
    `)
    await db.query(`DROP TABLE IF EXISTS feed_prompt_events`)
  }

  const oldDailyExists = await tableExists(db, 'feed_prompt_daily_stats')
  const newDailyExists = await tableExists(db, 'feed_message_daily_stats')
  if (oldDailyExists && newDailyExists) {
    await db.query(`
      INSERT INTO feed_message_daily_stats
        (
          date_utc, surface, message_id, message_campaign_key,
          viewer_state, event_type, total_events,
          created_at, updated_at
        )
      SELECT
        date_utc, surface, prompt_id, prompt_campaign_key,
        viewer_state, event_type, total_events,
        created_at, updated_at
      FROM feed_prompt_daily_stats
      ON DUPLICATE KEY UPDATE
        total_events = feed_message_daily_stats.total_events + VALUES(total_events),
        updated_at = GREATEST(feed_message_daily_stats.updated_at, VALUES(updated_at))
    `)
    await db.query(`DROP TABLE IF EXISTS feed_prompt_daily_stats`)
  }
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
  // uploads.kind is required for assets (video/logo/audio/image); historical environments used a migration script.
  // Keep this here to make fresh environments work without running separate migrations.
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS kind VARCHAR(16) NOT NULL DEFAULT 'video'`);
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS width INT NULL`);
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS height INT NULL`);
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS duration_seconds INT NULL`);
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS profile VARCHAR(128) NULL`);
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS asset_uuid CHAR(36) NULL`);
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS date_ymd CHAR(10) NULL`);
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS orientation ENUM('portrait','landscape') NULL`);
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS modified_filename VARCHAR(512) NULL`);
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS description TEXT NULL`);
  // Optional role/scoping for image assets (e.g. title_page, lower_third, overlay).
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS image_role VARCHAR(32) NULL`);
  // Ownership/scoping (optional; supports RBAC+ checks)
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS user_id BIGINT UNSIGNED NULL`);
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS channel_id BIGINT UNSIGNED NULL`);
  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS space_id BIGINT UNSIGNED NULL`);
	  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS origin_space_id BIGINT UNSIGNED NULL`);
	  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS source_deleted_at DATETIME NULL`);
	  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS is_system TINYINT(1) NOT NULL DEFAULT 0`);
	  // Plan 88: system video library uploads (curated source videos for clipping).
	  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS is_system_library TINYINT(1) NOT NULL DEFAULT 0`);
	  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS source_org VARCHAR(64) NULL`);
	  // Plan 68: discriminate raw uploads vs Create Video exports, and link export uploads back to their timeline project.
	  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS video_role ENUM('source','export') NULL`);
	  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS create_video_project_id BIGINT UNSIGNED NULL`);
	  // Plan 75: stable mapping from an export upload to its HLS production (for /exports "Prep for Publish" + "Publish" UX).
	  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS create_video_production_id BIGINT UNSIGNED NULL`);
	  // Plan 51: richer system audio metadata (selectable by creators)
	  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS artist VARCHAR(255) NULL`);
	  await db.query(`CREATE INDEX IF NOT EXISTS idx_uploads_user_id ON uploads (user_id)`);
	  await db.query(`CREATE INDEX IF NOT EXISTS idx_uploads_channel_id ON uploads (channel_id)`);
	  await db.query(`CREATE INDEX IF NOT EXISTS idx_uploads_space_id ON uploads (space_id)`);
	  await db.query(`CREATE INDEX IF NOT EXISTS idx_uploads_origin_space_id ON uploads (origin_space_id)`);
	  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_uploads_source_deleted_at ON uploads (source_deleted_at, id)`); } catch {}
		  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_uploads_kind_system_status ON uploads (kind, is_system, status, id)`); } catch {}
		  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_uploads_kind_role_status ON uploads (kind, image_role, status, id)`); } catch {}
		  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_uploads_artist ON uploads (artist, id)`); } catch {}
		  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_uploads_video_role_project ON uploads (video_role, create_video_project_id, id)`); } catch {}
		  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_uploads_video_role_production ON uploads (video_role, create_video_production_id, id)`); } catch {}
		  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_uploads_system_library ON uploads (is_system_library, source_org, status, id)`); } catch {}

      // Plan 116 / Plan 133: upload image variants (profiled derivatives for message/background/logo/lower-third usage).
      await db.query(`
        CREATE TABLE IF NOT EXISTS upload_image_variants (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          upload_id BIGINT UNSIGNED NOT NULL,
          profile_key VARCHAR(80) NOT NULL,
          variant_usage VARCHAR(32) NOT NULL,
          format ENUM('webp','png','jpeg','avif') NOT NULL DEFAULT 'webp',
          width INT UNSIGNED NULL,
          height INT UNSIGNED NULL,
          size_bytes BIGINT UNSIGNED NULL,
          s3_bucket VARCHAR(255) NOT NULL,
          s3_key VARCHAR(1024) NOT NULL,
          etag VARCHAR(128) NULL,
          status ENUM('ready','failed') NOT NULL DEFAULT 'ready',
          error_code VARCHAR(64) NULL,
          last_generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_upload_image_variants_upload_profile (upload_id, profile_key),
          KEY idx_upload_image_variants_upload_status (upload_id, status, profile_key),
          KEY idx_upload_image_variants_variant_usage_status (variant_usage, status, profile_key),
          KEY idx_upload_image_variants_profile_status (profile_key, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `)
      // Prefer non-reserved column name; keep back-compat for earlier "usage" attempts.
      try { await db.query(`ALTER TABLE upload_image_variants CHANGE COLUMN \`usage\` variant_usage VARCHAR(32) NOT NULL`) } catch {}
      try { await db.query(`ALTER TABLE upload_image_variants ADD COLUMN IF NOT EXISTS variant_usage VARCHAR(32) NOT NULL DEFAULT 'message_bg'`) } catch {}
      try { await db.query(`UPDATE upload_image_variants SET variant_usage = \`usage\` WHERE (variant_usage IS NULL OR variant_usage = '')`) } catch {}
      try { await db.query(`UPDATE upload_image_variants SET variant_usage = 'message_bg' WHERE variant_usage = 'prompt_bg'`) } catch {}
      try { await db.query(`UPDATE upload_image_variants SET profile_key = 'message_bg_p_1x' WHERE profile_key = 'prompt_bg_p_1x'`) } catch {}
      try { await db.query(`UPDATE upload_image_variants SET profile_key = 'message_bg_p_2x' WHERE profile_key = 'prompt_bg_p_2x'`) } catch {}
      try { await db.query(`UPDATE upload_image_variants SET profile_key = 'message_bg_l_1x' WHERE profile_key = 'prompt_bg_l_1x'`) } catch {}
      try { await db.query(`UPDATE upload_image_variants SET profile_key = 'message_bg_l_2x' WHERE profile_key = 'prompt_bg_l_2x'`) } catch {}
      try {
        await db.query(`
          UPDATE upload_image_variants
             SET status = 'failed',
                 error_code = 'legacy_message_bg_regen'
           WHERE profile_key IN ('message_bg_p_1x','message_bg_p_2x','message_bg_l_1x','message_bg_l_2x')
             AND s3_key LIKE '%/prompt_bg_%'
        `)
      } catch {}
      try { await db.query(`ALTER TABLE upload_image_variants ADD COLUMN IF NOT EXISTS format ENUM('webp','png','jpeg','avif') NOT NULL DEFAULT 'webp'`) } catch {}
      try { await db.query(`ALTER TABLE upload_image_variants ADD COLUMN IF NOT EXISTS width INT UNSIGNED NULL`) } catch {}
      try { await db.query(`ALTER TABLE upload_image_variants ADD COLUMN IF NOT EXISTS height INT UNSIGNED NULL`) } catch {}
      try { await db.query(`ALTER TABLE upload_image_variants ADD COLUMN IF NOT EXISTS size_bytes BIGINT UNSIGNED NULL`) } catch {}
      try { await db.query(`ALTER TABLE upload_image_variants ADD COLUMN IF NOT EXISTS s3_bucket VARCHAR(255) NOT NULL`) } catch {}
      try { await db.query(`ALTER TABLE upload_image_variants ADD COLUMN IF NOT EXISTS s3_key VARCHAR(1024) NOT NULL`) } catch {}
      try { await db.query(`ALTER TABLE upload_image_variants ADD COLUMN IF NOT EXISTS etag VARCHAR(128) NULL`) } catch {}
      try { await db.query(`ALTER TABLE upload_image_variants ADD COLUMN IF NOT EXISTS status ENUM('ready','failed') NOT NULL DEFAULT 'ready'`) } catch {}
      try { await db.query(`ALTER TABLE upload_image_variants ADD COLUMN IF NOT EXISTS error_code VARCHAR(64) NULL`) } catch {}
      try { await db.query(`ALTER TABLE upload_image_variants ADD COLUMN IF NOT EXISTS last_generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`) } catch {}
      try { await db.query(`CREATE INDEX IF NOT EXISTS idx_upload_image_variants_upload_status ON upload_image_variants (upload_id, status, profile_key)`) } catch {}
      try { await db.query(`CREATE INDEX IF NOT EXISTS idx_upload_image_variants_variant_usage_status ON upload_image_variants (variant_usage, status, profile_key)`) } catch {}
      try { await db.query(`CREATE INDEX IF NOT EXISTS idx_upload_image_variants_profile_status ON upload_image_variants (profile_key, status)`) } catch {}
      try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_upload_image_variants_upload_profile ON upload_image_variants (upload_id, profile_key)`) } catch {}

		  // Plan 51: audio tag taxonomy (genres/moods) + join table for system audio uploads
		  await db.query(`
		    CREATE TABLE IF NOT EXISTS audio_tags (
		      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
		      kind ENUM('genre','mood','theme','instrument') NOT NULL,
		      name VARCHAR(120) NOT NULL,
		      slug VARCHAR(140) NOT NULL,
		      sort_order INT NOT NULL DEFAULT 0,
		      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
		      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		      archived_at TIMESTAMP NULL DEFAULT NULL,
		      UNIQUE KEY uniq_audio_tags_kind_slug (kind, slug),
		      KEY idx_audio_tags_kind_archived (kind, archived_at, sort_order, id)
		    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
		  `)

		  // Plan 52: extend audio tag kinds for video themes + instruments.
		  try {
		    await db.query(`ALTER TABLE audio_tags MODIFY kind ENUM('genre','mood','theme','instrument') NOT NULL`)
		  } catch {}

			  await db.query(`
			    CREATE TABLE IF NOT EXISTS upload_audio_tags (
			      upload_id BIGINT UNSIGNED NOT NULL,
			      tag_id BIGINT UNSIGNED NOT NULL,
		      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
		      UNIQUE KEY uniq_upload_audio_tags_pair (upload_id, tag_id),
		      KEY idx_upload_audio_tags_upload (upload_id, tag_id),
		      KEY idx_upload_audio_tags_tag (tag_id, upload_id)
		    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
			  `)

        // Plan 67: per-user favorites for system audio (not a tag; user preference).
        await db.query(`
          CREATE TABLE IF NOT EXISTS user_audio_favorites (
            user_id BIGINT UNSIGNED NOT NULL,
            upload_id BIGINT UNSIGNED NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_user_audio_favorites (user_id, upload_id),
            KEY idx_user_audio_favorites_user (user_id, created_at, upload_id),
            KEY idx_user_audio_favorites_upload (upload_id, user_id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `)

        // Plan 78: per-user favorites + recents for video uploads.
        await db.query(`
          CREATE TABLE IF NOT EXISTS user_upload_prefs (
            user_id BIGINT UNSIGNED NOT NULL,
            upload_id BIGINT UNSIGNED NOT NULL,
            is_favorite TINYINT(1) NOT NULL DEFAULT 0,
            last_used_at DATETIME NULL DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_user_upload_prefs (user_id, upload_id),
            KEY idx_user_upload_prefs_user_fav (user_id, is_favorite, upload_id),
            KEY idx_user_upload_prefs_user_last_used (user_id, last_used_at, upload_id),
            KEY idx_user_upload_prefs_upload (upload_id, user_id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `)

			  // Plan 52: license sources (system audio vendor/platform) + one-time user upload terms acceptance
			  await db.query(`
			    CREATE TABLE IF NOT EXISTS license_sources (
			      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
			      kind VARCHAR(32) NOT NULL,
		      name VARCHAR(120) NOT NULL,
		      slug VARCHAR(140) NOT NULL,
		      sort_order INT NOT NULL DEFAULT 0,
		      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
		      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		      archived_at TIMESTAMP NULL DEFAULT NULL,
		      UNIQUE KEY uniq_license_sources_kind_slug (kind, slug),
		      KEY idx_license_sources_kind_archived (kind, archived_at, sort_order, id)
		    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
		  `)

		  await db.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS license_source_id BIGINT UNSIGNED NULL`)
		  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_uploads_license_source_id ON uploads (license_source_id, id)`); } catch {}

		  await db.query(`
		    CREATE TABLE IF NOT EXISTS user_terms_acceptances (
		      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
		      user_id BIGINT UNSIGNED NOT NULL,
		      terms_key VARCHAR(64) NOT NULL,
		      terms_version VARCHAR(32) NOT NULL,
		      accepted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
		      accepted_ip VARCHAR(64) NULL,
		      user_agent VARCHAR(512) NULL,
		      UNIQUE KEY uniq_user_terms_acceptances (user_id, terms_key, terms_version),
		      KEY idx_user_terms_user_key (user_id, terms_key, accepted_at, id)
		    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
		  `)

				  await db.query(`
				    CREATE TABLE IF NOT EXISTS logo_configurations (
		      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
		      owner_user_id BIGINT UNSIGNED NOT NULL,
		      name VARCHAR(120) NOT NULL,
          description TEXT NULL,
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

      // Lower-third image configs (Plan 46): image-based overlays configured like logos.
      // NOTE: This is intentionally separate from the legacy SVG-template lower thirds tables below.
      await db.query(`
	        CREATE TABLE IF NOT EXISTS lower_third_image_configurations (
	          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
	          owner_user_id BIGINT UNSIGNED NOT NULL,
	          name VARCHAR(120) NOT NULL,
            description TEXT NULL,
	          size_mode ENUM('pct','match_image') NOT NULL DEFAULT 'pct',
	          baseline_width SMALLINT UNSIGNED NOT NULL DEFAULT 1080,
	          position ENUM(
	            'top_left','top_center','top_right',
            'middle_left','middle_center','middle_right',
            'bottom_left','bottom_center','bottom_right',
            'center'
          ) NOT NULL DEFAULT 'bottom_center',
          size_pct_width TINYINT UNSIGNED NOT NULL DEFAULT 82,
          opacity_pct TINYINT UNSIGNED NOT NULL DEFAULT 100,
          timing_rule ENUM('entire','start_after','first_only','last_only') NOT NULL DEFAULT 'first_only',
          timing_seconds INT UNSIGNED NULL,
          fade ENUM('none','in','out','in_out') NOT NULL DEFAULT 'none',
          inset_x_preset VARCHAR(16) NULL,
          inset_y_preset VARCHAR(16) NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          archived_at TIMESTAMP NULL DEFAULT NULL,
	          KEY idx_lt_img_cfg_owner_archived (owner_user_id, archived_at, id)
	        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
	      `);
	      // Plan: allow switching between % scaling and "match image width @ baseline".
	      await db.query(`ALTER TABLE lower_third_image_configurations ADD COLUMN IF NOT EXISTS size_mode ENUM('pct','match_image') NOT NULL DEFAULT 'pct'`);
	      await db.query(`ALTER TABLE lower_third_image_configurations ADD COLUMN IF NOT EXISTS baseline_width SMALLINT UNSIGNED NOT NULL DEFAULT 1080`);
        await db.query(`ALTER TABLE lower_third_image_configurations ADD COLUMN IF NOT EXISTS description TEXT NULL`);
		  await db.query(`ALTER TABLE logo_configurations ADD COLUMN IF NOT EXISTS inset_x_preset VARCHAR(16) NULL`);
		  await db.query(`ALTER TABLE logo_configurations ADD COLUMN IF NOT EXISTS inset_y_preset VARCHAR(16) NULL`);
      await db.query(`ALTER TABLE logo_configurations ADD COLUMN IF NOT EXISTS description TEXT NULL`);
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
				  await db.query(`ALTER TABLE audio_configurations ADD COLUMN IF NOT EXISTS description TEXT NULL`);
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

				  // Plan: opener cutoff fade controls for abrupt mode (stored as ms offsets around t).
				  await db.query(`ALTER TABLE audio_configurations ADD COLUMN IF NOT EXISTS opener_cut_fade_before_ms SMALLINT UNSIGNED NULL`);
				  await db.query(`ALTER TABLE audio_configurations ADD COLUMN IF NOT EXISTS opener_cut_fade_after_ms SMALLINT UNSIGNED NULL`);

	          // --- Screen titles (plan_47) ---
	          await db.query(`
            CREATE TABLE IF NOT EXISTS screen_title_presets (
              id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              owner_user_id BIGINT UNSIGNED NOT NULL,
              name VARCHAR(120) NOT NULL,
              description TEXT NULL,
              style ENUM('none','pill','strip') NOT NULL DEFAULT 'pill',
              font_key VARCHAR(64) NOT NULL DEFAULT 'dejavu_sans_bold',
              size_key VARCHAR(16) NOT NULL DEFAULT 'medium',
              font_size_pct DECIMAL(4,2) NOT NULL DEFAULT 4.50,
              tracking_pct TINYINT NOT NULL DEFAULT 0,
              line_spacing_pct DECIMAL(5,2) NOT NULL DEFAULT 0.00,
              font_color VARCHAR(32) NOT NULL DEFAULT '#ffffff',
              shadow_color VARCHAR(32) NOT NULL DEFAULT '#000000',
              shadow_offset_px SMALLINT NOT NULL DEFAULT 2,
              shadow_blur_px SMALLINT UNSIGNED NOT NULL DEFAULT 0,
              shadow_opacity_pct TINYINT UNSIGNED NOT NULL DEFAULT 65,
              pill_bg_color VARCHAR(32) NOT NULL DEFAULT '#000000',
              pill_bg_opacity_pct TINYINT UNSIGNED NOT NULL DEFAULT 55,
              alignment ENUM('left','center','right') NOT NULL DEFAULT 'center',
              position ENUM('top','middle','bottom') NOT NULL DEFAULT 'top',
              -- Deprecated: max_width_pct + inset_* were used to approximate a "safe area" and wrap width.
              -- We now use explicit margins (pct of frame) and derive wrap width from left/right margins.
              max_width_pct TINYINT UNSIGNED NOT NULL DEFAULT 90,
              inset_x_preset VARCHAR(16) NULL,
              inset_y_preset VARCHAR(16) NULL,
              margin_left_pct DECIMAL(5,2) NULL,
              margin_right_pct DECIMAL(5,2) NULL,
              margin_top_pct DECIMAL(5,2) NULL,
              margin_bottom_pct DECIMAL(5,2) NULL,
              timing_rule ENUM('entire','first_only') NOT NULL DEFAULT 'first_only',
              timing_seconds INT UNSIGNED NULL,
              fade ENUM('none','in','out','in_out') NOT NULL DEFAULT 'out',
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              archived_at TIMESTAMP NULL DEFAULT NULL,
              KEY idx_screen_title_owner_archived (owner_user_id, archived_at, id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `);
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_screen_title_archived ON screen_title_presets (archived_at, id)`); } catch {}
          await db.query(`ALTER TABLE screen_title_presets ADD COLUMN IF NOT EXISTS font_size_pct DECIMAL(4,2) NOT NULL DEFAULT 4.50`);
          await db.query(`ALTER TABLE screen_title_presets ADD COLUMN IF NOT EXISTS tracking_pct TINYINT NOT NULL DEFAULT 0`);
          try { await db.query(`ALTER TABLE screen_title_presets MODIFY COLUMN tracking_pct TINYINT NOT NULL DEFAULT 0`); } catch {}
          await db.query(`ALTER TABLE screen_title_presets ADD COLUMN IF NOT EXISTS size_key VARCHAR(16) NOT NULL DEFAULT 'medium'`);
          await db.query(`ALTER TABLE screen_title_presets ADD COLUMN IF NOT EXISTS line_spacing_pct DECIMAL(5,2) NOT NULL DEFAULT 0.00`);
	          await db.query(`ALTER TABLE screen_title_presets ADD COLUMN IF NOT EXISTS font_color VARCHAR(32) NOT NULL DEFAULT '#ffffff'`);
	          // Shadow controls (color, offset, blur, opacity).
	          await db.query(`ALTER TABLE screen_title_presets ADD COLUMN IF NOT EXISTS shadow_color VARCHAR(32) NOT NULL DEFAULT '#000000'`);
	          await db.query(`ALTER TABLE screen_title_presets ADD COLUMN IF NOT EXISTS shadow_offset_px SMALLINT NOT NULL DEFAULT 2`);
	          await db.query(`ALTER TABLE screen_title_presets ADD COLUMN IF NOT EXISTS shadow_blur_px SMALLINT UNSIGNED NOT NULL DEFAULT 0`);
	          await db.query(`ALTER TABLE screen_title_presets ADD COLUMN IF NOT EXISTS shadow_opacity_pct TINYINT UNSIGNED NOT NULL DEFAULT 65`);
	          // Optional text gradient fill (PNG key under assets/font_gradients).
	          await db.query(`ALTER TABLE screen_title_presets ADD COLUMN IF NOT EXISTS font_gradient_key VARCHAR(128) NULL`);
	          // Optional outline controls (width as % of font size, opacity %, and color (NULL/'auto'/#rrggbb)).
	          await db.query(`ALTER TABLE screen_title_presets ADD COLUMN IF NOT EXISTS outline_width_pct DECIMAL(5,2) NULL`);
	          await db.query(`ALTER TABLE screen_title_presets ADD COLUMN IF NOT EXISTS outline_opacity_pct TINYINT UNSIGNED NULL`);
	          await db.query(`ALTER TABLE screen_title_presets ADD COLUMN IF NOT EXISTS outline_color VARCHAR(32) NULL`);

	          // New: explicit margins (pct of frame).
	          await db.query(`ALTER TABLE screen_title_presets ADD COLUMN IF NOT EXISTS margin_left_pct DECIMAL(5,2) NULL`);
	          await db.query(`ALTER TABLE screen_title_presets ADD COLUMN IF NOT EXISTS margin_right_pct DECIMAL(5,2) NULL`);
	          await db.query(`ALTER TABLE screen_title_presets ADD COLUMN IF NOT EXISTS margin_top_pct DECIMAL(5,2) NULL`);
	          await db.query(`ALTER TABLE screen_title_presets ADD COLUMN IF NOT EXISTS margin_bottom_pct DECIMAL(5,2) NULL`);

	          // Plan: migrate style enum from (pill/outline/strip) to background (none/pill/strip).
	          // Preserve old "outline" behavior by backfilling explicit outline settings before conversion.
	          try {
	            const [styleRows] = await db.query(
	              `SELECT COLUMN_TYPE
	                 FROM INFORMATION_SCHEMA.COLUMNS
	                WHERE TABLE_SCHEMA = DATABASE()
	                  AND TABLE_NAME = 'screen_title_presets'
	                  AND COLUMN_NAME = 'style'
	                LIMIT 1`
	            )
	            const styleType = (styleRows as any[])[0]?.COLUMN_TYPE
	            if (typeof styleType === 'string' && styleType.includes("'outline'") && !styleType.includes("'none'")) {
	              // Backfill outline defaults for legacy outline presets.
	              try {
	                await db.query(
	                  `UPDATE screen_title_presets
	                      SET outline_width_pct = COALESCE(outline_width_pct, 1.20),
	                          outline_opacity_pct = COALESCE(outline_opacity_pct, 45),
	                          outline_color = NULL
	                    WHERE style = 'outline'`
	                )
	              } catch {}
	              // Widen to VARCHAR to allow re-mapping values.
	              await db.query(`ALTER TABLE screen_title_presets MODIFY COLUMN style VARCHAR(16) NOT NULL DEFAULT 'pill'`)
	              await db.query(`UPDATE screen_title_presets SET style = 'none' WHERE style = 'outline'`)
	              await db.query(
	                `ALTER TABLE screen_title_presets
	                   MODIFY COLUMN style ENUM('none','pill','strip')
	                   NOT NULL DEFAULT 'pill'`
	              )
	            }
	          } catch {}

	          // Backfill margins from legacy insets when missing.
	          try {
	            await db.query(
	              `UPDATE screen_title_presets
	                  SET margin_left_pct = CASE COALESCE(inset_x_preset,'')
	                    WHEN 'small' THEN 6.00
	                    WHEN 'large' THEN 14.00
	                    WHEN 'medium' THEN 10.00
	                    ELSE 10.00
	                  END
	                WHERE margin_left_pct IS NULL`
	            )
	          } catch {}
	          try {
	            await db.query(
	              `UPDATE screen_title_presets
	                  SET margin_right_pct = CASE COALESCE(inset_x_preset,'')
	                    WHEN 'small' THEN 6.00
	                    WHEN 'large' THEN 14.00
	                    WHEN 'medium' THEN 10.00
	                    ELSE 10.00
	                  END
	                WHERE margin_right_pct IS NULL`
	            )
	          } catch {}
	          try {
	            await db.query(
	              `UPDATE screen_title_presets
	                  SET margin_top_pct = CASE COALESCE(inset_y_preset,'')
	                    WHEN 'small' THEN 6.00
	                    WHEN 'large' THEN 14.00
	                    WHEN 'medium' THEN 10.00
	                    ELSE 10.00
	                  END
	                WHERE margin_top_pct IS NULL`
	            )
	          } catch {}
	          try {
	            await db.query(
	              `UPDATE screen_title_presets
	                  SET margin_bottom_pct = CASE COALESCE(inset_y_preset,'')
	                    WHEN 'small' THEN 6.00
	                    WHEN 'large' THEN 14.00
	                    WHEN 'medium' THEN 10.00
	                    ELSE 10.00
	                  END
	                WHERE margin_bottom_pct IS NULL`
	            )
	          } catch {}
	          await db.query(`ALTER TABLE screen_title_presets ADD COLUMN IF NOT EXISTS pill_bg_color VARCHAR(32) NOT NULL DEFAULT '#000000'`);
          await db.query(`ALTER TABLE screen_title_presets ADD COLUMN IF NOT EXISTS pill_bg_opacity_pct TINYINT UNSIGNED NOT NULL DEFAULT 55`);
          // Plan: screen title text alignment (left/center/right).
          await db.query(`ALTER TABLE screen_title_presets ADD COLUMN IF NOT EXISTS alignment ENUM('left','center','right') NOT NULL DEFAULT 'center'`);
          // Plan: simplify screen title positions to top/middle/bottom.
          // Existing tables created with older enums won't accept these values, so we:
          // 1) temporarily widen to VARCHAR
          // 2) backfill
          // 3) tighten to ENUM('top','middle','bottom')
          try {
            const [posRows] = await db.query(
              `SELECT COLUMN_TYPE
                 FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'screen_title_presets'
                  AND COLUMN_NAME = 'position'
                LIMIT 1`
            )
            const colType = (posRows as any[])[0]?.COLUMN_TYPE
            if (typeof colType === 'string' && colType.includes('top_left') && !colType.includes("'middle'")) {
              await db.query(`ALTER TABLE screen_title_presets MODIFY COLUMN position VARCHAR(16) NOT NULL DEFAULT 'top'`)
              await db.query(
                `UPDATE screen_title_presets
                    SET position = CASE
                      WHEN position IN ('top_left','top_center','top_right','top') THEN 'top'
                      WHEN position IN ('bottom_left','bottom_center','bottom_right','bottom') THEN 'bottom'
                      WHEN position IN ('middle_center','center','middle') THEN 'middle'
                      ELSE 'top'
                    END`
              )
              await db.query(
                `ALTER TABLE screen_title_presets
                   MODIFY COLUMN position ENUM('top','middle','bottom')
                   NOT NULL DEFAULT 'top'`
              )
            }
          } catch {}

          // --- Visualizer presets (plan_105) ---
          await db.query(`
            CREATE TABLE IF NOT EXISTS visualizer_presets (
              id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              owner_user_id BIGINT UNSIGNED NOT NULL,
              name VARCHAR(120) NOT NULL,
              description TEXT NULL,
              style ENUM('wave_line','wave_fill','center_wave','spectrum_bars','dot_spectrum','mirror_bars','stacked_bands','ring_wave','pulse_orb','radial_bars') NOT NULL DEFAULT 'wave_line',
              fg_color VARCHAR(32) NOT NULL DEFAULT '#d4af37',
              bg_color VARCHAR(32) NOT NULL DEFAULT 'transparent',
              opacity DECIMAL(4,2) NOT NULL DEFAULT 1.00,
              scale ENUM('linear','log') NOT NULL DEFAULT 'linear',
              bar_count TINYINT UNSIGNED NOT NULL DEFAULT 48,
              spectrum_mode ENUM('full','voice') NOT NULL DEFAULT 'full',
              gradient_enabled TINYINT(1) NOT NULL DEFAULT 0,
              gradient_start VARCHAR(32) NOT NULL DEFAULT '#d4af37',
              gradient_end VARCHAR(32) NOT NULL DEFAULT '#f7d774',
              gradient_mode ENUM('vertical','horizontal') NOT NULL DEFAULT 'vertical',
              clip_mode ENUM('none','rect') NOT NULL DEFAULT 'none',
              clip_inset_pct TINYINT UNSIGNED NOT NULL DEFAULT 6,
              clip_height_pct TINYINT UNSIGNED NOT NULL DEFAULT 100,
              instances_json JSON NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              archived_at TIMESTAMP NULL DEFAULT NULL,
              KEY idx_visualizer_owner_archived (owner_user_id, archived_at, id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `);
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_visualizer_archived ON visualizer_presets (archived_at, id)`); } catch {}
          await db.query(`ALTER TABLE visualizer_presets ADD COLUMN IF NOT EXISTS style ENUM('wave_line','wave_fill','center_wave','spectrum_bars','dot_spectrum','mirror_bars','stacked_bands','ring_wave','pulse_orb','radial_bars') NOT NULL DEFAULT 'wave_line'`);
          try {
            await db.query(
              `ALTER TABLE visualizer_presets
                 MODIFY COLUMN style ENUM('wave_line','wave_fill','center_wave','spectrum_bars','dot_spectrum','mirror_bars','stacked_bands','ring_wave','pulse_orb','radial_bars')
                 NOT NULL DEFAULT 'wave_line'`
            )
          } catch {}
          await db.query(`ALTER TABLE visualizer_presets ADD COLUMN IF NOT EXISTS fg_color VARCHAR(32) NOT NULL DEFAULT '#d4af37'`);
          await db.query(`ALTER TABLE visualizer_presets ADD COLUMN IF NOT EXISTS bg_color VARCHAR(32) NOT NULL DEFAULT 'transparent'`);
          await db.query(`ALTER TABLE visualizer_presets ADD COLUMN IF NOT EXISTS opacity DECIMAL(4,2) NOT NULL DEFAULT 1.00`);
          await db.query(`ALTER TABLE visualizer_presets ADD COLUMN IF NOT EXISTS scale ENUM('linear','log') NOT NULL DEFAULT 'linear'`);
          await db.query(`ALTER TABLE visualizer_presets ADD COLUMN IF NOT EXISTS bar_count TINYINT UNSIGNED NOT NULL DEFAULT 48`);
          await db.query(`ALTER TABLE visualizer_presets ADD COLUMN IF NOT EXISTS spectrum_mode ENUM('full','voice') NOT NULL DEFAULT 'full'`);
          await db.query(`ALTER TABLE visualizer_presets ADD COLUMN IF NOT EXISTS gradient_enabled TINYINT(1) NOT NULL DEFAULT 0`);
          await db.query(`ALTER TABLE visualizer_presets ADD COLUMN IF NOT EXISTS gradient_start VARCHAR(32) NOT NULL DEFAULT '#d4af37'`);
          await db.query(`ALTER TABLE visualizer_presets ADD COLUMN IF NOT EXISTS gradient_end VARCHAR(32) NOT NULL DEFAULT '#f7d774'`);
          await db.query(`ALTER TABLE visualizer_presets ADD COLUMN IF NOT EXISTS gradient_mode ENUM('vertical','horizontal') NOT NULL DEFAULT 'vertical'`);
          await db.query(`ALTER TABLE visualizer_presets ADD COLUMN IF NOT EXISTS clip_mode ENUM('none','rect') NOT NULL DEFAULT 'none'`);
          await db.query(`ALTER TABLE visualizer_presets ADD COLUMN IF NOT EXISTS clip_inset_pct TINYINT UNSIGNED NOT NULL DEFAULT 6`);
          await db.query(`ALTER TABLE visualizer_presets ADD COLUMN IF NOT EXISTS clip_height_pct TINYINT UNSIGNED NOT NULL DEFAULT 100`);
          await db.query(`ALTER TABLE visualizer_presets ADD COLUMN IF NOT EXISTS instances_json JSON NULL`);
          await db.query(`ALTER TABLE visualizer_presets ADD COLUMN IF NOT EXISTS source_template_key VARCHAR(120) NULL`);
          await db.query(`ALTER TABLE visualizer_presets ADD COLUMN IF NOT EXISTS is_starter TINYINT(1) NOT NULL DEFAULT 0`);
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_visualizer_source_template ON visualizer_presets (source_template_key)`); } catch {}
          try {
            await db.query(`ALTER TABLE visualizer_presets ADD UNIQUE KEY uniq_visualizer_owner_template (owner_user_id, source_template_key)`)
          } catch {}

          await db.query(`
            CREATE TABLE IF NOT EXISTS visualizer_preset_templates (
              id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              template_key VARCHAR(120) NOT NULL,
              name VARCHAR(120) NOT NULL,
              description TEXT NULL,
              bg_color VARCHAR(32) NOT NULL DEFAULT 'transparent',
              instances_json JSON NOT NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              archived_at TIMESTAMP NULL DEFAULT NULL,
              UNIQUE KEY uniq_visualizer_template_key (template_key),
              KEY idx_visualizer_template_archived (archived_at, id),
              KEY idx_visualizer_template_key_archived (template_key, archived_at, id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `);
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_visualizer_templates_archived ON visualizer_preset_templates (archived_at, id)`); } catch {}

          await renameTableIfNeeded(db, 'feed_prompts', 'feed_messages')

          // --- Feed messages registry (plan_114A) ---
          await db.query(`
            CREATE TABLE IF NOT EXISTS feed_messages (
              id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              name VARCHAR(120) NOT NULL,
              headline VARCHAR(280) NOT NULL,
              body TEXT NULL,
              cta_primary_label VARCHAR(100) NOT NULL,
              cta_primary_href VARCHAR(1200) NOT NULL,
              cta_secondary_label VARCHAR(100) NULL,
              cta_secondary_href VARCHAR(1200) NULL,
              media_upload_id BIGINT UNSIGNED NULL,
              creative_json JSON NULL,
              type ENUM('register_login','fund_drive','subscription_upgrade','sponsor_message','feature_announcement') NOT NULL DEFAULT 'register_login',
              applies_to_surface ENUM('global_feed','group_feed','channel_feed') NOT NULL DEFAULT 'global_feed',
              tie_break_strategy ENUM('first','round_robin','weighted_random') NOT NULL DEFAULT 'round_robin',
              delivery_scope ENUM('standalone_only','journey_only','both') NOT NULL DEFAULT 'both',
              campaign_key VARCHAR(64) NULL,
              campaign_category VARCHAR(64) NULL,
              priority INT NOT NULL DEFAULT 100,
              status ENUM('draft','active','paused','archived') NOT NULL DEFAULT 'draft',
              starts_at DATETIME NULL,
              ends_at DATETIME NULL,
              created_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
              updated_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              KEY idx_feed_messages_status_campaign_key (status, campaign_key, priority, id),
              KEY idx_feed_messages_active_window (status, starts_at, ends_at, priority, id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `)
          await db.query(`ALTER TABLE feed_messages ADD COLUMN IF NOT EXISTS name VARCHAR(120) NOT NULL`)
          await db.query(`ALTER TABLE feed_messages ADD COLUMN IF NOT EXISTS headline VARCHAR(280) NOT NULL`)
          await db.query(`ALTER TABLE feed_messages ADD COLUMN IF NOT EXISTS body TEXT NULL`)
          await db.query(`ALTER TABLE feed_messages ADD COLUMN IF NOT EXISTS cta_primary_label VARCHAR(100) NOT NULL`)
          await db.query(`ALTER TABLE feed_messages ADD COLUMN IF NOT EXISTS cta_primary_href VARCHAR(1200) NOT NULL`)
          await db.query(`ALTER TABLE feed_messages ADD COLUMN IF NOT EXISTS cta_secondary_label VARCHAR(100) NULL`)
          await db.query(`ALTER TABLE feed_messages ADD COLUMN IF NOT EXISTS cta_secondary_href VARCHAR(1200) NULL`)
          await db.query(`ALTER TABLE feed_messages ADD COLUMN IF NOT EXISTS media_upload_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE feed_messages ADD COLUMN IF NOT EXISTS creative_json JSON NULL`)
          await migrateColumnNameIfNeeded(
            db,
            'feed_messages',
            'prompt_type',
            'type',
            `ENUM('register_login','fund_drive','subscription_upgrade','sponsor_message','feature_announcement') NOT NULL DEFAULT 'register_login'`
          )
          await db.query(`ALTER TABLE feed_messages ADD COLUMN IF NOT EXISTS type ENUM('register_login','fund_drive','subscription_upgrade','sponsor_message','feature_announcement') NOT NULL DEFAULT 'register_login'`)
          await db.query(`ALTER TABLE feed_messages ADD COLUMN IF NOT EXISTS applies_to_surface ENUM('global_feed','group_feed','channel_feed') NOT NULL DEFAULT 'global_feed'`)
          try {
            await db.query(
              `ALTER TABLE feed_messages
                 MODIFY COLUMN applies_to_surface ENUM('global_feed','group_feed','channel_feed')
                 NOT NULL DEFAULT 'global_feed'`
            )
          } catch {}
          await db.query(`ALTER TABLE feed_messages ADD COLUMN IF NOT EXISTS tie_break_strategy ENUM('first','round_robin','weighted_random') NOT NULL DEFAULT 'round_robin'`)
          await db.query(`ALTER TABLE feed_messages ADD COLUMN IF NOT EXISTS delivery_scope ENUM('standalone_only','journey_only','both') NOT NULL DEFAULT 'both'`)
          await db.query(`ALTER TABLE feed_messages ADD COLUMN IF NOT EXISTS campaign_key VARCHAR(64) NULL`)
          await db.query(`ALTER TABLE feed_messages ADD COLUMN IF NOT EXISTS campaign_category VARCHAR(64) NULL`)
          await db.query(`ALTER TABLE feed_messages ADD COLUMN IF NOT EXISTS eligibility_ruleset_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE feed_messages ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 100`)
          await db.query(`ALTER TABLE feed_messages ADD COLUMN IF NOT EXISTS status ENUM('draft','active','paused','archived') NOT NULL DEFAULT 'draft'`)
          await db.query(`ALTER TABLE feed_messages ADD COLUMN IF NOT EXISTS starts_at DATETIME NULL`)
          await db.query(`ALTER TABLE feed_messages ADD COLUMN IF NOT EXISTS ends_at DATETIME NULL`)
          await db.query(`ALTER TABLE feed_messages ADD COLUMN IF NOT EXISTS created_by BIGINT UNSIGNED NOT NULL DEFAULT 0`)
          await db.query(`ALTER TABLE feed_messages ADD COLUMN IF NOT EXISTS updated_by BIGINT UNSIGNED NOT NULL DEFAULT 0`)
          try { await db.query(`ALTER TABLE feed_messages DROP INDEX idx_feed_prompts_kind_status`); } catch {}
          try { await db.query(`ALTER TABLE feed_messages DROP COLUMN kind`); } catch {}
          try {
            await db.query(`
              UPDATE feed_messages
                 SET type = CASE
                   WHEN LOWER(COALESCE(category, '')) = 'register_prompt' THEN 'register_login'
                   WHEN LOWER(COALESCE(category, '')) IN ('fund_drive', 'donation_prompt', 'support_prompt') THEN 'fund_drive'
                   WHEN LOWER(COALESCE(category, '')) IN ('subscription_prompt', 'subscription_offer', 'upgrade_prompt') THEN 'subscription_upgrade'
                   WHEN LOWER(COALESCE(category, '')) IN ('sponsor', 'sponsor_message') THEN 'sponsor_message'
                   ELSE 'feature_announcement'
                 END
               WHERE type IS NULL
                  OR type NOT IN ('register_login','fund_drive','subscription_upgrade','sponsor_message','feature_announcement')
            `)
          } catch {}
          try {
            await db.query(`
              UPDATE feed_messages
                 SET campaign_key = NULLIF(TRIM(category), '')
               WHERE (campaign_key IS NULL OR campaign_key = '')
                 AND COALESCE(category, '') <> ''
            `)
          } catch {}
          try { await db.query(`ALTER TABLE feed_messages DROP COLUMN category`) } catch {}
          try { await db.query(`DROP INDEX idx_feed_prompts_status_campaign_key ON feed_messages`) } catch {}
          try { await db.query(`DROP INDEX idx_feed_prompts_active_window ON feed_messages`) } catch {}
          try { await db.query(`DROP INDEX idx_feed_prompts_active_type ON feed_messages`) } catch {}
          try { await db.query(`DROP INDEX idx_feed_prompts_surface_audience_type_active ON feed_messages`) } catch {}
          try { await db.query(`DROP INDEX idx_feed_messages_surface_audience_type_active ON feed_messages`) } catch {}
          try { await db.query(`ALTER TABLE feed_messages DROP COLUMN audience_segment`) } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_messages_status_campaign_key ON feed_messages (status, campaign_key, priority, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_messages_active_window ON feed_messages (status, starts_at, ends_at, priority, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_messages_active_type ON feed_messages (status, type, starts_at, ends_at, priority, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_messages_surface_type_active ON feed_messages (applies_to_surface, status, type, starts_at, ends_at, priority, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_messages_ruleset_id ON feed_messages (eligibility_ruleset_id, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_messages_delivery_scope ON feed_messages (delivery_scope, status, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_messages_campaign_category ON feed_messages (campaign_category, status, id)`); } catch {}
          await assertNoDuplicateMessageCampaignKeys(db)
          try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_feed_messages_campaign_key ON feed_messages (campaign_key)`); } catch {}

          // --- Message multi-surface targeting (plan_147A) ---
          await db.query(`
            CREATE TABLE IF NOT EXISTS feed_message_surfaces (
              id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              message_id BIGINT UNSIGNED NOT NULL,
              surface ENUM('global_feed','group_feed','channel_feed') NOT NULL,
              targeting_mode ENUM('all','selected') NOT NULL DEFAULT 'all',
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_feed_message_surfaces_message_surface (message_id, surface),
              KEY idx_feed_message_surfaces_surface_mode (surface, targeting_mode, message_id),
              KEY idx_feed_message_surfaces_message (message_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `)
          await db.query(`ALTER TABLE feed_message_surfaces ADD COLUMN IF NOT EXISTS message_id BIGINT UNSIGNED NOT NULL`)
          await db.query(`ALTER TABLE feed_message_surfaces ADD COLUMN IF NOT EXISTS surface ENUM('global_feed','group_feed','channel_feed') NOT NULL`)
          await db.query(`ALTER TABLE feed_message_surfaces ADD COLUMN IF NOT EXISTS targeting_mode ENUM('all','selected') NOT NULL DEFAULT 'all'`)
          try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_feed_message_surfaces_message_surface ON feed_message_surfaces (message_id, surface)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_surfaces_surface_mode ON feed_message_surfaces (surface, targeting_mode, message_id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_surfaces_message ON feed_message_surfaces (message_id)`); } catch {}

          await db.query(`
            CREATE TABLE IF NOT EXISTS feed_message_targets (
              id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              message_id BIGINT UNSIGNED NOT NULL,
              surface ENUM('group_feed','channel_feed') NOT NULL,
              target_id BIGINT UNSIGNED NOT NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_feed_message_targets_message_surface_target (message_id, surface, target_id),
              KEY idx_feed_message_targets_surface_target (surface, target_id, message_id),
              KEY idx_feed_message_targets_message_surface (message_id, surface)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `)
          await db.query(`ALTER TABLE feed_message_targets ADD COLUMN IF NOT EXISTS message_id BIGINT UNSIGNED NOT NULL`)
          await db.query(`ALTER TABLE feed_message_targets ADD COLUMN IF NOT EXISTS surface ENUM('group_feed','channel_feed') NOT NULL`)
          await db.query(`ALTER TABLE feed_message_targets ADD COLUMN IF NOT EXISTS target_id BIGINT UNSIGNED NOT NULL`)
          try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_feed_message_targets_message_surface_target ON feed_message_targets (message_id, surface, target_id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_targets_surface_target ON feed_message_targets (surface, target_id, message_id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_targets_message_surface ON feed_message_targets (message_id, surface)`); } catch {}

          try {
            await db.query(`
              INSERT IGNORE INTO feed_message_surfaces (message_id, surface, targeting_mode)
              SELECT id, applies_to_surface, 'all'
              FROM feed_messages
            `)
          } catch {}

          // --- Eligibility rulesets for feed messages (plan_142A) ---
          await db.query(`
            CREATE TABLE IF NOT EXISTS feed_message_eligibility_rulesets (
              id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              name VARCHAR(120) NOT NULL,
              status ENUM('draft','active','archived') NOT NULL DEFAULT 'draft',
              description VARCHAR(500) NULL,
              criteria_json JSON NOT NULL,
              created_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
              updated_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              KEY idx_feed_message_rulesets_status (status, id),
              KEY idx_feed_message_rulesets_name (name, id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `)
          await db.query(`ALTER TABLE feed_message_eligibility_rulesets ADD COLUMN IF NOT EXISTS name VARCHAR(120) NOT NULL`)
          await db.query(`ALTER TABLE feed_message_eligibility_rulesets ADD COLUMN IF NOT EXISTS status ENUM('draft','active','archived') NOT NULL DEFAULT 'draft'`)
          await db.query(`ALTER TABLE feed_message_eligibility_rulesets ADD COLUMN IF NOT EXISTS description VARCHAR(500) NULL`)
          await db.query(`ALTER TABLE feed_message_eligibility_rulesets ADD COLUMN IF NOT EXISTS criteria_json JSON NULL`)
          try { await db.query(`UPDATE feed_message_eligibility_rulesets SET criteria_json = JSON_OBJECT('version', 1, 'inclusion', JSON_ARRAY(), 'exclusion', JSON_ARRAY()) WHERE criteria_json IS NULL`) } catch {}
          try { await db.query(`ALTER TABLE feed_message_eligibility_rulesets MODIFY COLUMN criteria_json JSON NOT NULL`) } catch {}
          await db.query(`ALTER TABLE feed_message_eligibility_rulesets ADD COLUMN IF NOT EXISTS created_by BIGINT UNSIGNED NOT NULL DEFAULT 0`)
          await db.query(`ALTER TABLE feed_message_eligibility_rulesets ADD COLUMN IF NOT EXISTS updated_by BIGINT UNSIGNED NOT NULL DEFAULT 0`)
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_rulesets_status ON feed_message_eligibility_rulesets (status, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_rulesets_name ON feed_message_eligibility_rulesets (name, id)`); } catch {}

          // --- Reusable CTA definitions for feed messages (plan_138A) ---
          await db.query(`
            CREATE TABLE IF NOT EXISTS feed_message_cta_definitions (
              id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              name VARCHAR(120) NOT NULL,
              status ENUM('draft','active','archived') NOT NULL DEFAULT 'draft',
              scope_type ENUM('global','space') NOT NULL DEFAULT 'global',
              scope_space_id BIGINT UNSIGNED NULL,
              intent_key ENUM('support','defer','login','register','donate','subscribe','upgrade','verify_email','verify_phone','visit_sponsor','visit_link') NOT NULL DEFAULT 'visit_link',
              executor_type ENUM('internal_link','provider_checkout','verification_flow','api_action','advance_slide') NOT NULL DEFAULT 'internal_link',
              completion_contract ENUM('on_click','on_return','on_verified','none') NOT NULL DEFAULT 'on_click',
              label_default VARCHAR(100) NOT NULL,
              config_json JSON NOT NULL,
              created_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
              updated_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              KEY idx_feed_message_cta_scope_status (scope_type, scope_space_id, status, id),
              KEY idx_feed_message_cta_intent_status (intent_key, status, id),
              KEY idx_feed_message_cta_executor_status (executor_type, status, id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `)
          await db.query(`ALTER TABLE feed_message_cta_definitions ADD COLUMN IF NOT EXISTS name VARCHAR(120) NOT NULL`)
          await db.query(`ALTER TABLE feed_message_cta_definitions ADD COLUMN IF NOT EXISTS status ENUM('draft','active','archived') NOT NULL DEFAULT 'draft'`)
          await db.query(`ALTER TABLE feed_message_cta_definitions ADD COLUMN IF NOT EXISTS scope_type ENUM('global','space') NOT NULL DEFAULT 'global'`)
          await db.query(`ALTER TABLE feed_message_cta_definitions ADD COLUMN IF NOT EXISTS scope_space_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE feed_message_cta_definitions ADD COLUMN IF NOT EXISTS intent_key ENUM('support','defer','login','register','donate','subscribe','upgrade','verify_email','verify_phone','visit_sponsor','visit_link') NOT NULL DEFAULT 'visit_link'`)
          await db.query(`ALTER TABLE feed_message_cta_definitions ADD COLUMN IF NOT EXISTS executor_type ENUM('internal_link','provider_checkout','verification_flow','api_action','advance_slide') NOT NULL DEFAULT 'internal_link'`)
          await db.query(`ALTER TABLE feed_message_cta_definitions ADD COLUMN IF NOT EXISTS completion_contract ENUM('on_click','on_return','on_verified','none') NOT NULL DEFAULT 'on_click'`)
          await db.query(`ALTER TABLE feed_message_cta_definitions ADD COLUMN IF NOT EXISTS label_default VARCHAR(100) NOT NULL`)
          await db.query(`ALTER TABLE feed_message_cta_definitions ADD COLUMN IF NOT EXISTS config_json JSON NULL`)
          await db.query(`ALTER TABLE feed_message_cta_definitions ADD COLUMN IF NOT EXISTS created_by BIGINT UNSIGNED NOT NULL DEFAULT 0`)
          await db.query(`ALTER TABLE feed_message_cta_definitions ADD COLUMN IF NOT EXISTS updated_by BIGINT UNSIGNED NOT NULL DEFAULT 0`)
          try { await db.query(`UPDATE feed_message_cta_definitions SET config_json = JSON_OBJECT() WHERE config_json IS NULL`) } catch {}
          try { await db.query(`ALTER TABLE feed_message_cta_definitions MODIFY COLUMN config_json JSON NOT NULL`) } catch {}
          try {
            await db.query(
              `ALTER TABLE feed_message_cta_definitions
                 MODIFY COLUMN intent_key ENUM('support','defer','login','register','donate','subscribe','upgrade','verify_email','verify_phone','visit_sponsor','visit_link')
                 NOT NULL DEFAULT 'visit_link'`
            )
          } catch {}
          try {
            await db.query(
              `ALTER TABLE feed_message_cta_definitions
                 MODIFY COLUMN executor_type ENUM('internal_link','provider_checkout','verification_flow','api_action','advance_slide')
                 NOT NULL DEFAULT 'internal_link'`
            )
          } catch {}
          try {
            await db.query(
              `ALTER TABLE feed_message_cta_definitions
                 MODIFY COLUMN completion_contract ENUM('on_click','on_return','on_verified','none')
                 NOT NULL DEFAULT 'on_click'`
            )
          } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_cta_scope_status ON feed_message_cta_definitions (scope_type, scope_space_id, status, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_cta_intent_status ON feed_message_cta_definitions (intent_key, status, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_cta_executor_status ON feed_message_cta_definitions (executor_type, status, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_cta_completion_status ON feed_message_cta_definitions (completion_contract, status, id)`); } catch {}

          // --- Message journeys (plan_144B) ---
          await db.query(`
            CREATE TABLE IF NOT EXISTS feed_message_journeys (
              id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              journey_key VARCHAR(64) NOT NULL,
              campaign_category VARCHAR(64) NULL,
              name VARCHAR(120) NOT NULL,
              applies_to_surface ENUM('global_feed','group_feed','channel_feed') NOT NULL DEFAULT 'global_feed',
              status ENUM('draft','active','paused','archived') NOT NULL DEFAULT 'draft',
              description VARCHAR(500) NULL,
              config_json JSON NOT NULL,
              eligibility_ruleset_id BIGINT UNSIGNED NULL,
              created_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
              updated_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_feed_message_journeys_key (journey_key),
              KEY idx_feed_message_journeys_status (status, id),
              KEY idx_feed_message_journeys_name (name, id),
              KEY idx_feed_message_journeys_ruleset (eligibility_ruleset_id, id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `)
          await db.query(`ALTER TABLE feed_message_journeys ADD COLUMN IF NOT EXISTS journey_key VARCHAR(64) NOT NULL`)
          await db.query(`ALTER TABLE feed_message_journeys ADD COLUMN IF NOT EXISTS campaign_category VARCHAR(64) NULL`)
          await db.query(`ALTER TABLE feed_message_journeys ADD COLUMN IF NOT EXISTS name VARCHAR(120) NOT NULL`)
          await db.query(`ALTER TABLE feed_message_journeys ADD COLUMN IF NOT EXISTS applies_to_surface ENUM('global_feed','group_feed','channel_feed') NOT NULL DEFAULT 'global_feed'`)
          await db.query(`ALTER TABLE feed_message_journeys ADD COLUMN IF NOT EXISTS status ENUM('draft','active','paused','archived') NOT NULL DEFAULT 'draft'`)
          await db.query(`ALTER TABLE feed_message_journeys MODIFY COLUMN status ENUM('draft','active','paused','archived') NOT NULL DEFAULT 'draft'`)
          await db.query(`ALTER TABLE feed_message_journeys ADD COLUMN IF NOT EXISTS description VARCHAR(500) NULL`)
          await db.query(`ALTER TABLE feed_message_journeys ADD COLUMN IF NOT EXISTS config_json JSON NULL`)
          try { await db.query(`UPDATE feed_message_journeys SET config_json = JSON_OBJECT() WHERE config_json IS NULL`) } catch {}
          try { await db.query(`ALTER TABLE feed_message_journeys MODIFY COLUMN config_json JSON NOT NULL`) } catch {}
          await db.query(`ALTER TABLE feed_message_journeys ADD COLUMN IF NOT EXISTS eligibility_ruleset_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE feed_message_journeys ADD COLUMN IF NOT EXISTS created_by BIGINT UNSIGNED NOT NULL DEFAULT 0`)
          await db.query(`ALTER TABLE feed_message_journeys ADD COLUMN IF NOT EXISTS updated_by BIGINT UNSIGNED NOT NULL DEFAULT 0`)
          try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_feed_message_journeys_key ON feed_message_journeys (journey_key)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_journeys_campaign_category ON feed_message_journeys (campaign_category, status, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_journeys_status ON feed_message_journeys (status, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_journeys_name ON feed_message_journeys (name, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_journeys_ruleset ON feed_message_journeys (eligibility_ruleset_id, id)`); } catch {}

          await db.query(`
            CREATE TABLE IF NOT EXISTS feed_message_journey_surfaces (
              id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              journey_id BIGINT UNSIGNED NOT NULL,
              surface ENUM('global_feed','group_feed','channel_feed') NOT NULL,
              targeting_mode ENUM('all','selected') NOT NULL DEFAULT 'all',
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_feed_message_journey_surfaces_journey_surface (journey_id, surface),
              KEY idx_feed_message_journey_surfaces_surface_mode (surface, targeting_mode, journey_id),
              KEY idx_feed_message_journey_surfaces_journey (journey_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `)
          await db.query(`ALTER TABLE feed_message_journey_surfaces ADD COLUMN IF NOT EXISTS journey_id BIGINT UNSIGNED NOT NULL`)
          await db.query(`ALTER TABLE feed_message_journey_surfaces ADD COLUMN IF NOT EXISTS surface ENUM('global_feed','group_feed','channel_feed') NOT NULL`)
          await db.query(`ALTER TABLE feed_message_journey_surfaces ADD COLUMN IF NOT EXISTS targeting_mode ENUM('all','selected') NOT NULL DEFAULT 'all'`)
          try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_feed_message_journey_surfaces_journey_surface ON feed_message_journey_surfaces (journey_id, surface)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_journey_surfaces_surface_mode ON feed_message_journey_surfaces (surface, targeting_mode, journey_id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_journey_surfaces_journey ON feed_message_journey_surfaces (journey_id)`); } catch {}

          await db.query(`
            CREATE TABLE IF NOT EXISTS feed_message_journey_targets (
              id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              journey_id BIGINT UNSIGNED NOT NULL,
              surface ENUM('group_feed','channel_feed') NOT NULL,
              target_id BIGINT UNSIGNED NOT NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_feed_message_journey_targets_journey_surface_target (journey_id, surface, target_id),
              KEY idx_feed_message_journey_targets_surface_target (surface, target_id, journey_id),
              KEY idx_feed_message_journey_targets_journey_surface (journey_id, surface)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `)
          await db.query(`ALTER TABLE feed_message_journey_targets ADD COLUMN IF NOT EXISTS journey_id BIGINT UNSIGNED NOT NULL`)
          await db.query(`ALTER TABLE feed_message_journey_targets ADD COLUMN IF NOT EXISTS surface ENUM('group_feed','channel_feed') NOT NULL`)
          await db.query(`ALTER TABLE feed_message_journey_targets ADD COLUMN IF NOT EXISTS target_id BIGINT UNSIGNED NOT NULL`)
          try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_feed_message_journey_targets_journey_surface_target ON feed_message_journey_targets (journey_id, surface, target_id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_journey_targets_surface_target ON feed_message_journey_targets (surface, target_id, journey_id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_journey_targets_journey_surface ON feed_message_journey_targets (journey_id, surface)`); } catch {}

          try {
            await db.query(`
              INSERT IGNORE INTO feed_message_journey_surfaces (journey_id, surface, targeting_mode)
              SELECT id, applies_to_surface, 'all'
              FROM feed_message_journeys
            `)
          } catch {}

          await db.query(`
            CREATE TABLE IF NOT EXISTS feed_message_journey_steps (
              id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              journey_id BIGINT UNSIGNED NOT NULL,
              step_key VARCHAR(64) NOT NULL,
              step_order INT UNSIGNED NOT NULL,
              message_id BIGINT UNSIGNED NOT NULL,
              ruleset_id BIGINT UNSIGNED NULL,
              status ENUM('draft','active','archived') NOT NULL DEFAULT 'draft',
              config_json JSON NOT NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_feed_message_journey_steps_key (journey_id, step_key),
              UNIQUE KEY uniq_feed_message_journey_steps_order (journey_id, step_order),
              KEY idx_feed_message_journey_steps_journey_status (journey_id, status, step_order, id),
              KEY idx_feed_message_journey_steps_message (message_id, id),
              KEY idx_feed_message_journey_steps_ruleset (ruleset_id, id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `)
          await db.query(`ALTER TABLE feed_message_journey_steps ADD COLUMN IF NOT EXISTS journey_id BIGINT UNSIGNED NOT NULL`)
          await db.query(`ALTER TABLE feed_message_journey_steps ADD COLUMN IF NOT EXISTS step_key VARCHAR(64) NOT NULL`)
          await db.query(`ALTER TABLE feed_message_journey_steps ADD COLUMN IF NOT EXISTS step_order INT UNSIGNED NOT NULL DEFAULT 1`)
          await db.query(`ALTER TABLE feed_message_journey_steps ADD COLUMN IF NOT EXISTS message_id BIGINT UNSIGNED NOT NULL DEFAULT 0`)
          await db.query(`ALTER TABLE feed_message_journey_steps ADD COLUMN IF NOT EXISTS ruleset_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE feed_message_journey_steps ADD COLUMN IF NOT EXISTS status ENUM('draft','active','archived') NOT NULL DEFAULT 'draft'`)
          await db.query(`ALTER TABLE feed_message_journey_steps ADD COLUMN IF NOT EXISTS config_json JSON NULL`)
          try { await db.query(`UPDATE feed_message_journey_steps SET config_json = JSON_OBJECT() WHERE config_json IS NULL`) } catch {}
          try { await db.query(`ALTER TABLE feed_message_journey_steps MODIFY COLUMN config_json JSON NOT NULL`) } catch {}
          try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_feed_message_journey_steps_key ON feed_message_journey_steps (journey_id, step_key)`); } catch {}
          try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_feed_message_journey_steps_order ON feed_message_journey_steps (journey_id, step_order)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_journey_steps_journey_status ON feed_message_journey_steps (journey_id, status, step_order, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_journey_steps_message ON feed_message_journey_steps (message_id, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_journey_steps_ruleset ON feed_message_journey_steps (ruleset_id, id)`); } catch {}

          await db.query(`
            CREATE TABLE IF NOT EXISTS feed_user_message_journey_progress (
              id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              user_id BIGINT UNSIGNED NOT NULL,
              journey_id BIGINT UNSIGNED NOT NULL,
              step_id BIGINT UNSIGNED NOT NULL,
              state ENUM('eligible','shown','clicked','completed','skipped','expired','suppressed') NOT NULL DEFAULT 'eligible',
              first_seen_at DATETIME NULL,
              last_seen_at DATETIME NULL,
              completed_at DATETIME NULL,
              completed_by_outcome_id BIGINT UNSIGNED NULL,
              session_id VARCHAR(120) NULL,
              metadata_json JSON NOT NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_feed_user_message_journey_progress_user_step (user_id, step_id),
              KEY idx_feed_user_message_journey_progress_user_journey (user_id, journey_id, state, updated_at, id),
              KEY idx_feed_user_message_journey_progress_journey_step (journey_id, step_id, state, updated_at, id),
              KEY idx_feed_user_message_journey_progress_session (session_id, updated_at, id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `)
          await db.query(`ALTER TABLE feed_user_message_journey_progress ADD COLUMN IF NOT EXISTS user_id BIGINT UNSIGNED NOT NULL`)
          await db.query(`ALTER TABLE feed_user_message_journey_progress ADD COLUMN IF NOT EXISTS journey_id BIGINT UNSIGNED NOT NULL`)
          await db.query(`ALTER TABLE feed_user_message_journey_progress ADD COLUMN IF NOT EXISTS journey_instance_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE feed_user_message_journey_progress ADD COLUMN IF NOT EXISTS journey_subject_id VARCHAR(160) NULL`)
          await db.query(`ALTER TABLE feed_user_message_journey_progress ADD COLUMN IF NOT EXISTS step_id BIGINT UNSIGNED NOT NULL`)
          await db.query(`ALTER TABLE feed_user_message_journey_progress ADD COLUMN IF NOT EXISTS state ENUM('eligible','shown','clicked','completed','skipped','expired','suppressed') NOT NULL DEFAULT 'eligible'`)
          await db.query(`ALTER TABLE feed_user_message_journey_progress ADD COLUMN IF NOT EXISTS first_seen_at DATETIME NULL`)
          await db.query(`ALTER TABLE feed_user_message_journey_progress ADD COLUMN IF NOT EXISTS last_seen_at DATETIME NULL`)
          await db.query(`ALTER TABLE feed_user_message_journey_progress ADD COLUMN IF NOT EXISTS completed_at DATETIME NULL`)
          await db.query(`ALTER TABLE feed_user_message_journey_progress ADD COLUMN IF NOT EXISTS completed_by_outcome_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE feed_user_message_journey_progress ADD COLUMN IF NOT EXISTS session_id VARCHAR(120) NULL`)
          await db.query(`ALTER TABLE feed_user_message_journey_progress ADD COLUMN IF NOT EXISTS metadata_json JSON NULL`)
          try { await db.query(`UPDATE feed_user_message_journey_progress SET metadata_json = JSON_OBJECT() WHERE metadata_json IS NULL`) } catch {}
          try { await db.query(`ALTER TABLE feed_user_message_journey_progress MODIFY COLUMN metadata_json JSON NOT NULL`) } catch {}
          try { await db.query(`DROP INDEX uniq_feed_user_message_journey_progress_user_step ON feed_user_message_journey_progress`) } catch {}
          try {
            await db.query(`
              UPDATE feed_user_message_journey_progress
              SET journey_subject_id = CONCAT('user:', CAST(user_id AS CHAR))
              WHERE (journey_subject_id IS NULL OR journey_subject_id = '')
                AND user_id IS NOT NULL
            `)
          } catch {}
          try {
            await db.query(`
              UPDATE feed_user_message_journey_progress p
              INNER JOIN (
                SELECT i.journey_id, i.identity_key, MAX(i.id) AS latest_instance_id
                FROM feed_message_journey_instances i
                WHERE i.identity_type = 'user'
                GROUP BY i.journey_id, i.identity_key
              ) x ON x.journey_id = p.journey_id AND x.identity_key = CAST(p.user_id AS CHAR)
              SET p.journey_instance_id = x.latest_instance_id
              WHERE p.journey_instance_id IS NULL
            `)
          } catch {}
          try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_feed_user_message_journey_progress_user_instance_step ON feed_user_message_journey_progress (user_id, journey_instance_id, step_id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_user_message_journey_progress_user_journey ON feed_user_message_journey_progress (user_id, journey_id, state, updated_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_user_message_journey_progress_instance_state ON feed_user_message_journey_progress (journey_instance_id, state, updated_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_user_message_journey_progress_instance_subject ON feed_user_message_journey_progress (journey_instance_id, journey_subject_id, state, updated_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_user_message_journey_progress_journey_step ON feed_user_message_journey_progress (journey_id, step_id, state, updated_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_user_message_journey_progress_session ON feed_user_message_journey_progress (session_id, updated_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_user_message_journey_progress_completed_outcome ON feed_user_message_journey_progress (completed_by_outcome_id, updated_at, id)`); } catch {}

          await db.query(`
            CREATE TABLE IF NOT EXISTS feed_anon_message_journey_progress (
              id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              anon_visitor_id VARCHAR(120) NOT NULL,
              journey_id BIGINT UNSIGNED NOT NULL,
              step_id BIGINT UNSIGNED NOT NULL,
              state ENUM('eligible','shown','clicked','completed','skipped','expired','suppressed') NOT NULL DEFAULT 'eligible',
              first_seen_at DATETIME NULL,
              last_seen_at DATETIME NULL,
              completed_at DATETIME NULL,
              completed_by_outcome_id BIGINT UNSIGNED NULL,
              session_id VARCHAR(120) NULL,
              metadata_json JSON NOT NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_feed_anon_message_journey_progress_visitor_step (anon_visitor_id, step_id),
              KEY idx_feed_anon_message_journey_progress_visitor_journey (anon_visitor_id, journey_id, state, updated_at, id),
              KEY idx_feed_anon_message_journey_progress_journey_step (journey_id, step_id, state, updated_at, id),
              KEY idx_feed_anon_message_journey_progress_session (session_id, updated_at, id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `)
          await db.query(`ALTER TABLE feed_anon_message_journey_progress ADD COLUMN IF NOT EXISTS anon_visitor_id VARCHAR(120) NOT NULL`)
          await db.query(`ALTER TABLE feed_anon_message_journey_progress ADD COLUMN IF NOT EXISTS journey_id BIGINT UNSIGNED NOT NULL`)
          await db.query(`ALTER TABLE feed_anon_message_journey_progress ADD COLUMN IF NOT EXISTS journey_instance_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE feed_anon_message_journey_progress ADD COLUMN IF NOT EXISTS journey_subject_id VARCHAR(160) NULL`)
          await db.query(`ALTER TABLE feed_anon_message_journey_progress ADD COLUMN IF NOT EXISTS step_id BIGINT UNSIGNED NOT NULL`)
          await db.query(`ALTER TABLE feed_anon_message_journey_progress ADD COLUMN IF NOT EXISTS state ENUM('eligible','shown','clicked','completed','skipped','expired','suppressed') NOT NULL DEFAULT 'eligible'`)
          await db.query(`ALTER TABLE feed_anon_message_journey_progress ADD COLUMN IF NOT EXISTS first_seen_at DATETIME NULL`)
          await db.query(`ALTER TABLE feed_anon_message_journey_progress ADD COLUMN IF NOT EXISTS last_seen_at DATETIME NULL`)
          await db.query(`ALTER TABLE feed_anon_message_journey_progress ADD COLUMN IF NOT EXISTS completed_at DATETIME NULL`)
          await db.query(`ALTER TABLE feed_anon_message_journey_progress ADD COLUMN IF NOT EXISTS completed_by_outcome_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE feed_anon_message_journey_progress ADD COLUMN IF NOT EXISTS session_id VARCHAR(120) NULL`)
          await db.query(`ALTER TABLE feed_anon_message_journey_progress ADD COLUMN IF NOT EXISTS metadata_json JSON NULL`)
          try { await db.query(`UPDATE feed_anon_message_journey_progress SET metadata_json = JSON_OBJECT() WHERE metadata_json IS NULL`) } catch {}
          try { await db.query(`ALTER TABLE feed_anon_message_journey_progress MODIFY COLUMN metadata_json JSON NOT NULL`) } catch {}
          try { await db.query(`DROP INDEX uniq_feed_anon_message_journey_progress_visitor_step ON feed_anon_message_journey_progress`) } catch {}
          try {
            await db.query(`
              UPDATE feed_anon_message_journey_progress
              SET journey_subject_id = CONCAT('anon:', anon_visitor_id)
              WHERE (journey_subject_id IS NULL OR journey_subject_id = '')
                AND anon_visitor_id IS NOT NULL
                AND anon_visitor_id <> ''
            `)
          } catch {}
          try {
            await db.query(`
              UPDATE feed_anon_message_journey_progress p
              INNER JOIN (
                SELECT i.journey_id, i.identity_key, MAX(i.id) AS latest_instance_id
                FROM feed_message_journey_instances i
                WHERE i.identity_type = 'anon'
                GROUP BY i.journey_id, i.identity_key
              ) x ON x.journey_id = p.journey_id AND x.identity_key = p.anon_visitor_id
              SET p.journey_instance_id = x.latest_instance_id
              WHERE p.journey_instance_id IS NULL
            `)
          } catch {}
          try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_feed_anon_message_journey_progress_visitor_instance_step ON feed_anon_message_journey_progress (anon_visitor_id, journey_instance_id, step_id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_anon_message_journey_progress_visitor_journey ON feed_anon_message_journey_progress (anon_visitor_id, journey_id, state, updated_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_anon_message_journey_progress_instance_state ON feed_anon_message_journey_progress (journey_instance_id, state, updated_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_anon_message_journey_progress_instance_subject ON feed_anon_message_journey_progress (journey_instance_id, journey_subject_id, state, updated_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_anon_message_journey_progress_journey_step ON feed_anon_message_journey_progress (journey_id, step_id, state, updated_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_anon_message_journey_progress_session ON feed_anon_message_journey_progress (session_id, updated_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_anon_message_journey_progress_completed_outcome ON feed_anon_message_journey_progress (completed_by_outcome_id, updated_at, id)`); } catch {}

          // --- Journey instances (plan_148A) ---
          await db.query(`
            CREATE TABLE IF NOT EXISTS feed_message_journey_instances (
              id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              journey_id BIGINT UNSIGNED NOT NULL,
              identity_type ENUM('user','anon') NOT NULL,
              identity_key VARCHAR(120) NOT NULL,
              state ENUM('active','completed','abandoned','expired') NOT NULL DEFAULT 'active',
              current_step_id BIGINT UNSIGNED NULL,
              completed_reason VARCHAR(120) NULL,
              completed_event_key VARCHAR(120) NULL,
              first_seen_at DATETIME NULL,
              last_seen_at DATETIME NULL,
              completed_at DATETIME NULL,
              metadata_json JSON NOT NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_feed_message_journey_instances_identity (journey_id, identity_type, identity_key),
              KEY idx_feed_message_journey_instances_identity_lookup (identity_type, identity_key, state, updated_at, id),
              KEY idx_feed_message_journey_instances_journey_state (journey_id, state, updated_at, id),
              KEY idx_feed_message_journey_instances_current_step (current_step_id, updated_at, id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `)
          await db.query(`ALTER TABLE feed_message_journey_instances ADD COLUMN IF NOT EXISTS journey_id BIGINT UNSIGNED NOT NULL`)
          await db.query(`ALTER TABLE feed_message_journey_instances ADD COLUMN IF NOT EXISTS identity_type ENUM('user','anon') NOT NULL DEFAULT 'anon'`)
          await db.query(`ALTER TABLE feed_message_journey_instances ADD COLUMN IF NOT EXISTS identity_key VARCHAR(120) NOT NULL`)
          await db.query(`ALTER TABLE feed_message_journey_instances ADD COLUMN IF NOT EXISTS journey_subject_id VARCHAR(160) NULL`)
          await db.query(`ALTER TABLE feed_message_journey_instances ADD COLUMN IF NOT EXISTS state ENUM('active','completed','abandoned','expired') NOT NULL DEFAULT 'active'`)
          await db.query(`ALTER TABLE feed_message_journey_instances ADD COLUMN IF NOT EXISTS current_step_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE feed_message_journey_instances ADD COLUMN IF NOT EXISTS completed_reason VARCHAR(120) NULL`)
          await db.query(`ALTER TABLE feed_message_journey_instances ADD COLUMN IF NOT EXISTS completed_event_key VARCHAR(120) NULL`)
          await db.query(`ALTER TABLE feed_message_journey_instances ADD COLUMN IF NOT EXISTS first_seen_at DATETIME NULL`)
          await db.query(`ALTER TABLE feed_message_journey_instances ADD COLUMN IF NOT EXISTS last_seen_at DATETIME NULL`)
          await db.query(`ALTER TABLE feed_message_journey_instances ADD COLUMN IF NOT EXISTS completed_at DATETIME NULL`)
          await db.query(`ALTER TABLE feed_message_journey_instances ADD COLUMN IF NOT EXISTS metadata_json JSON NULL`)
          try { await db.query(`UPDATE feed_message_journey_instances SET metadata_json = JSON_OBJECT() WHERE metadata_json IS NULL`) } catch {}
          try { await db.query(`ALTER TABLE feed_message_journey_instances MODIFY COLUMN metadata_json JSON NOT NULL`) } catch {}
          try {
            await db.query(`
              UPDATE feed_message_journey_instances
              SET journey_subject_id = CASE
                WHEN identity_type = 'user' THEN CONCAT('user:', identity_key)
                ELSE CONCAT('anon:', identity_key)
              END
              WHERE (journey_subject_id IS NULL OR journey_subject_id = '')
                AND identity_key IS NOT NULL
                AND identity_key <> ''
            `)
          } catch {}
          try { await db.query(`DROP INDEX uniq_feed_message_journey_instances_identity ON feed_message_journey_instances`) } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_journey_instances_identity_lookup ON feed_message_journey_instances (identity_type, identity_key, state, updated_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_journey_instances_journey_state ON feed_message_journey_instances (journey_id, state, updated_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_journey_instances_journey_subject_state ON feed_message_journey_instances (journey_id, journey_subject_id, state, updated_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_journey_instances_current_step ON feed_message_journey_instances (current_step_id, updated_at, id)`); } catch {}

          // --- Journey subject links (plan_154A) ---
          await db.query(`
            CREATE TABLE IF NOT EXISTS feed_journey_subject_links (
              id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              source_subject_id VARCHAR(160) NOT NULL,
              canonical_subject_id VARCHAR(160) NOT NULL,
              link_reason VARCHAR(64) NOT NULL DEFAULT 'auth_merge',
              metadata_json JSON NOT NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_feed_journey_subject_links_source (source_subject_id),
              KEY idx_feed_journey_subject_links_canonical (canonical_subject_id, updated_at, id),
              KEY idx_feed_journey_subject_links_updated (updated_at, id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `)
          await db.query(`ALTER TABLE feed_journey_subject_links ADD COLUMN IF NOT EXISTS source_subject_id VARCHAR(160) NOT NULL`)
          await db.query(`ALTER TABLE feed_journey_subject_links ADD COLUMN IF NOT EXISTS canonical_subject_id VARCHAR(160) NOT NULL`)
          await db.query(`ALTER TABLE feed_journey_subject_links ADD COLUMN IF NOT EXISTS link_reason VARCHAR(64) NOT NULL DEFAULT 'auth_merge'`)
          await db.query(`ALTER TABLE feed_journey_subject_links ADD COLUMN IF NOT EXISTS metadata_json JSON NULL`)
          try { await db.query(`UPDATE feed_journey_subject_links SET metadata_json = JSON_OBJECT() WHERE metadata_json IS NULL`) } catch {}
          try { await db.query(`ALTER TABLE feed_journey_subject_links MODIFY COLUMN metadata_json JSON NOT NULL`) } catch {}
          try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_feed_journey_subject_links_source ON feed_journey_subject_links (source_subject_id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_journey_subject_links_canonical ON feed_journey_subject_links (canonical_subject_id, updated_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_journey_subject_links_updated ON feed_journey_subject_links (updated_at, id)`); } catch {}

          // --- Canonical journey progress (plan_154A) ---
          await db.query(`
            CREATE TABLE IF NOT EXISTS feed_message_journey_progress (
              id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              journey_subject_id VARCHAR(160) NOT NULL,
              journey_id BIGINT UNSIGNED NOT NULL,
              journey_instance_id BIGINT UNSIGNED NULL,
              step_id BIGINT UNSIGNED NOT NULL,
              state ENUM('eligible','shown','clicked','completed','skipped','expired','suppressed') NOT NULL DEFAULT 'eligible',
              first_seen_at DATETIME NULL,
              last_seen_at DATETIME NULL,
              completed_at DATETIME NULL,
              completed_by_outcome_id BIGINT UNSIGNED NULL,
              session_id VARCHAR(120) NULL,
              metadata_json JSON NOT NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_feed_message_journey_progress_instance_step (journey_instance_id, step_id),
              KEY idx_feed_message_journey_progress_journey_subject_state (journey_id, journey_subject_id, state, updated_at, id),
              KEY idx_feed_message_journey_progress_subject_journey_state (journey_subject_id, journey_id, state, updated_at, id),
              KEY idx_feed_message_journey_progress_session (session_id, updated_at, id),
              KEY idx_feed_message_journey_progress_completed_outcome (completed_by_outcome_id, updated_at, id),
              KEY idx_feed_message_journey_progress_instance_state (journey_instance_id, state, updated_at, id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `)
          await db.query(`ALTER TABLE feed_message_journey_progress ADD COLUMN IF NOT EXISTS journey_subject_id VARCHAR(160) NOT NULL`)
          await db.query(`ALTER TABLE feed_message_journey_progress ADD COLUMN IF NOT EXISTS journey_id BIGINT UNSIGNED NOT NULL`)
          await db.query(`ALTER TABLE feed_message_journey_progress ADD COLUMN IF NOT EXISTS journey_instance_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE feed_message_journey_progress ADD COLUMN IF NOT EXISTS step_id BIGINT UNSIGNED NOT NULL`)
          await db.query(`ALTER TABLE feed_message_journey_progress ADD COLUMN IF NOT EXISTS state ENUM('eligible','shown','clicked','completed','skipped','expired','suppressed') NOT NULL DEFAULT 'eligible'`)
          await db.query(`ALTER TABLE feed_message_journey_progress ADD COLUMN IF NOT EXISTS first_seen_at DATETIME NULL`)
          await db.query(`ALTER TABLE feed_message_journey_progress ADD COLUMN IF NOT EXISTS last_seen_at DATETIME NULL`)
          await db.query(`ALTER TABLE feed_message_journey_progress ADD COLUMN IF NOT EXISTS completed_at DATETIME NULL`)
          await db.query(`ALTER TABLE feed_message_journey_progress ADD COLUMN IF NOT EXISTS completed_by_outcome_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE feed_message_journey_progress ADD COLUMN IF NOT EXISTS session_id VARCHAR(120) NULL`)
          await db.query(`ALTER TABLE feed_message_journey_progress ADD COLUMN IF NOT EXISTS metadata_json JSON NULL`)
          try { await db.query(`UPDATE feed_message_journey_progress SET metadata_json = JSON_OBJECT() WHERE metadata_json IS NULL`) } catch {}
          try { await db.query(`ALTER TABLE feed_message_journey_progress MODIFY COLUMN metadata_json JSON NOT NULL`) } catch {}
          try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_feed_message_journey_progress_instance_step ON feed_message_journey_progress (journey_instance_id, step_id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_journey_progress_journey_subject_state ON feed_message_journey_progress (journey_id, journey_subject_id, state, updated_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_journey_progress_subject_journey_state ON feed_message_journey_progress (journey_subject_id, journey_id, state, updated_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_journey_progress_session ON feed_message_journey_progress (session_id, updated_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_journey_progress_completed_outcome ON feed_message_journey_progress (completed_by_outcome_id, updated_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_journey_progress_instance_state ON feed_message_journey_progress (journey_instance_id, state, updated_at, id)`); } catch {}

          // --- Canonical CTA outcomes (plan_145A) ---
          await db.query(`
            CREATE TABLE IF NOT EXISTS feed_message_cta_outcomes (
              id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              outcome_id VARCHAR(64) NOT NULL,
              source_event_id BIGINT UNSIGNED NULL,
              source_event_type VARCHAR(64) NOT NULL,
              outcome_type ENUM('click','return','verified_complete','webhook_complete','failed','abandoned') NOT NULL,
              outcome_status ENUM('pending','success','failure') NOT NULL DEFAULT 'pending',
              occurred_at DATETIME NOT NULL,
              session_id VARCHAR(120) NULL,
              user_id BIGINT UNSIGNED NULL,
              message_id BIGINT UNSIGNED NOT NULL,
              message_campaign_key VARCHAR(64) NULL,
              delivery_context ENUM('standalone','journey') NOT NULL DEFAULT 'standalone',
              journey_id BIGINT UNSIGNED NULL,
              journey_step_id BIGINT UNSIGNED NULL,
              cta_slot TINYINT UNSIGNED NULL,
              cta_definition_id BIGINT UNSIGNED NULL,
              cta_intent_key VARCHAR(64) NULL,
              cta_executor_type VARCHAR(64) NULL,
              payload_json JSON NOT NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_feed_message_cta_outcomes_outcome_id (outcome_id),
              KEY idx_feed_message_cta_outcomes_user_time (user_id, occurred_at, id),
              KEY idx_feed_message_cta_outcomes_message_time (message_id, occurred_at, id),
              KEY idx_feed_message_cta_outcomes_campaign_time (message_campaign_key, occurred_at, id),
              KEY idx_feed_message_cta_outcomes_journey_step_time (journey_id, journey_step_id, occurred_at, id),
              KEY idx_feed_message_cta_outcomes_cta_def_time (cta_definition_id, occurred_at, id),
              KEY idx_feed_message_cta_outcomes_type_status_time (outcome_type, outcome_status, occurred_at, id),
              KEY idx_feed_message_cta_outcomes_delivery_time (delivery_context, occurred_at, id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `)
          await db.query(`ALTER TABLE feed_message_cta_outcomes ADD COLUMN IF NOT EXISTS outcome_id VARCHAR(64) NOT NULL`)
          await db.query(`ALTER TABLE feed_message_cta_outcomes ADD COLUMN IF NOT EXISTS source_event_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE feed_message_cta_outcomes ADD COLUMN IF NOT EXISTS source_event_type VARCHAR(64) NOT NULL DEFAULT 'unknown'`)
          await db.query(`ALTER TABLE feed_message_cta_outcomes ADD COLUMN IF NOT EXISTS outcome_type ENUM('click','return','verified_complete','webhook_complete','failed','abandoned') NOT NULL DEFAULT 'click'`)
          await db.query(`ALTER TABLE feed_message_cta_outcomes ADD COLUMN IF NOT EXISTS outcome_status ENUM('pending','success','failure') NOT NULL DEFAULT 'pending'`)
          await db.query(`ALTER TABLE feed_message_cta_outcomes ADD COLUMN IF NOT EXISTS occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`)
          await db.query(`ALTER TABLE feed_message_cta_outcomes ADD COLUMN IF NOT EXISTS session_id VARCHAR(120) NULL`)
          await db.query(`ALTER TABLE feed_message_cta_outcomes ADD COLUMN IF NOT EXISTS user_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE feed_message_cta_outcomes ADD COLUMN IF NOT EXISTS message_id BIGINT UNSIGNED NOT NULL DEFAULT 0`)
          await db.query(`ALTER TABLE feed_message_cta_outcomes ADD COLUMN IF NOT EXISTS message_campaign_key VARCHAR(64) NULL`)
          await db.query(`ALTER TABLE feed_message_cta_outcomes ADD COLUMN IF NOT EXISTS delivery_context ENUM('standalone','journey') NOT NULL DEFAULT 'standalone'`)
          await db.query(`ALTER TABLE feed_message_cta_outcomes ADD COLUMN IF NOT EXISTS journey_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE feed_message_cta_outcomes ADD COLUMN IF NOT EXISTS journey_step_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE feed_message_cta_outcomes ADD COLUMN IF NOT EXISTS cta_slot TINYINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE feed_message_cta_outcomes ADD COLUMN IF NOT EXISTS cta_definition_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE feed_message_cta_outcomes ADD COLUMN IF NOT EXISTS cta_intent_key VARCHAR(64) NULL`)
          await db.query(`ALTER TABLE feed_message_cta_outcomes ADD COLUMN IF NOT EXISTS cta_executor_type VARCHAR(64) NULL`)
          await db.query(`ALTER TABLE feed_message_cta_outcomes ADD COLUMN IF NOT EXISTS payload_json JSON NULL`)
          try { await db.query(`UPDATE feed_message_cta_outcomes SET payload_json = JSON_OBJECT() WHERE payload_json IS NULL`) } catch {}
          try { await db.query(`ALTER TABLE feed_message_cta_outcomes MODIFY COLUMN payload_json JSON NOT NULL`) } catch {}
          try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_feed_message_cta_outcomes_outcome_id ON feed_message_cta_outcomes (outcome_id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_cta_outcomes_user_time ON feed_message_cta_outcomes (user_id, occurred_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_cta_outcomes_message_time ON feed_message_cta_outcomes (message_id, occurred_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_cta_outcomes_campaign_time ON feed_message_cta_outcomes (message_campaign_key, occurred_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_cta_outcomes_journey_step_time ON feed_message_cta_outcomes (journey_id, journey_step_id, occurred_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_cta_outcomes_cta_def_time ON feed_message_cta_outcomes (cta_definition_id, occurred_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_cta_outcomes_type_status_time ON feed_message_cta_outcomes (outcome_type, outcome_status, occurred_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_cta_outcomes_delivery_time ON feed_message_cta_outcomes (delivery_context, occurred_at, id)`); } catch {}

          // Legacy prompt rules were removed in favor of message-owned targeting.
          // Drop the legacy table during startup so the schema matches runtime behavior.
          try { await db.query(`DROP TABLE IF EXISTS prompt_rules`) } catch {}

          await renameTableIfNeeded(db, 'prompt_decision_sessions', 'message_decision_sessions')

          // --- In-feed message decision sessions ---
          await db.query(`
            CREATE TABLE IF NOT EXISTS message_decision_sessions (
              id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              session_id VARCHAR(120) NOT NULL,
              surface ENUM('global_feed','group_feed','channel_feed') NOT NULL DEFAULT 'global_feed',
              viewer_state ENUM('anonymous','authenticated','authenticated_non_subscriber','authenticated_subscriber') NOT NULL DEFAULT 'anonymous',
              slides_viewed INT UNSIGNED NOT NULL DEFAULT 0,
              watch_seconds INT UNSIGNED NOT NULL DEFAULT 0,
              messages_shown_this_session INT UNSIGNED NOT NULL DEFAULT 0,
              slides_since_last_message INT UNSIGNED NOT NULL DEFAULT 0,
              converted_message_ids_json JSON NULL,
              last_message_shown_at DATETIME NULL,
              last_shown_message_id BIGINT UNSIGNED NULL,
              last_decision_reason VARCHAR(64) NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_message_decision_session_surface (session_id, surface),
              KEY idx_message_decision_surface_updated (surface, updated_at),
              KEY idx_message_decision_updated (updated_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `)
          await db.query(`ALTER TABLE message_decision_sessions ADD COLUMN IF NOT EXISTS session_id VARCHAR(120) NOT NULL`)
          await db.query(`ALTER TABLE message_decision_sessions ADD COLUMN IF NOT EXISTS surface ENUM('global_feed','group_feed','channel_feed') NOT NULL DEFAULT 'global_feed'`)
          try {
            await db.query(
              `ALTER TABLE message_decision_sessions
                 MODIFY COLUMN surface ENUM('global_feed','group_feed','channel_feed')
                 NOT NULL DEFAULT 'global_feed'`
            )
          } catch {}
          await db.query(`ALTER TABLE message_decision_sessions ADD COLUMN IF NOT EXISTS viewer_state ENUM('anonymous','authenticated','authenticated_non_subscriber','authenticated_subscriber') NOT NULL DEFAULT 'anonymous'`)
          try {
            await db.query(
              `ALTER TABLE message_decision_sessions
                 MODIFY COLUMN viewer_state ENUM('anonymous','authenticated','authenticated_non_subscriber','authenticated_subscriber')
                 NOT NULL DEFAULT 'anonymous'`
            )
          } catch {}
          await db.query(`ALTER TABLE message_decision_sessions ADD COLUMN IF NOT EXISTS slides_viewed INT UNSIGNED NOT NULL DEFAULT 0`)
          await db.query(`ALTER TABLE message_decision_sessions ADD COLUMN IF NOT EXISTS watch_seconds INT UNSIGNED NOT NULL DEFAULT 0`)
          await migrateColumnNameIfNeeded(db, 'message_decision_sessions', 'prompts_shown_this_session', 'messages_shown_this_session', `INT UNSIGNED NOT NULL DEFAULT 0`)
          await migrateColumnNameIfNeeded(db, 'message_decision_sessions', 'slides_since_last_prompt', 'slides_since_last_message', `INT UNSIGNED NOT NULL DEFAULT 0`)
          await migrateColumnNameIfNeeded(db, 'message_decision_sessions', 'converted_prompt_ids_json', 'converted_message_ids_json', `JSON NULL`)
          await migrateColumnNameIfNeeded(db, 'message_decision_sessions', 'last_prompt_shown_at', 'last_message_shown_at', `DATETIME NULL`)
          await migrateColumnNameIfNeeded(db, 'message_decision_sessions', 'last_shown_prompt_id', 'last_shown_message_id', `BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE message_decision_sessions ADD COLUMN IF NOT EXISTS messages_shown_this_session INT UNSIGNED NOT NULL DEFAULT 0`)
          await db.query(`ALTER TABLE message_decision_sessions ADD COLUMN IF NOT EXISTS slides_since_last_message INT UNSIGNED NOT NULL DEFAULT 0`)
          await db.query(`ALTER TABLE message_decision_sessions ADD COLUMN IF NOT EXISTS converted_message_ids_json JSON NULL`)
          await db.query(`ALTER TABLE message_decision_sessions ADD COLUMN IF NOT EXISTS last_message_shown_at DATETIME NULL`)
          await db.query(`ALTER TABLE message_decision_sessions ADD COLUMN IF NOT EXISTS last_shown_message_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE message_decision_sessions ADD COLUMN IF NOT EXISTS last_decision_reason VARCHAR(64) NULL`)
          try { await db.query(`ALTER TABLE message_decision_sessions DROP COLUMN pass_through_counts_json`) } catch {}
          try { await db.query(`ALTER TABLE message_decision_sessions DROP COLUMN last_prompt_dismissed_at`) } catch {}
          try { await db.query(`DROP INDEX uniq_prompt_decision_session_surface ON message_decision_sessions`) } catch {}
          try { await db.query(`DROP INDEX idx_prompt_decision_surface_updated ON message_decision_sessions`) } catch {}
          try { await db.query(`DROP INDEX idx_prompt_decision_updated ON message_decision_sessions`) } catch {}
          try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_message_decision_session_surface ON message_decision_sessions (session_id, surface)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_message_decision_surface_updated ON message_decision_sessions (surface, updated_at)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_message_decision_updated ON message_decision_sessions (updated_at)`); } catch {}

          await renameTableIfNeeded(db, 'feed_prompt_events', 'feed_message_events')
          await renameTableIfNeeded(db, 'feed_prompt_daily_stats', 'feed_message_daily_stats')

          // --- In-feed message analytics events + rollups ---
          await db.query(`
            CREATE TABLE IF NOT EXISTS feed_message_events (
              id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              event_type ENUM(
                'message_impression',
                'message_click',
                'message_dismiss',
                'auth_start_from_message',
                'auth_complete_from_message',
                'donation_complete_from_message',
                'subscription_complete_from_message',
                'upgrade_complete_from_message'
              ) NOT NULL,
              surface ENUM('global_feed','group_feed','channel_feed') NOT NULL DEFAULT 'global_feed',
              viewer_state ENUM('anonymous','authenticated') NOT NULL DEFAULT 'anonymous',
              session_id VARCHAR(120) NULL,
              user_id BIGINT UNSIGNED NULL,
              message_id BIGINT UNSIGNED NOT NULL,
              message_campaign_key VARCHAR(64) NULL,
              cta_kind ENUM('primary','secondary') NULL,
              attributed TINYINT(1) NOT NULL DEFAULT 1,
              occurred_at DATETIME NOT NULL,
              dedupe_bucket_start DATETIME NOT NULL,
              dedupe_key CHAR(64) NOT NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_feed_message_events_dedupe_key (dedupe_key),
              KEY idx_feed_message_events_occurred (occurred_at, id),
              KEY idx_feed_message_events_surface_occurred (surface, occurred_at, id),
              KEY idx_feed_message_events_message_occurred (message_id, occurred_at, id),
              KEY idx_feed_message_events_event_occurred (event_type, occurred_at, id),
              KEY idx_feed_message_events_session_event (session_id, event_type, occurred_at, id),
              KEY idx_feed_message_events_user_event (user_id, event_type, occurred_at, id),
              KEY idx_feed_message_events_campaign_key_occurred (message_campaign_key, occurred_at, id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `)
          await db.query(`ALTER TABLE feed_message_events ADD COLUMN IF NOT EXISTS event_type ENUM('message_impression','message_click','message_dismiss','auth_start_from_message','auth_complete_from_message','donation_complete_from_message','subscription_complete_from_message','upgrade_complete_from_message') NOT NULL`)
          await db.query(`ALTER TABLE feed_message_events ADD COLUMN IF NOT EXISTS surface ENUM('global_feed','group_feed','channel_feed') NOT NULL DEFAULT 'global_feed'`)
          try { await db.query(`ALTER TABLE feed_message_events MODIFY COLUMN surface ENUM('global_feed','group_feed','channel_feed') NOT NULL DEFAULT 'global_feed'`) } catch {}
          await db.query(`ALTER TABLE feed_message_events ADD COLUMN IF NOT EXISTS viewer_state ENUM('anonymous','authenticated') NOT NULL DEFAULT 'anonymous'`)
          await db.query(`ALTER TABLE feed_message_events ADD COLUMN IF NOT EXISTS session_id VARCHAR(120) NULL`)
          await db.query(`ALTER TABLE feed_message_events ADD COLUMN IF NOT EXISTS user_id BIGINT UNSIGNED NULL`)
          await migrateColumnNameIfNeeded(db, 'feed_message_events', 'prompt_id', 'message_id', `BIGINT UNSIGNED NOT NULL DEFAULT 0`)
          await migrateColumnNameIfNeeded(db, 'feed_message_events', 'prompt_campaign_key', 'message_campaign_key', `VARCHAR(64) NULL`)
          await db.query(`ALTER TABLE feed_message_events ADD COLUMN IF NOT EXISTS message_id BIGINT UNSIGNED NOT NULL DEFAULT 0`)
          await db.query(`ALTER TABLE feed_message_events ADD COLUMN IF NOT EXISTS message_campaign_key VARCHAR(64) NULL`)
          await db.query(`ALTER TABLE feed_message_events ADD COLUMN IF NOT EXISTS cta_kind ENUM('primary','secondary') NULL`)
          await db.query(`ALTER TABLE feed_message_events ADD COLUMN IF NOT EXISTS message_cta_slot TINYINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE feed_message_events ADD COLUMN IF NOT EXISTS message_cta_definition_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE feed_message_events ADD COLUMN IF NOT EXISTS message_cta_intent_key VARCHAR(64) NULL`)
          await db.query(`ALTER TABLE feed_message_events ADD COLUMN IF NOT EXISTS message_cta_executor_type VARCHAR(64) NULL`)
          await db.query(`ALTER TABLE feed_message_events ADD COLUMN IF NOT EXISTS flow ENUM('login','register','donate','subscribe','upgrade') NULL`)
          try { await db.query(`ALTER TABLE feed_message_events MODIFY COLUMN flow ENUM('login','register','donate','subscribe','upgrade') NULL`) } catch {}
          await db.query(`ALTER TABLE feed_message_events ADD COLUMN IF NOT EXISTS intent_id CHAR(36) NULL`)
          await db.query(`ALTER TABLE feed_message_events ADD COLUMN IF NOT EXISTS message_sequence_key VARCHAR(191) NULL`)
          await db.query(`ALTER TABLE feed_message_events ADD COLUMN IF NOT EXISTS attributed TINYINT(1) NOT NULL DEFAULT 1`)
          await db.query(`ALTER TABLE feed_message_events ADD COLUMN IF NOT EXISTS occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`)
          await db.query(`ALTER TABLE feed_message_events ADD COLUMN IF NOT EXISTS dedupe_bucket_start DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`)
          await db.query(`ALTER TABLE feed_message_events ADD COLUMN IF NOT EXISTS dedupe_key CHAR(64) NULL`)
          try {
            await db.query(
              `ALTER TABLE feed_message_events
                 MODIFY COLUMN event_type ENUM(
                   'prompt_impression',
                   'prompt_click_primary',
                   'prompt_click_secondary',
                   'prompt_dismiss',
                   'auth_start_from_prompt',
                   'auth_complete_from_prompt',
                   'message_impression',
                   'message_click_primary',
                   'message_click_secondary',
                   'message_click',
                   'message_dismiss',
                   'auth_start_from_message',
                   'auth_complete_from_message',
                   'donation_complete_from_message',
                   'subscription_complete_from_message',
                   'upgrade_complete_from_message'
                 ) NOT NULL`
            )
          } catch {}
          try {
            await db.query(`
              UPDATE feed_message_events
                 SET event_type = CASE event_type
                   WHEN 'prompt_impression' THEN 'message_impression'
                   WHEN 'prompt_click_primary' THEN 'message_click'
                   WHEN 'prompt_click_secondary' THEN 'message_click'
                   WHEN 'message_click_primary' THEN 'message_click'
                   WHEN 'message_click_secondary' THEN 'message_click'
                   WHEN 'prompt_dismiss' THEN 'message_dismiss'
                   WHEN 'auth_start_from_prompt' THEN 'auth_start_from_message'
                   WHEN 'auth_complete_from_prompt' THEN 'auth_complete_from_message'
                   ELSE event_type
                 END
               WHERE event_type IN (
                 'prompt_impression',
                 'prompt_click_primary',
                 'prompt_click_secondary',
                 'message_click_primary',
                 'message_click_secondary',
                 'prompt_dismiss',
                 'auth_start_from_prompt',
                 'auth_complete_from_prompt'
               )
            `)
          } catch {}
          try {
            await db.query(
              `ALTER TABLE feed_message_events
                 MODIFY COLUMN event_type ENUM(
                   'message_impression',
                   'message_click',
                   'message_dismiss',
                   'auth_start_from_message',
                   'auth_complete_from_message',
                   'donation_complete_from_message',
                   'subscription_complete_from_message',
                   'upgrade_complete_from_message'
                 ) NOT NULL`
            )
          } catch {}
          try { await db.query(`ALTER TABLE feed_message_events DROP COLUMN prompt_kind`); } catch {}
          try { await db.query(`DROP INDEX uniq_feed_prompt_events_dedupe_key ON feed_message_events`) } catch {}
          try { await db.query(`DROP INDEX idx_feed_prompt_events_occurred ON feed_message_events`) } catch {}
          try { await db.query(`DROP INDEX idx_feed_prompt_events_surface_occurred ON feed_message_events`) } catch {}
          try { await db.query(`DROP INDEX idx_feed_prompt_events_prompt_occurred ON feed_message_events`) } catch {}
          try { await db.query(`DROP INDEX idx_feed_prompt_events_event_occurred ON feed_message_events`) } catch {}
          try { await db.query(`DROP INDEX idx_feed_prompt_events_session_event ON feed_message_events`) } catch {}
          try { await db.query(`DROP INDEX idx_feed_prompt_events_user_event ON feed_message_events`) } catch {}
          try { await db.query(`DROP INDEX idx_feed_prompt_events_campaign_key_occurred ON feed_message_events`) } catch {}
          try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_feed_message_events_dedupe_key ON feed_message_events (dedupe_key)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_events_occurred ON feed_message_events (occurred_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_events_surface_occurred ON feed_message_events (surface, occurred_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_events_message_occurred ON feed_message_events (message_id, occurred_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_events_event_occurred ON feed_message_events (event_type, occurred_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_events_session_event ON feed_message_events (session_id, event_type, occurred_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_events_user_event ON feed_message_events (user_id, event_type, occurred_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_events_intent_event ON feed_message_events (intent_id, event_type, occurred_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_events_sequence_occurred ON feed_message_events (message_sequence_key, occurred_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_events_slot_event ON feed_message_events (message_cta_slot, event_type, occurred_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_events_definition_event ON feed_message_events (message_cta_definition_id, event_type, occurred_at, id)`); } catch {}
          try {
            await db.query(`
              UPDATE feed_message_events
                 SET message_campaign_key = NULLIF(TRIM(prompt_category), '')
               WHERE (message_campaign_key IS NULL OR message_campaign_key = '')
                 AND COALESCE(prompt_category, '') <> ''
            `)
          } catch {}
          try { await db.query(`ALTER TABLE feed_message_events DROP COLUMN prompt_category`) } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_events_campaign_key_occurred ON feed_message_events (message_campaign_key, occurred_at, id)`); } catch {}
          try { await db.query(`UPDATE feed_message_events SET dedupe_key = LPAD(HEX(id), 64, '0') WHERE dedupe_key IS NULL OR dedupe_key = ''`); } catch {}

          await db.query(`
            CREATE TABLE IF NOT EXISTS feed_message_auth_intents (
              intent_id CHAR(36) NOT NULL PRIMARY KEY,
              flow ENUM('login','register') NOT NULL,
              state ENUM('created','started','completed','expired') NOT NULL DEFAULT 'created',
              surface ENUM('global_feed','group_feed','channel_feed') NOT NULL DEFAULT 'global_feed',
              message_id BIGINT UNSIGNED NOT NULL,
              message_campaign_key VARCHAR(64) NULL,
              message_session_id VARCHAR(120) NULL,
              message_sequence_key VARCHAR(191) NULL,
              viewer_state ENUM('anonymous','authenticated') NOT NULL DEFAULT 'anonymous',
              anon_key VARCHAR(191) NULL,
              user_id BIGINT UNSIGNED NULL,
              expires_at DATETIME NOT NULL,
              consumed_at DATETIME NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              KEY idx_feed_message_auth_intents_expires (expires_at),
              KEY idx_feed_message_auth_intents_state_expires (state, expires_at),
              KEY idx_feed_message_auth_intents_message_created (message_id, created_at),
              KEY idx_feed_message_auth_intents_session_created (message_session_id, created_at),
              KEY idx_feed_message_auth_intents_user_created (user_id, created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `)
          await db.query(`ALTER TABLE feed_message_auth_intents ADD COLUMN IF NOT EXISTS intent_id CHAR(36) NOT NULL`)
          await db.query(`ALTER TABLE feed_message_auth_intents ADD COLUMN IF NOT EXISTS flow ENUM('login','register') NOT NULL`)
          await db.query(`ALTER TABLE feed_message_auth_intents ADD COLUMN IF NOT EXISTS state ENUM('created','started','completed','expired') NOT NULL DEFAULT 'created'`)
          await db.query(`ALTER TABLE feed_message_auth_intents ADD COLUMN IF NOT EXISTS surface ENUM('global_feed','group_feed','channel_feed') NOT NULL DEFAULT 'global_feed'`)
          try { await db.query(`ALTER TABLE feed_message_auth_intents MODIFY COLUMN surface ENUM('global_feed','group_feed','channel_feed') NOT NULL DEFAULT 'global_feed'`) } catch {}
          await db.query(`ALTER TABLE feed_message_auth_intents ADD COLUMN IF NOT EXISTS message_id BIGINT UNSIGNED NOT NULL DEFAULT 0`)
          await db.query(`ALTER TABLE feed_message_auth_intents ADD COLUMN IF NOT EXISTS message_campaign_key VARCHAR(64) NULL`)
          await db.query(`ALTER TABLE feed_message_auth_intents ADD COLUMN IF NOT EXISTS message_session_id VARCHAR(120) NULL`)
          await db.query(`ALTER TABLE feed_message_auth_intents ADD COLUMN IF NOT EXISTS message_sequence_key VARCHAR(191) NULL`)
          await db.query(`ALTER TABLE feed_message_auth_intents ADD COLUMN IF NOT EXISTS viewer_state ENUM('anonymous','authenticated') NOT NULL DEFAULT 'anonymous'`)
          await db.query(`ALTER TABLE feed_message_auth_intents ADD COLUMN IF NOT EXISTS anon_key VARCHAR(191) NULL`)
          await db.query(`ALTER TABLE feed_message_auth_intents ADD COLUMN IF NOT EXISTS user_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE feed_message_auth_intents ADD COLUMN IF NOT EXISTS expires_at DATETIME NULL`)
          await db.query(`ALTER TABLE feed_message_auth_intents ADD COLUMN IF NOT EXISTS consumed_at DATETIME NULL`)
          try { await db.query(`UPDATE feed_message_auth_intents SET expires_at = DATE_ADD(COALESCE(created_at, CURRENT_TIMESTAMP), INTERVAL 30 MINUTE) WHERE expires_at IS NULL`) } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_auth_intents_expires ON feed_message_auth_intents (expires_at)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_auth_intents_state_expires ON feed_message_auth_intents (state, expires_at)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_auth_intents_message_created ON feed_message_auth_intents (message_id, created_at)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_auth_intents_session_created ON feed_message_auth_intents (message_session_id, created_at)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_auth_intents_user_created ON feed_message_auth_intents (user_id, created_at)`); } catch {}

          await db.query(`
            CREATE TABLE IF NOT EXISTS feed_message_user_suppressions (
              id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              user_id BIGINT UNSIGNED NOT NULL,
              scope ENUM('message','campaign') NOT NULL,
              suppression_key VARCHAR(191) NOT NULL,
              message_id BIGINT UNSIGNED NULL,
              campaign_key VARCHAR(64) NULL,
              reason ENUM('auth_complete','flow_complete') NOT NULL DEFAULT 'auth_complete',
              source_intent_id CHAR(36) NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_feed_message_user_suppressions_user_key (user_id, suppression_key),
              KEY idx_feed_message_user_suppressions_user_created (user_id, created_at),
              KEY idx_feed_message_user_suppressions_scope_message (scope, message_id, created_at),
              KEY idx_feed_message_user_suppressions_scope_campaign (scope, campaign_key, created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `)
          await db.query(`ALTER TABLE feed_message_user_suppressions ADD COLUMN IF NOT EXISTS user_id BIGINT UNSIGNED NOT NULL`)
          await db.query(`ALTER TABLE feed_message_user_suppressions ADD COLUMN IF NOT EXISTS scope ENUM('message','campaign') NOT NULL`)
          await db.query(`ALTER TABLE feed_message_user_suppressions ADD COLUMN IF NOT EXISTS suppression_key VARCHAR(191) NOT NULL`)
          await db.query(`ALTER TABLE feed_message_user_suppressions ADD COLUMN IF NOT EXISTS message_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE feed_message_user_suppressions ADD COLUMN IF NOT EXISTS campaign_key VARCHAR(64) NULL`)
          await db.query(`ALTER TABLE feed_message_user_suppressions ADD COLUMN IF NOT EXISTS reason ENUM('auth_complete','flow_complete') NOT NULL DEFAULT 'auth_complete'`)
          try { await db.query(`ALTER TABLE feed_message_user_suppressions MODIFY COLUMN reason ENUM('auth_complete','flow_complete') NOT NULL DEFAULT 'auth_complete'`) } catch {}
          await db.query(`ALTER TABLE feed_message_user_suppressions ADD COLUMN IF NOT EXISTS source_intent_id CHAR(36) NULL`)
          try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_feed_message_user_suppressions_user_key ON feed_message_user_suppressions (user_id, suppression_key)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_user_suppressions_user_created ON feed_message_user_suppressions (user_id, created_at)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_user_suppressions_scope_message ON feed_message_user_suppressions (scope, message_id, created_at)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_user_suppressions_scope_campaign ON feed_message_user_suppressions (scope, campaign_key, created_at)`); } catch {}

          await db.query(`
            CREATE TABLE IF NOT EXISTS feed_message_daily_stats (
              date_utc DATE NOT NULL,
              surface ENUM('global_feed','group_feed','channel_feed') NOT NULL DEFAULT 'global_feed',
              message_id BIGINT UNSIGNED NOT NULL,
              message_campaign_key VARCHAR(64) NOT NULL DEFAULT '',
              viewer_state ENUM('anonymous','authenticated') NOT NULL DEFAULT 'anonymous',
              event_type ENUM(
                'message_impression',
                'message_click',
                'message_dismiss',
                'auth_start_from_message',
                'auth_complete_from_message',
                'donation_complete_from_message',
                'subscription_complete_from_message',
                'upgrade_complete_from_message'
              ) NOT NULL,
              total_events BIGINT UNSIGNED NOT NULL DEFAULT 0,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              PRIMARY KEY (
                date_utc, surface, message_id, message_campaign_key, viewer_state, event_type
              ),
              KEY idx_feed_message_daily_stats_surface_date (surface, date_utc, event_type),
              KEY idx_feed_message_daily_stats_message_date (message_id, date_utc, event_type),
              KEY idx_feed_message_daily_stats_campaign_key_date (message_campaign_key, date_utc, event_type)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `)
          await db.query(`ALTER TABLE feed_message_daily_stats ADD COLUMN IF NOT EXISTS date_utc DATE NOT NULL`)
          await db.query(`ALTER TABLE feed_message_daily_stats ADD COLUMN IF NOT EXISTS surface ENUM('global_feed','group_feed','channel_feed') NOT NULL DEFAULT 'global_feed'`)
          try { await db.query(`ALTER TABLE feed_message_daily_stats MODIFY COLUMN surface ENUM('global_feed','group_feed','channel_feed') NOT NULL DEFAULT 'global_feed'`) } catch {}
          await migrateColumnNameIfNeeded(db, 'feed_message_daily_stats', 'prompt_id', 'message_id', `BIGINT UNSIGNED NOT NULL DEFAULT 0`)
          await migrateColumnNameIfNeeded(db, 'feed_message_daily_stats', 'prompt_campaign_key', 'message_campaign_key', `VARCHAR(64) NOT NULL DEFAULT ''`)
          await db.query(`ALTER TABLE feed_message_daily_stats ADD COLUMN IF NOT EXISTS message_id BIGINT UNSIGNED NOT NULL DEFAULT 0`)
          await db.query(`ALTER TABLE feed_message_daily_stats ADD COLUMN IF NOT EXISTS message_campaign_key VARCHAR(64) NOT NULL DEFAULT ''`)
          await db.query(`ALTER TABLE feed_message_daily_stats ADD COLUMN IF NOT EXISTS viewer_state ENUM('anonymous','authenticated') NOT NULL DEFAULT 'anonymous'`)
          await db.query(`ALTER TABLE feed_message_daily_stats ADD COLUMN IF NOT EXISTS event_type ENUM('message_impression','message_click','message_dismiss','auth_start_from_message','auth_complete_from_message','donation_complete_from_message','subscription_complete_from_message','upgrade_complete_from_message') NOT NULL`)
          await db.query(`ALTER TABLE feed_message_daily_stats ADD COLUMN IF NOT EXISTS total_events BIGINT UNSIGNED NOT NULL DEFAULT 0`)
          try {
            await db.query(
              `ALTER TABLE feed_message_daily_stats
                 MODIFY COLUMN event_type ENUM(
                   'prompt_impression',
                   'prompt_click_primary',
                   'prompt_click_secondary',
                   'prompt_dismiss',
                   'auth_start_from_prompt',
                   'auth_complete_from_prompt',
                   'message_impression',
                   'message_click_primary',
                   'message_click_secondary',
                   'message_click',
                   'message_dismiss',
                   'auth_start_from_message',
                   'auth_complete_from_message',
                   'donation_complete_from_message',
                   'subscription_complete_from_message',
                   'upgrade_complete_from_message'
                 ) NOT NULL`
            )
          } catch {}
          try {
            await db.query(`
              UPDATE feed_message_daily_stats
                 SET event_type = CASE event_type
                   WHEN 'prompt_impression' THEN 'message_impression'
                   WHEN 'prompt_click_primary' THEN 'message_click'
                   WHEN 'prompt_click_secondary' THEN 'message_click'
                   WHEN 'message_click_primary' THEN 'message_click'
                   WHEN 'message_click_secondary' THEN 'message_click'
                   WHEN 'prompt_dismiss' THEN 'message_dismiss'
                   WHEN 'auth_start_from_prompt' THEN 'auth_start_from_message'
                   WHEN 'auth_complete_from_prompt' THEN 'auth_complete_from_message'
                   ELSE event_type
                 END
               WHERE event_type IN (
                 'prompt_impression',
                 'prompt_click_primary',
                 'prompt_click_secondary',
                 'message_click_primary',
                 'message_click_secondary',
                 'prompt_dismiss',
                 'auth_start_from_prompt',
                 'auth_complete_from_prompt'
               )
            `)
          } catch {}
          try {
            await db.query(
              `ALTER TABLE feed_message_daily_stats
                 MODIFY COLUMN event_type ENUM(
                   'message_impression',
                   'message_click',
                   'message_dismiss',
                   'auth_start_from_message',
                   'auth_complete_from_message',
                   'donation_complete_from_message',
                   'subscription_complete_from_message',
                   'upgrade_complete_from_message'
                 ) NOT NULL`
            )
          } catch {}
          try {
            await db.query(`ALTER TABLE feed_message_daily_stats DROP PRIMARY KEY, DROP COLUMN prompt_kind, ADD PRIMARY KEY (date_utc, surface, message_id, message_campaign_key, viewer_state, event_type)`)
          } catch {
            try { await db.query(`ALTER TABLE feed_message_daily_stats DROP COLUMN prompt_kind`); } catch {}
            try {
              await db.query(`ALTER TABLE feed_message_daily_stats DROP PRIMARY KEY`)
            } catch {}
            try { await db.query(`ALTER TABLE feed_message_daily_stats ADD PRIMARY KEY (date_utc, surface, message_id, message_campaign_key, viewer_state, event_type)`); } catch {}
          }
          try { await db.query(`DROP INDEX idx_feed_prompt_daily_stats_surface_date ON feed_message_daily_stats`) } catch {}
          try { await db.query(`DROP INDEX idx_feed_prompt_daily_stats_prompt_date ON feed_message_daily_stats`) } catch {}
          try { await db.query(`DROP INDEX idx_feed_prompt_daily_stats_campaign_key_date ON feed_message_daily_stats`) } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_daily_stats_surface_date ON feed_message_daily_stats (surface, date_utc, event_type)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_daily_stats_message_date ON feed_message_daily_stats (message_id, date_utc, event_type)`); } catch {}
          try {
            await db.query(`
              UPDATE feed_message_daily_stats
                 SET message_campaign_key = COALESCE(NULLIF(TRIM(prompt_category), ''), '')
               WHERE message_campaign_key = ''
                 AND COALESCE(prompt_category, '') <> ''
            `)
          } catch {}
          try { await db.query(`ALTER TABLE feed_message_daily_stats DROP COLUMN prompt_category`) } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_message_daily_stats_campaign_key_date ON feed_message_daily_stats (message_campaign_key, date_utc, event_type)`); } catch {}
          try {
            await db.query(
              `INSERT INTO feed_message_daily_stats
                (date_utc, surface, message_id, message_campaign_key, viewer_state, event_type, total_events)
               SELECT
                 DATE(occurred_at) AS date_utc,
                 surface,
                 message_id,
                 COALESCE(message_campaign_key, '') AS message_campaign_key,
                 viewer_state,
                 event_type,
                 COUNT(*) AS total_events
               FROM feed_message_events
               WHERE event_type <> 'auth_complete_from_message' OR attributed = 1
               GROUP BY DATE(occurred_at), surface, message_id, COALESCE(message_campaign_key, ''), viewer_state, event_type
               ON DUPLICATE KEY UPDATE total_events = VALUES(total_events), updated_at = CURRENT_TIMESTAMP`
            )
          } catch {}

          // --- Payments domain foundation (plan_139A) ---
          await db.query(`
            CREATE TABLE IF NOT EXISTS payment_provider_configs (
              id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              provider ENUM('paypal') NOT NULL,
              mode ENUM('sandbox','live') NOT NULL DEFAULT 'sandbox',
              status ENUM('disabled','enabled') NOT NULL DEFAULT 'disabled',
              donate_enabled TINYINT(1) NOT NULL DEFAULT 0,
              subscribe_enabled TINYINT(1) NOT NULL DEFAULT 0,
              credentials_json JSON NOT NULL,
              webhook_id VARCHAR(191) NULL,
              webhook_secret VARCHAR(191) NULL,
              notes VARCHAR(500) NULL,
              created_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
              updated_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_payment_provider_mode (provider, mode),
              KEY idx_payment_provider_status (status, provider, mode)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `)
          await db.query(`ALTER TABLE payment_provider_configs ADD COLUMN IF NOT EXISTS provider ENUM('paypal') NOT NULL`)
          await db.query(`ALTER TABLE payment_provider_configs ADD COLUMN IF NOT EXISTS mode ENUM('sandbox','live') NOT NULL DEFAULT 'sandbox'`)
          await db.query(`ALTER TABLE payment_provider_configs ADD COLUMN IF NOT EXISTS status ENUM('disabled','enabled') NOT NULL DEFAULT 'disabled'`)
          await db.query(`ALTER TABLE payment_provider_configs ADD COLUMN IF NOT EXISTS donate_enabled TINYINT(1) NOT NULL DEFAULT 0`)
          await db.query(`ALTER TABLE payment_provider_configs ADD COLUMN IF NOT EXISTS subscribe_enabled TINYINT(1) NOT NULL DEFAULT 0`)
          await db.query(`ALTER TABLE payment_provider_configs ADD COLUMN IF NOT EXISTS credentials_json JSON NULL`)
          try { await db.query(`UPDATE payment_provider_configs SET credentials_json = JSON_OBJECT() WHERE credentials_json IS NULL`) } catch {}
          try { await db.query(`ALTER TABLE payment_provider_configs MODIFY COLUMN credentials_json JSON NOT NULL`) } catch {}
          await db.query(`ALTER TABLE payment_provider_configs ADD COLUMN IF NOT EXISTS webhook_id VARCHAR(191) NULL`)
          await db.query(`ALTER TABLE payment_provider_configs ADD COLUMN IF NOT EXISTS webhook_secret VARCHAR(191) NULL`)
          await db.query(`ALTER TABLE payment_provider_configs ADD COLUMN IF NOT EXISTS notes VARCHAR(500) NULL`)
          await db.query(`ALTER TABLE payment_provider_configs ADD COLUMN IF NOT EXISTS created_by BIGINT UNSIGNED NOT NULL DEFAULT 0`)
          await db.query(`ALTER TABLE payment_provider_configs ADD COLUMN IF NOT EXISTS updated_by BIGINT UNSIGNED NOT NULL DEFAULT 0`)
          try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_payment_provider_mode ON payment_provider_configs (provider, mode)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_payment_provider_status ON payment_provider_configs (status, provider, mode)`); } catch {}

          await db.query(`
            CREATE TABLE IF NOT EXISTS payment_catalog_items (
              id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              kind ENUM('donate_campaign','subscribe_plan') NOT NULL,
              item_key VARCHAR(64) NOT NULL,
              label VARCHAR(160) NOT NULL,
              status ENUM('draft','active','archived') NOT NULL DEFAULT 'draft',
              amount_cents BIGINT UNSIGNED NULL,
              currency CHAR(3) NOT NULL DEFAULT 'USD',
              provider ENUM('paypal') NOT NULL DEFAULT 'paypal',
              provider_ref VARCHAR(191) NULL,
              config_json JSON NOT NULL,
              created_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
              updated_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_payment_catalog_kind_key (kind, item_key),
              KEY idx_payment_catalog_status_kind (status, kind, id),
              KEY idx_payment_catalog_provider_ref (provider, provider_ref)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `)
          await db.query(`ALTER TABLE payment_catalog_items ADD COLUMN IF NOT EXISTS kind ENUM('donate_campaign','subscribe_plan') NOT NULL`)
          await db.query(`ALTER TABLE payment_catalog_items ADD COLUMN IF NOT EXISTS item_key VARCHAR(64) NOT NULL`)
          await db.query(`ALTER TABLE payment_catalog_items ADD COLUMN IF NOT EXISTS label VARCHAR(160) NOT NULL`)
          await db.query(`ALTER TABLE payment_catalog_items ADD COLUMN IF NOT EXISTS status ENUM('draft','active','archived') NOT NULL DEFAULT 'draft'`)
          await db.query(`ALTER TABLE payment_catalog_items ADD COLUMN IF NOT EXISTS amount_cents BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE payment_catalog_items ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'USD'`)
          await db.query(`ALTER TABLE payment_catalog_items ADD COLUMN IF NOT EXISTS provider ENUM('paypal') NOT NULL DEFAULT 'paypal'`)
          await db.query(`ALTER TABLE payment_catalog_items ADD COLUMN IF NOT EXISTS provider_ref VARCHAR(191) NULL`)
          await db.query(`ALTER TABLE payment_catalog_items ADD COLUMN IF NOT EXISTS config_json JSON NULL`)
          try { await db.query(`UPDATE payment_catalog_items SET config_json = JSON_OBJECT() WHERE config_json IS NULL`) } catch {}
          try { await db.query(`ALTER TABLE payment_catalog_items MODIFY COLUMN config_json JSON NOT NULL`) } catch {}
          await db.query(`ALTER TABLE payment_catalog_items ADD COLUMN IF NOT EXISTS created_by BIGINT UNSIGNED NOT NULL DEFAULT 0`)
          await db.query(`ALTER TABLE payment_catalog_items ADD COLUMN IF NOT EXISTS updated_by BIGINT UNSIGNED NOT NULL DEFAULT 0`)
          try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_payment_catalog_kind_key ON payment_catalog_items (kind, item_key)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_payment_catalog_status_kind ON payment_catalog_items (status, kind, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_payment_catalog_provider_ref ON payment_catalog_items (provider, provider_ref)`); } catch {}

          await db.query(`
            CREATE TABLE IF NOT EXISTS payment_checkout_sessions (
              id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              checkout_id CHAR(36) NOT NULL,
              provider ENUM('paypal') NOT NULL DEFAULT 'paypal',
              mode ENUM('sandbox','live') NOT NULL DEFAULT 'sandbox',
              intent ENUM('donate','subscribe') NOT NULL,
              status ENUM('pending','redirected','completed','failed','canceled','expired') NOT NULL DEFAULT 'pending',
              user_id BIGINT UNSIGNED NULL,
              message_id BIGINT UNSIGNED NULL,
              message_campaign_key VARCHAR(64) NULL,
              message_intent_id CHAR(36) NULL,
              message_cta_definition_id BIGINT UNSIGNED NULL,
              catalog_item_id BIGINT UNSIGNED NULL,
              amount_cents BIGINT UNSIGNED NULL,
              currency CHAR(3) NOT NULL DEFAULT 'USD',
              provider_session_id VARCHAR(191) NULL,
              provider_order_id VARCHAR(191) NULL,
              return_url VARCHAR(1200) NULL,
              cancel_url VARCHAR(1200) NULL,
              metadata_json JSON NOT NULL,
              completed_at DATETIME NULL,
              failed_at DATETIME NULL,
              expired_at DATETIME NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_payment_checkout_checkout_id (checkout_id),
              UNIQUE KEY uniq_payment_checkout_provider_session (provider, provider_session_id),
              KEY idx_payment_checkout_status_created (status, created_at, id),
              KEY idx_payment_checkout_message_intent (message_intent_id, created_at, id),
              KEY idx_payment_checkout_user_created (user_id, created_at, id),
              KEY idx_payment_checkout_provider_order (provider, provider_order_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `)
          await db.query(`ALTER TABLE payment_checkout_sessions ADD COLUMN IF NOT EXISTS checkout_id CHAR(36) NOT NULL`)
          await db.query(`ALTER TABLE payment_checkout_sessions ADD COLUMN IF NOT EXISTS provider ENUM('paypal') NOT NULL DEFAULT 'paypal'`)
          await db.query(`ALTER TABLE payment_checkout_sessions ADD COLUMN IF NOT EXISTS mode ENUM('sandbox','live') NOT NULL DEFAULT 'sandbox'`)
          await db.query(`ALTER TABLE payment_checkout_sessions ADD COLUMN IF NOT EXISTS intent ENUM('donate','subscribe') NOT NULL`)
          await db.query(`ALTER TABLE payment_checkout_sessions ADD COLUMN IF NOT EXISTS status ENUM('pending','redirected','completed','failed','canceled','expired') NOT NULL DEFAULT 'pending'`)
          await db.query(`ALTER TABLE payment_checkout_sessions ADD COLUMN IF NOT EXISTS user_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE payment_checkout_sessions ADD COLUMN IF NOT EXISTS message_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE payment_checkout_sessions ADD COLUMN IF NOT EXISTS message_campaign_key VARCHAR(64) NULL`)
          await db.query(`ALTER TABLE payment_checkout_sessions ADD COLUMN IF NOT EXISTS message_intent_id CHAR(36) NULL`)
          await db.query(`ALTER TABLE payment_checkout_sessions ADD COLUMN IF NOT EXISTS message_cta_definition_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE payment_checkout_sessions ADD COLUMN IF NOT EXISTS catalog_item_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE payment_checkout_sessions ADD COLUMN IF NOT EXISTS amount_cents BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE payment_checkout_sessions ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'USD'`)
          await db.query(`ALTER TABLE payment_checkout_sessions ADD COLUMN IF NOT EXISTS provider_session_id VARCHAR(191) NULL`)
          await db.query(`ALTER TABLE payment_checkout_sessions ADD COLUMN IF NOT EXISTS provider_order_id VARCHAR(191) NULL`)
          await db.query(`ALTER TABLE payment_checkout_sessions ADD COLUMN IF NOT EXISTS return_url VARCHAR(1200) NULL`)
          await db.query(`ALTER TABLE payment_checkout_sessions ADD COLUMN IF NOT EXISTS cancel_url VARCHAR(1200) NULL`)
          await db.query(`ALTER TABLE payment_checkout_sessions ADD COLUMN IF NOT EXISTS metadata_json JSON NULL`)
          try { await db.query(`UPDATE payment_checkout_sessions SET metadata_json = JSON_OBJECT() WHERE metadata_json IS NULL`) } catch {}
          try { await db.query(`ALTER TABLE payment_checkout_sessions MODIFY COLUMN metadata_json JSON NOT NULL`) } catch {}
          await db.query(`ALTER TABLE payment_checkout_sessions ADD COLUMN IF NOT EXISTS completed_at DATETIME NULL`)
          await db.query(`ALTER TABLE payment_checkout_sessions ADD COLUMN IF NOT EXISTS failed_at DATETIME NULL`)
          await db.query(`ALTER TABLE payment_checkout_sessions ADD COLUMN IF NOT EXISTS expired_at DATETIME NULL`)
          try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_payment_checkout_checkout_id ON payment_checkout_sessions (checkout_id)`); } catch {}
          try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_payment_checkout_provider_session ON payment_checkout_sessions (provider, provider_session_id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_payment_checkout_status_created ON payment_checkout_sessions (status, created_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_payment_checkout_message_intent ON payment_checkout_sessions (message_intent_id, created_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_payment_checkout_user_created ON payment_checkout_sessions (user_id, created_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_payment_checkout_provider_order ON payment_checkout_sessions (provider, provider_order_id)`); } catch {}

          await db.query(`
            CREATE TABLE IF NOT EXISTS payment_webhook_events (
              id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              provider ENUM('paypal') NOT NULL DEFAULT 'paypal',
              mode ENUM('sandbox','live') NOT NULL DEFAULT 'sandbox',
              provider_event_id VARCHAR(191) NULL,
              event_type VARCHAR(120) NOT NULL,
              dedupe_key CHAR(64) NOT NULL,
              signature_valid TINYINT(1) NOT NULL DEFAULT 0,
              processing_state ENUM('pending','processed','ignored','failed') NOT NULL DEFAULT 'pending',
              error_message VARCHAR(500) NULL,
              payload_json JSON NOT NULL,
              headers_json JSON NULL,
              received_at DATETIME NOT NULL,
              processed_at DATETIME NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_payment_webhook_dedupe_key (dedupe_key),
              KEY idx_payment_webhook_provider_event (provider, mode, provider_event_id),
              KEY idx_payment_webhook_state_received (processing_state, received_at, id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `)
          await db.query(`ALTER TABLE payment_webhook_events ADD COLUMN IF NOT EXISTS provider ENUM('paypal') NOT NULL DEFAULT 'paypal'`)
          await db.query(`ALTER TABLE payment_webhook_events ADD COLUMN IF NOT EXISTS mode ENUM('sandbox','live') NOT NULL DEFAULT 'sandbox'`)
          await db.query(`ALTER TABLE payment_webhook_events ADD COLUMN IF NOT EXISTS provider_event_id VARCHAR(191) NULL`)
          await db.query(`ALTER TABLE payment_webhook_events ADD COLUMN IF NOT EXISTS event_type VARCHAR(120) NOT NULL`)
          await db.query(`ALTER TABLE payment_webhook_events ADD COLUMN IF NOT EXISTS dedupe_key CHAR(64) NULL`)
          try { await db.query(`UPDATE payment_webhook_events SET dedupe_key = LPAD(HEX(id), 64, '0') WHERE dedupe_key IS NULL OR dedupe_key = ''`) } catch {}
          try { await db.query(`ALTER TABLE payment_webhook_events MODIFY COLUMN dedupe_key CHAR(64) NOT NULL`) } catch {}
          await db.query(`ALTER TABLE payment_webhook_events ADD COLUMN IF NOT EXISTS signature_valid TINYINT(1) NOT NULL DEFAULT 0`)
          await db.query(`ALTER TABLE payment_webhook_events ADD COLUMN IF NOT EXISTS processing_state ENUM('pending','processed','ignored','failed') NOT NULL DEFAULT 'pending'`)
          await db.query(`ALTER TABLE payment_webhook_events ADD COLUMN IF NOT EXISTS error_message VARCHAR(500) NULL`)
          await db.query(`ALTER TABLE payment_webhook_events ADD COLUMN IF NOT EXISTS payload_json JSON NULL`)
          try { await db.query(`UPDATE payment_webhook_events SET payload_json = JSON_OBJECT() WHERE payload_json IS NULL`) } catch {}
          try { await db.query(`ALTER TABLE payment_webhook_events MODIFY COLUMN payload_json JSON NOT NULL`) } catch {}
          await db.query(`ALTER TABLE payment_webhook_events ADD COLUMN IF NOT EXISTS headers_json JSON NULL`)
          await db.query(`ALTER TABLE payment_webhook_events ADD COLUMN IF NOT EXISTS received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`)
          await db.query(`ALTER TABLE payment_webhook_events ADD COLUMN IF NOT EXISTS processed_at DATETIME NULL`)
          try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_payment_webhook_dedupe_key ON payment_webhook_events (dedupe_key)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_payment_webhook_provider_event ON payment_webhook_events (provider, mode, provider_event_id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_payment_webhook_state_received ON payment_webhook_events (processing_state, received_at, id)`); } catch {}

          await db.query(`
            CREATE TABLE IF NOT EXISTS payment_transactions (
              id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              checkout_session_id BIGINT UNSIGNED NOT NULL,
              checkout_id CHAR(36) NOT NULL,
              provider ENUM('paypal') NOT NULL DEFAULT 'paypal',
              mode ENUM('sandbox','live') NOT NULL DEFAULT 'sandbox',
              intent ENUM('donate','subscribe') NOT NULL,
              status ENUM('pending','completed','failed','canceled','expired') NOT NULL DEFAULT 'pending',
              source ENUM('webhook','return') NOT NULL DEFAULT 'webhook',
              provider_event_id VARCHAR(191) NULL,
              provider_event_type VARCHAR(120) NULL,
              provider_session_id VARCHAR(191) NULL,
              provider_order_id VARCHAR(191) NULL,
              provider_subscription_id VARCHAR(191) NULL,
              user_id BIGINT UNSIGNED NULL,
              message_id BIGINT UNSIGNED NULL,
              message_campaign_key VARCHAR(64) NULL,
              message_intent_id CHAR(36) NULL,
              message_cta_definition_id BIGINT UNSIGNED NULL,
              catalog_item_id BIGINT UNSIGNED NULL,
              amount_cents BIGINT UNSIGNED NULL,
              currency CHAR(3) NOT NULL DEFAULT 'USD',
              occurred_at DATETIME NOT NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_payment_tx_checkout_session (checkout_session_id),
              KEY idx_payment_tx_status_occurred (status, occurred_at, id),
              KEY idx_payment_tx_user_occurred (user_id, occurred_at, id),
              KEY idx_payment_tx_message_occurred (message_id, occurred_at, id),
              KEY idx_payment_tx_campaign_occurred (message_campaign_key, occurred_at, id),
              KEY idx_payment_tx_provider_order (provider, mode, provider_order_id),
              KEY idx_payment_tx_provider_event (provider, mode, provider_event_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `)
          await db.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS checkout_session_id BIGINT UNSIGNED NOT NULL`)
          await db.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS checkout_id CHAR(36) NOT NULL`)
          await db.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS provider ENUM('paypal') NOT NULL DEFAULT 'paypal'`)
          await db.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS mode ENUM('sandbox','live') NOT NULL DEFAULT 'sandbox'`)
          await db.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS intent ENUM('donate','subscribe') NOT NULL`)
          await db.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS status ENUM('pending','completed','failed','canceled','expired') NOT NULL DEFAULT 'pending'`)
          await db.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS source ENUM('webhook','return') NOT NULL DEFAULT 'webhook'`)
          await db.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS provider_event_id VARCHAR(191) NULL`)
          await db.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS provider_event_type VARCHAR(120) NULL`)
          await db.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS provider_session_id VARCHAR(191) NULL`)
          await db.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS provider_order_id VARCHAR(191) NULL`)
          await db.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS provider_subscription_id VARCHAR(191) NULL`)
          await db.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS user_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS message_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS message_campaign_key VARCHAR(64) NULL`)
          await db.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS message_intent_id CHAR(36) NULL`)
          await db.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS message_cta_definition_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS catalog_item_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS amount_cents BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'USD'`)
          await db.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`)
          try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_payment_tx_checkout_session ON payment_transactions (checkout_session_id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_payment_tx_status_occurred ON payment_transactions (status, occurred_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_payment_tx_user_occurred ON payment_transactions (user_id, occurred_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_payment_tx_message_occurred ON payment_transactions (message_id, occurred_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_payment_tx_campaign_occurred ON payment_transactions (message_campaign_key, occurred_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_payment_tx_provider_order ON payment_transactions (provider, mode, provider_order_id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_payment_tx_provider_event ON payment_transactions (provider, mode, provider_event_id)`); } catch {}

          await db.query(`
            CREATE TABLE IF NOT EXISTS payment_subscriptions (
              id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              provider ENUM('paypal') NOT NULL DEFAULT 'paypal',
              mode ENUM('sandbox','live') NOT NULL DEFAULT 'sandbox',
              provider_subscription_id VARCHAR(191) NOT NULL,
              status ENUM('pending','active','suspended','canceled','expired') NOT NULL DEFAULT 'pending',
              user_id BIGINT UNSIGNED NULL,
              checkout_session_id BIGINT UNSIGNED NULL,
              checkout_id CHAR(36) NULL,
              provider_order_id VARCHAR(191) NULL,
              catalog_item_id BIGINT UNSIGNED NULL,
              amount_cents BIGINT UNSIGNED NULL,
              currency CHAR(3) NOT NULL DEFAULT 'USD',
              message_id BIGINT UNSIGNED NULL,
              message_campaign_key VARCHAR(64) NULL,
              pending_action ENUM('cancel','resume','change_plan') NULL,
              pending_plan_key VARCHAR(64) NULL,
              pending_requested_at DATETIME NULL,
              last_event_type VARCHAR(120) NULL,
              last_event_at DATETIME NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_payment_sub_provider_id (provider, mode, provider_subscription_id),
              KEY idx_payment_sub_status_updated (status, updated_at, id),
              KEY idx_payment_sub_user_status (user_id, status, id),
              KEY idx_payment_sub_catalog_status (catalog_item_id, status, id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `)
          await db.query(`ALTER TABLE payment_subscriptions ADD COLUMN IF NOT EXISTS provider ENUM('paypal') NOT NULL DEFAULT 'paypal'`)
          await db.query(`ALTER TABLE payment_subscriptions ADD COLUMN IF NOT EXISTS mode ENUM('sandbox','live') NOT NULL DEFAULT 'sandbox'`)
          await db.query(`ALTER TABLE payment_subscriptions ADD COLUMN IF NOT EXISTS provider_subscription_id VARCHAR(191) NOT NULL`)
          await db.query(`ALTER TABLE payment_subscriptions ADD COLUMN IF NOT EXISTS status ENUM('pending','active','suspended','canceled','expired') NOT NULL DEFAULT 'pending'`)
          await db.query(`ALTER TABLE payment_subscriptions ADD COLUMN IF NOT EXISTS user_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE payment_subscriptions ADD COLUMN IF NOT EXISTS checkout_session_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE payment_subscriptions ADD COLUMN IF NOT EXISTS checkout_id CHAR(36) NULL`)
          await db.query(`ALTER TABLE payment_subscriptions ADD COLUMN IF NOT EXISTS provider_order_id VARCHAR(191) NULL`)
          await db.query(`ALTER TABLE payment_subscriptions ADD COLUMN IF NOT EXISTS catalog_item_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE payment_subscriptions ADD COLUMN IF NOT EXISTS amount_cents BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE payment_subscriptions ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'USD'`)
          await db.query(`ALTER TABLE payment_subscriptions ADD COLUMN IF NOT EXISTS message_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE payment_subscriptions ADD COLUMN IF NOT EXISTS message_campaign_key VARCHAR(64) NULL`)
          await db.query(`ALTER TABLE payment_subscriptions ADD COLUMN IF NOT EXISTS pending_action ENUM('cancel','resume','change_plan') NULL`)
          await db.query(`ALTER TABLE payment_subscriptions ADD COLUMN IF NOT EXISTS pending_plan_key VARCHAR(64) NULL`)
          await db.query(`ALTER TABLE payment_subscriptions ADD COLUMN IF NOT EXISTS pending_requested_at DATETIME NULL`)
          await db.query(`ALTER TABLE payment_subscriptions ADD COLUMN IF NOT EXISTS last_event_type VARCHAR(120) NULL`)
          await db.query(`ALTER TABLE payment_subscriptions ADD COLUMN IF NOT EXISTS last_event_at DATETIME NULL`)
          try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_payment_sub_provider_id ON payment_subscriptions (provider, mode, provider_subscription_id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_payment_sub_status_updated ON payment_subscriptions (status, updated_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_payment_sub_user_status ON payment_subscriptions (user_id, status, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_payment_sub_catalog_status ON payment_subscriptions (catalog_item_id, status, id)`); } catch {}

          await reconcileLegacyPromptNamedTables(db)

          // --- Feed baseline activity analytics (plan_115 Phase B) ---
          await db.query(`
            CREATE TABLE IF NOT EXISTS feed_activity_events (
              id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              event_type ENUM(
                'feed_session_start',
                'feed_slide_impression',
                'feed_slide_complete',
                'feed_session_end'
              ) NOT NULL,
              surface ENUM('global_feed','group_feed','channel_feed','my_feed') NOT NULL DEFAULT 'global_feed',
              viewer_state ENUM('anonymous','authenticated') NOT NULL DEFAULT 'anonymous',
              session_id VARCHAR(120) NOT NULL,
              user_id BIGINT UNSIGNED NULL,
              content_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
              space_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
              watch_seconds INT UNSIGNED NOT NULL DEFAULT 0,
              occurred_at DATETIME NOT NULL,
              dedupe_key CHAR(64) NOT NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_feed_activity_events_dedupe_key (dedupe_key),
              KEY idx_feed_activity_events_occurred (occurred_at, id),
              KEY idx_feed_activity_events_surface_occurred (surface, occurred_at, id),
              KEY idx_feed_activity_events_space_occurred (space_id, occurred_at, id),
              KEY idx_feed_activity_events_event_occurred (event_type, occurred_at, id),
              KEY idx_feed_activity_events_session_event (session_id, event_type, occurred_at, id),
              KEY idx_feed_activity_events_user_event (user_id, event_type, occurred_at, id),
              KEY idx_feed_activity_events_content_event (content_id, event_type, occurred_at, id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `)
          await db.query(`ALTER TABLE feed_activity_events ADD COLUMN IF NOT EXISTS event_type ENUM('feed_session_start','feed_slide_impression','feed_slide_complete','feed_session_end') NOT NULL`)
          await db.query(`ALTER TABLE feed_activity_events ADD COLUMN IF NOT EXISTS surface ENUM('global_feed','group_feed','channel_feed','my_feed') NOT NULL DEFAULT 'global_feed'`)
          await db.query(`ALTER TABLE feed_activity_events MODIFY COLUMN surface ENUM('global_feed','group_feed','channel_feed','my_feed') NOT NULL DEFAULT 'global_feed'`)
          await db.query(`ALTER TABLE feed_activity_events ADD COLUMN IF NOT EXISTS viewer_state ENUM('anonymous','authenticated') NOT NULL DEFAULT 'anonymous'`)
          await db.query(`ALTER TABLE feed_activity_events ADD COLUMN IF NOT EXISTS session_id VARCHAR(120) NOT NULL DEFAULT ''`)
          await db.query(`ALTER TABLE feed_activity_events ADD COLUMN IF NOT EXISTS user_id BIGINT UNSIGNED NULL`)
          await db.query(`ALTER TABLE feed_activity_events ADD COLUMN IF NOT EXISTS content_id BIGINT UNSIGNED NOT NULL DEFAULT 0`)
          await db.query(`ALTER TABLE feed_activity_events ADD COLUMN IF NOT EXISTS space_id BIGINT UNSIGNED NOT NULL DEFAULT 0`)
          await db.query(`ALTER TABLE feed_activity_events ADD COLUMN IF NOT EXISTS watch_seconds INT UNSIGNED NOT NULL DEFAULT 0`)
          await db.query(`ALTER TABLE feed_activity_events ADD COLUMN IF NOT EXISTS occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`)
          await db.query(`ALTER TABLE feed_activity_events ADD COLUMN IF NOT EXISTS dedupe_key CHAR(64) NULL`)
          try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_feed_activity_events_dedupe_key ON feed_activity_events (dedupe_key)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_activity_events_occurred ON feed_activity_events (occurred_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_activity_events_surface_occurred ON feed_activity_events (surface, occurred_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_activity_events_space_occurred ON feed_activity_events (space_id, occurred_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_activity_events_event_occurred ON feed_activity_events (event_type, occurred_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_activity_events_session_event ON feed_activity_events (session_id, event_type, occurred_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_activity_events_user_event ON feed_activity_events (user_id, event_type, occurred_at, id)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_activity_events_content_event ON feed_activity_events (content_id, event_type, occurred_at, id)`); } catch {}
          try { await db.query(`UPDATE feed_activity_events SET content_id = 0 WHERE content_id IS NULL`); } catch {}
          try { await db.query(`UPDATE feed_activity_events SET space_id = 0 WHERE space_id IS NULL`); } catch {}
          try { await db.query(`UPDATE feed_activity_events SET dedupe_key = LPAD(HEX(id), 64, '0') WHERE dedupe_key IS NULL OR dedupe_key = ''`); } catch {}

          await db.query(`
            CREATE TABLE IF NOT EXISTS feed_activity_daily_stats (
              date_utc DATE NOT NULL,
              surface ENUM('global_feed','group_feed','channel_feed','my_feed') NOT NULL DEFAULT 'global_feed',
              viewer_state ENUM('anonymous','authenticated') NOT NULL DEFAULT 'anonymous',
              event_type ENUM(
                'feed_session_start',
                'feed_slide_impression',
                'feed_slide_complete',
                'feed_session_end'
              ) NOT NULL,
              content_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
              total_events BIGINT UNSIGNED NOT NULL DEFAULT 0,
              total_watch_seconds BIGINT UNSIGNED NOT NULL DEFAULT 0,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              PRIMARY KEY (date_utc, surface, viewer_state, event_type, content_id),
              KEY idx_feed_activity_daily_surface_date (surface, date_utc, event_type),
              KEY idx_feed_activity_daily_viewer_date (viewer_state, date_utc, event_type),
              KEY idx_feed_activity_daily_content_date (content_id, date_utc, event_type)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `)
          await db.query(`ALTER TABLE feed_activity_daily_stats ADD COLUMN IF NOT EXISTS date_utc DATE NOT NULL`)
          await db.query(`ALTER TABLE feed_activity_daily_stats ADD COLUMN IF NOT EXISTS surface ENUM('global_feed','group_feed','channel_feed','my_feed') NOT NULL DEFAULT 'global_feed'`)
          await db.query(`ALTER TABLE feed_activity_daily_stats MODIFY COLUMN surface ENUM('global_feed','group_feed','channel_feed','my_feed') NOT NULL DEFAULT 'global_feed'`)
          await db.query(`ALTER TABLE feed_activity_daily_stats ADD COLUMN IF NOT EXISTS viewer_state ENUM('anonymous','authenticated') NOT NULL DEFAULT 'anonymous'`)
          await db.query(`ALTER TABLE feed_activity_daily_stats ADD COLUMN IF NOT EXISTS event_type ENUM('feed_session_start','feed_slide_impression','feed_slide_complete','feed_session_end') NOT NULL`)
          await db.query(`ALTER TABLE feed_activity_daily_stats ADD COLUMN IF NOT EXISTS content_id BIGINT UNSIGNED NOT NULL DEFAULT 0`)
          await db.query(`ALTER TABLE feed_activity_daily_stats ADD COLUMN IF NOT EXISTS total_events BIGINT UNSIGNED NOT NULL DEFAULT 0`)
          await db.query(`ALTER TABLE feed_activity_daily_stats ADD COLUMN IF NOT EXISTS total_watch_seconds BIGINT UNSIGNED NOT NULL DEFAULT 0`)
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_activity_daily_surface_date ON feed_activity_daily_stats (surface, date_utc, event_type)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_activity_daily_viewer_date ON feed_activity_daily_stats (viewer_state, date_utc, event_type)`); } catch {}
          try { await db.query(`CREATE INDEX IF NOT EXISTS idx_feed_activity_daily_content_date ON feed_activity_daily_stats (content_id, date_utc, event_type)`); } catch {}
          try {
            await db.query(
              `INSERT INTO feed_activity_daily_stats
                (date_utc, surface, viewer_state, event_type, content_id, total_events, total_watch_seconds)
               SELECT
                 DATE(occurred_at) AS date_utc,
                 surface,
                 viewer_state,
                 event_type,
                 COALESCE(content_id, 0) AS content_id,
                 COUNT(*) AS total_events,
                 COALESCE(SUM(CASE WHEN event_type = 'feed_session_end' THEN watch_seconds ELSE 0 END), 0) AS total_watch_seconds
               FROM feed_activity_events
               GROUP BY DATE(occurred_at), surface, viewer_state, event_type, COALESCE(content_id, 0)
               ON DUPLICATE KEY UPDATE
                 total_events = VALUES(total_events),
                 total_watch_seconds = VALUES(total_watch_seconds),
                 updated_at = CURRENT_TIMESTAMP`
            )
          } catch {}
          try {
            const curatedOwnerUserId = 1
            const curatedPresetIds = [3, 4, 5, 6, 7, 8, 9, 10, 11]
            const starterTemplateKeys = curatedPresetIds.map((_, idx) => `starter_${String(idx + 1).padStart(2, '0')}`)
            const starterTemplatePlaceholders = starterTemplateKeys.map(() => '?').join(', ')

            const baseVisualizerInstance = {
              id: 'instance_1',
              style: 'wave_line',
              fgColor: '#d4af37',
              opacity: 1,
              scale: 'linear',
              barCount: 48,
              spectrumMode: 'full',
              bandMode: 'full',
              voiceLowHz: 80,
              voiceHighHz: 4000,
              amplitudeGainPct: 100,
              baselineLiftPct: 0,
              waveVerticalGainPct: 100,
              waveVerticalOffsetPct: 0,
              waveLineWidthPx: 2,
              waveSmoothingPct: 0,
              waveNoiseGatePct: 0,
              waveTemporalSmoothPct: 0,
              ringBaseRadiusPct: 22,
              ringDepthPct: 18,
              orbRadiusPct: 11,
              orbBandCount: 1,
              orbBandSpacingPct: 5,
              barTopShape: 'stepped',
              gradientEnabled: false,
              gradientStart: '#d4af37',
              gradientEnd: '#f7d774',
              gradientMode: 'vertical',
            } as Record<string, any>
            const makeInstance = (patch: Record<string, any>) => ({ ...baseVisualizerInstance, ...patch })
            const instancesJsonFromPresetRow = (row: any): string => {
              const raw = row?.instances_json
              if (typeof raw === 'string' && raw.trim()) {
                try {
                  const parsed = JSON.parse(raw)
                  if (Array.isArray(parsed) && parsed.length) return JSON.stringify(parsed)
                } catch {}
              } else if (Array.isArray(raw) && raw.length) {
                return JSON.stringify(raw)
              }
              return JSON.stringify([
                makeInstance({
                  style: String(row?.style || 'wave_line'),
                  fgColor: String(row?.fg_color || '#d4af37'),
                  opacity: Number.isFinite(Number(row?.opacity)) ? Number(row.opacity) : 1,
                  scale: String(row?.scale || 'linear'),
                  barCount: Number.isFinite(Number(row?.bar_count)) ? Number(row.bar_count) : 48,
                  spectrumMode: String(row?.spectrum_mode || 'full'),
                  gradientEnabled: Number(row?.gradient_enabled) === 1,
                  gradientStart: String(row?.gradient_start || row?.fg_color || '#d4af37'),
                  gradientEnd: String(row?.gradient_end || '#f7d774'),
                  gradientMode: String(row?.gradient_mode || 'vertical'),
                }),
              ])
            }

            const [curatedRows] = await db.query(
              `SELECT id, name, description, bg_color, instances_json, style, fg_color, opacity, scale, bar_count, spectrum_mode, gradient_enabled, gradient_start, gradient_end, gradient_mode
                 FROM visualizer_presets
                WHERE owner_user_id = ?
                  AND archived_at IS NULL
                  AND id IN (${curatedPresetIds.map(() => '?').join(',')})
                ORDER BY FIELD(id, ${curatedPresetIds.join(',')})`,
              [curatedOwnerUserId, ...curatedPresetIds]
            )

            if (Array.isArray(curatedRows) && curatedRows.length === curatedPresetIds.length) {
              const byId = new Map<number, any>((curatedRows as any[]).map((r: any) => [Number(r.id), r]))
              for (let idx = 0; idx < curatedPresetIds.length; idx++) {
                const presetId = curatedPresetIds[idx]
                const row = byId.get(presetId)
                if (!row) continue
                await db.query(
                  `INSERT INTO visualizer_preset_templates (template_key, name, description, bg_color, instances_json)
                   VALUES (?, ?, ?, ?, ?)
                   ON DUPLICATE KEY UPDATE
                     name = VALUES(name),
                     description = VALUES(description),
                     bg_color = VALUES(bg_color),
                     instances_json = VALUES(instances_json),
                     archived_at = NULL`,
                  [
                    starterTemplateKeys[idx],
                    String(row.name || `Starter Preset ${idx + 1}`),
                    row.description == null ? null : String(row.description),
                    String(row.bg_color || 'transparent'),
                    instancesJsonFromPresetRow(row),
                  ]
                )
              }
            } else {
              const starterTemplates: Array<{ key: string; name: string; description: string; bgColor: string; instances: any[] }> = [
                {
                  key: 'starter_01',
                  name: 'Starter: Wave Line Gold',
                  description: 'Clean line waveform with gold gradient.',
                  bgColor: 'transparent',
                  instances: [
                    makeInstance({ style: 'wave_line', waveLineWidthPx: 3, waveSmoothingPct: 18, waveTemporalSmoothPct: 25, gradientEnabled: true }),
                  ],
                },
                {
                  key: 'starter_02',
                  name: 'Starter: Wave Fill Blue',
                  description: 'Filled waveform for stronger visual emphasis.',
                  bgColor: 'transparent',
                  instances: [
                    makeInstance({ style: 'wave_fill', fgColor: '#66ccff', gradientEnabled: true, gradientStart: '#4ecbff', gradientEnd: '#7dd3fc', waveSmoothingPct: 14 }),
                  ],
                },
                {
                  key: 'starter_03',
                  name: 'Starter: Center Voice',
                  description: 'Centered voice-focused waveform.',
                  bgColor: 'transparent',
                  instances: [
                    makeInstance({ style: 'center_wave', spectrumMode: 'voice', bandMode: 'band_3', voiceLowHz: 1000, voiceHighHz: 4000, fgColor: '#f8d34b' }),
                  ],
                },
                {
                  key: 'starter_04',
                  name: 'Starter: Spectrum Bars',
                  description: 'Classic bar spectrum with smooth top.',
                  bgColor: 'transparent',
                  instances: [
                    makeInstance({ style: 'spectrum_bars', barCount: 64, barTopShape: 'smooth_separated', gradientEnabled: true }),
                  ],
                },
                {
                  key: 'starter_05',
                  name: 'Starter: Mirror Bars Teal',
                  description: 'Mirrored bars for symmetric energy.',
                  bgColor: 'transparent',
                  instances: [
                    makeInstance({ style: 'mirror_bars', fgColor: '#2dd4bf', gradientEnabled: true, gradientStart: '#2dd4bf', gradientEnd: '#67e8f9', barCount: 56 }),
                  ],
                },
                {
                  key: 'starter_06',
                  name: 'Starter: Stacked Bands',
                  description: 'Layered multiband stack for richer motion.',
                  bgColor: 'transparent',
                  instances: [
                    makeInstance({ style: 'stacked_bands', fgColor: '#facc15', barCount: 44, bandMode: 'band_1', voiceLowHz: 60, voiceHighHz: 160 }),
                    makeInstance({ id: 'instance_2', style: 'stacked_bands', fgColor: '#38bdf8', barCount: 44, bandMode: 'band_2', voiceLowHz: 400, voiceHighHz: 1200, opacity: 0.85 }),
                    makeInstance({ id: 'instance_3', style: 'stacked_bands', fgColor: '#f472b6', barCount: 44, bandMode: 'band_4', voiceLowHz: 3000, voiceHighHz: 6000, opacity: 0.8 }),
                  ],
                },
                {
                  key: 'starter_07',
                  name: 'Starter: Radial Bars',
                  description: 'Circular bar field for dynamic center focus.',
                  bgColor: 'transparent',
                  instances: [
                    makeInstance({ style: 'radial_bars', barCount: 72, fgColor: '#fb7185', gradientEnabled: true, gradientStart: '#fb7185', gradientEnd: '#f59e0b' }),
                  ],
                },
                {
                  key: 'starter_08',
                  name: 'Starter: Ring Wave',
                  description: 'Circular waveform ring with depth control.',
                  bgColor: 'transparent',
                  instances: [
                    makeInstance({ style: 'ring_wave', ringBaseRadiusPct: 26, ringDepthPct: 20, waveSmoothingPct: 22, waveTemporalSmoothPct: 30, fgColor: '#a78bfa' }),
                  ],
                },
                {
                  key: 'starter_09',
                  name: 'Starter: Pulse Orb',
                  description: 'Compact pulsing orb for ambient motion.',
                  bgColor: 'transparent',
                  instances: [
                    makeInstance({ style: 'pulse_orb', orbRadiusPct: 12, orbBandCount: 3, orbBandSpacingPct: 4, fgColor: '#34d399', gradientEnabled: true, gradientStart: '#34d399', gradientEnd: '#22d3ee' }),
                  ],
                },
              ]
              for (const tpl of starterTemplates) {
                await db.query(
                  `INSERT INTO visualizer_preset_templates (template_key, name, description, bg_color, instances_json)
                   VALUES (?, ?, ?, ?, ?)
                   ON DUPLICATE KEY UPDATE updated_at = updated_at`,
                  [tpl.key, tpl.name, tpl.description, tpl.bgColor, JSON.stringify(tpl.instances)]
                )
              }
            }

            await db.query(
              `UPDATE visualizer_preset_templates
                  SET archived_at = NULL
                WHERE template_key IN (${starterTemplatePlaceholders})`,
              starterTemplateKeys
            )
            await db.query(
              `UPDATE visualizer_preset_templates
                  SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP)
                WHERE template_key LIKE 'starter_%'
                  AND template_key NOT IN (${starterTemplatePlaceholders})`,
              starterTemplateKeys
            )
          } catch {}

	        // --- Lower thirds (feature_10) ---
	        await db.query(`
	          CREATE TABLE IF NOT EXISTS lower_third_templates (
	            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            template_key VARCHAR(80) NOT NULL,
            version INT UNSIGNED NOT NULL,
            label VARCHAR(120) NOT NULL,
            category VARCHAR(64) NULL,
            svg_markup LONGTEXT NOT NULL,
            descriptor_json JSON NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            archived_at TIMESTAMP NULL DEFAULT NULL,
            UNIQUE KEY uniq_lt_tpl_key_version (template_key, version),
            KEY idx_lt_tpl_key_archived (template_key, archived_at, version),
            KEY idx_lt_tpl_archived (archived_at, id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

	        await db.query(`
	          CREATE TABLE IF NOT EXISTS lower_third_configurations (
	            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
	            owner_user_id BIGINT UNSIGNED NOT NULL,
	            name VARCHAR(120) NOT NULL,
	            template_key VARCHAR(80) NOT NULL,
	            template_version INT UNSIGNED NOT NULL,
	            params_json JSON NOT NULL,
	            timing_rule VARCHAR(20) NOT NULL DEFAULT 'first_only',
	            timing_seconds INT UNSIGNED NULL,
	            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	            archived_at TIMESTAMP NULL DEFAULT NULL,
	            KEY idx_lt_cfg_owner_archived (owner_user_id, archived_at, id),
	            KEY idx_lt_cfg_tpl_version_archived (template_key, template_version, archived_at, id),
	            KEY idx_lt_cfg_archived (archived_at, id)
	          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
	        `);

	        // Plan 41: timing controls for lower third presets (first N seconds vs entire).
	        await db.query(`ALTER TABLE lower_third_configurations ADD COLUMN IF NOT EXISTS timing_rule VARCHAR(20) NOT NULL DEFAULT 'first_only'`);
	        await db.query(`ALTER TABLE lower_third_configurations ADD COLUMN IF NOT EXISTS timing_seconds INT UNSIGNED NULL`);
	        try {
	          await db.query(
	            `UPDATE lower_third_configurations
	                SET timing_rule = 'first_only',
	                    timing_seconds = 10
	              WHERE (timing_rule IS NULL OR timing_rule = '' OR timing_rule = 'first_only')
	                AND timing_seconds IS NULL`
	          )
	        } catch {}

        // Seed initial system lower-third template (idempotent).
        // This provides a usable template out-of-the-box; site_admin can add new versions via /admin/lower-thirds.
        try {
          const seedTemplateKey = 'lt_modern_gradient_01'
          const seedVersion = 1
          const seedSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 200" width="1920" height="200">
  <defs>
    <linearGradient id="fadeGrad" x1="0" y1="0" x2="1" y2="0">
      <stop id="accentColor" offset="0" stop-color="#D4AF37" stop-opacity="0.85"/>
      <stop offset="1" stop-color="#D4AF37" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect id="baseBg" x="0" y="0" width="1920" height="200" fill="#0D0F14"/>
  <rect id="gradientOverlay" x="0" y="0" width="1920" height="200" fill="url(#fadeGrad)"/>
  <text id="primaryText" x="96" y="92" fill="#FFFFFF" font-family="system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif" font-size="56" font-weight="700">Episode Title</text>
  <text id="secondaryText" x="96" y="154" fill="#C7CBD6" font-family="system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif" font-size="34" font-weight="500">Creator • Date</text>
</svg>`
          const seedDescriptor = {
            fields: [
              { id: 'primaryText', label: 'Primary text', type: 'text', maxLength: 60 },
              { id: 'secondaryText', label: 'Secondary text', type: 'text', maxLength: 90 },
            ],
            colors: [
              { id: 'baseBg', label: 'Background' },
              { id: 'accentColor', label: 'Fade Color' },
            ],
            defaults: {
              primaryText: 'Episode Title',
              secondaryText: 'Creator • Date',
              baseBg: '#0D0F14',
              accentColor: '#D4AF37',
            },
          }
          await db.query(
            `INSERT INTO lower_third_templates (template_key, version, label, category, svg_markup, descriptor_json)
             SELECT ?, ?, ?, ?, ?, ?
              WHERE NOT EXISTS (
                SELECT 1 FROM lower_third_templates WHERE template_key = ? AND version = ?
              )`,
            [
              seedTemplateKey,
              seedVersion,
              'Modern Gradient',
              'clean',
              seedSvg,
              JSON.stringify(seedDescriptor),
              seedTemplateKey,
              seedVersion,
            ]
          )

          // Keep the seeded template aligned with current authoring guidance.
          try {
            await db.query(
              `UPDATE lower_third_templates
                  SET svg_markup = ?, descriptor_json = ?
                WHERE template_key = ? AND version = ?`,
              [seedSvg, JSON.stringify(seedDescriptor), seedTemplateKey, seedVersion]
            )
          } catch {}

          // Migrate any early "Lower-third-test" presets to the seeded Modern Gradient template
          // (dev-only cleanup; no legacy/back-compat required).
          try {
            const [cfgRows] = await db.query(
              `SELECT id, params_json
                 FROM lower_third_configurations
                WHERE template_key = 'Lower-third-test'
                  AND template_version = 1
                  AND archived_at IS NULL`
            )
            for (const row of cfgRows as any[]) {
              const id = Number(row.id)
              if (!Number.isFinite(id) || id <= 0) continue
              let params: any = row.params_json
              if (typeof params === 'string') {
                try { params = JSON.parse(params) } catch { params = {} }
              }
              if (!params || typeof params !== 'object') params = {}
              const nextParams: any = { ...params }
              if (nextParams.gradientOverlay != null && nextParams.accentColor == null) {
                nextParams.accentColor = nextParams.gradientOverlay
              }
              delete nextParams.gradientOverlay
              await db.query(
                `UPDATE lower_third_configurations
                    SET template_key = ?, template_version = ?, params_json = ?
                  WHERE id = ?`,
                [seedTemplateKey, seedVersion, JSON.stringify(nextParams), id]
              )
            }
            // Archive the old test template once no configs reference it.
            const [leftRows] = await db.query(
              `SELECT COUNT(*) AS c
                 FROM lower_third_configurations
                WHERE template_key = 'Lower-third-test' AND template_version = 1`
            )
            const left = Number((leftRows as any[])[0]?.c || 0)
            if (left === 0) {
              await db.query(
                `UPDATE lower_third_templates
                    SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP)
                  WHERE template_key = 'Lower-third-test' AND version = 1`
              )
            }
          } catch {}
        } catch {}
			
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
	  // Plan 50: production default story (applied to new publications; can be overridden per space)
	  await db.query(`ALTER TABLE productions ADD COLUMN IF NOT EXISTS default_story_text TEXT NULL`);
	  await db.query(`ALTER TABLE productions ADD COLUMN IF NOT EXISTS default_story_updated_at DATETIME NULL`);
		  try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_productions_ulid ON productions (ulid)`); } catch {}
  // Plan 36: allow 'pending_media' status for async ffmpeg mastering jobs.
  try {
    await db.query(
      `ALTER TABLE productions
         MODIFY COLUMN status ENUM('pending_media','pending','queued','processing','completed','failed') NOT NULL DEFAULT 'pending'`
    )
  } catch {}

  // --- Production drafts (Plan 61) ---
  // Persist in-progress /produce + /edit-video selections without URL bloat.
  await db.query(`
    CREATE TABLE IF NOT EXISTS production_drafts (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      upload_id BIGINT UNSIGNED NOT NULL,
      status ENUM('active','archived') NOT NULL DEFAULT 'active',
      config_json JSON NOT NULL,
      rendered_production_id BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      archived_at TIMESTAMP NULL DEFAULT NULL,
      active_key TINYINT GENERATED ALWAYS AS (CASE WHEN archived_at IS NULL THEN 1 ELSE NULL END) STORED,
      UNIQUE KEY uniq_production_drafts_active (user_id, upload_id, active_key),
      KEY idx_production_drafts_user_upload (user_id, upload_id, id),
      KEY idx_production_drafts_upload (upload_id, id),
      KEY idx_production_drafts_status (status, archived_at, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  await db.query(`ALTER TABLE production_drafts ADD COLUMN IF NOT EXISTS status ENUM('active','archived') NOT NULL DEFAULT 'active'`);
  await db.query(`ALTER TABLE production_drafts ADD COLUMN IF NOT EXISTS rendered_production_id BIGINT UNSIGNED NULL`);
  await db.query(`ALTER TABLE production_drafts ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL DEFAULT NULL`);
  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_production_drafts_user_upload ON production_drafts (user_id, upload_id, id)`); } catch {}

	  // --- Create Video projects (Plan 62) ---
	  // Timeline-first composer projects (separate from production drafts).
	  await db.query(`
	    CREATE TABLE IF NOT EXISTS create_video_projects (
	      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
	      user_id BIGINT UNSIGNED NOT NULL,
	      name VARCHAR(255) NULL,
	      description TEXT NULL,
	      status ENUM('active','archived') NOT NULL DEFAULT 'active',
	      timeline_json JSON NOT NULL,
	      last_export_upload_id BIGINT UNSIGNED NULL,
	      last_export_job_id BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	      archived_at TIMESTAMP NULL DEFAULT NULL,
	      active_key TINYINT GENERATED ALWAYS AS (CASE WHEN archived_at IS NULL THEN 1 ELSE NULL END) STORED,
	      KEY idx_create_video_projects_user (user_id, updated_at, id),
	      KEY idx_create_video_projects_status (status, archived_at, id)
	    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
	  `);
	  await db.query(`ALTER TABLE create_video_projects ADD COLUMN IF NOT EXISTS name VARCHAR(255) NULL`);
	  await db.query(`ALTER TABLE create_video_projects ADD COLUMN IF NOT EXISTS description TEXT NULL`);
	  await db.query(`ALTER TABLE create_video_projects ADD COLUMN IF NOT EXISTS status ENUM('active','archived') NOT NULL DEFAULT 'active'`);
	  await db.query(`ALTER TABLE create_video_projects ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL DEFAULT NULL`);
	  await db.query(`ALTER TABLE create_video_projects ADD COLUMN IF NOT EXISTS last_export_upload_id BIGINT UNSIGNED NULL`);
	  await db.query(`ALTER TABLE create_video_projects ADD COLUMN IF NOT EXISTS last_export_job_id BIGINT UNSIGNED NULL`);
	  // Plan 68: allow multiple active projects per user (timeline-first library). Best-effort drop of legacy uniqueness.
	  try { await db.query(`ALTER TABLE create_video_projects DROP INDEX uniq_create_video_projects_active`); } catch {}
	  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_create_video_projects_user ON create_video_projects (user_id, updated_at, id)`); } catch {}

	  // --- Media processing jobs (Plan 36 / feature_08) ---
	  // DB-backed queue; logs/artifacts stored in S3 with pointers in DB.
	  await db.query(`
	    CREATE TABLE IF NOT EXISTS media_jobs (
	      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
	      type VARCHAR(64) NOT NULL,
	      status ENUM('pending','processing','completed','failed','dead') NOT NULL DEFAULT 'pending',
	      progress_pct TINYINT UNSIGNED NULL,
	      progress_stage VARCHAR(64) NULL,
	      progress_message VARCHAR(255) NULL,
	      progress_updated_at TIMESTAMP NULL DEFAULT NULL,
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
	  await db.query(`ALTER TABLE media_jobs ADD COLUMN IF NOT EXISTS progress_pct TINYINT UNSIGNED NULL`);
	  await db.query(`ALTER TABLE media_jobs ADD COLUMN IF NOT EXISTS progress_stage VARCHAR(64) NULL`);
	  await db.query(`ALTER TABLE media_jobs ADD COLUMN IF NOT EXISTS progress_message VARCHAR(255) NULL`);
	  await db.query(`ALTER TABLE media_jobs ADD COLUMN IF NOT EXISTS progress_updated_at TIMESTAMP NULL DEFAULT NULL`);

	  await db.query(`
	    CREATE TABLE IF NOT EXISTS media_job_attempts (
	      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
	      job_id BIGINT UNSIGNED NOT NULL,
	      attempt_no INT NOT NULL,
	      worker_id VARCHAR(128) NULL,
	      started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	      finished_at TIMESTAMP NULL DEFAULT NULL,
	      exit_code INT NULL,
	      queue_wait_ms BIGINT UNSIGNED NULL,
	      duration_ms BIGINT UNSIGNED NULL,
	      input_bytes BIGINT UNSIGNED NULL,
	      output_bytes BIGINT UNSIGNED NULL,
	      error_class VARCHAR(64) NULL,
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
	  await db.query(`ALTER TABLE media_job_attempts ADD COLUMN IF NOT EXISTS queue_wait_ms BIGINT UNSIGNED NULL`);
	  await db.query(`ALTER TABLE media_job_attempts ADD COLUMN IF NOT EXISTS duration_ms BIGINT UNSIGNED NULL`);
	  await db.query(`ALTER TABLE media_job_attempts ADD COLUMN IF NOT EXISTS input_bytes BIGINT UNSIGNED NULL`);
	  await db.query(`ALTER TABLE media_job_attempts ADD COLUMN IF NOT EXISTS output_bytes BIGINT UNSIGNED NULL`);
	  await db.query(`ALTER TABLE media_job_attempts ADD COLUMN IF NOT EXISTS error_class VARCHAR(64) NULL`);
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
      type ENUM('section','document') NOT NULL DEFAULT 'document',
      parent_id BIGINT UNSIGNED NULL,
      sort_order INT NOT NULL DEFAULT 0,
      slug VARCHAR(255) NOT NULL,
      title VARCHAR(255) NOT NULL,
      markdown MEDIUMTEXT NOT NULL,
      html MEDIUMTEXT NOT NULL,
      visibility ENUM('public','authenticated','space_moderator','space_admin') NOT NULL DEFAULT 'public',
      layout VARCHAR(64) NOT NULL DEFAULT 'default',
      parent_scope BIGINT UNSIGNED AS (IFNULL(parent_id, 0)) STORED,
      created_by BIGINT UNSIGNED NULL,
      updated_by BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_pages_parent_slug (parent_scope, slug),
      KEY idx_pages_parent_sort (parent_id, sort_order, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  try { await db.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS type ENUM('section','document') NOT NULL DEFAULT 'document'`); } catch {}
  try { await db.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS parent_id BIGINT UNSIGNED NULL`); } catch {}
  try { await db.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0`); } catch {}
  try { await db.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS parent_scope BIGINT UNSIGNED AS (IFNULL(parent_id, 0)) STORED`); } catch {}
  try { await db.query(`ALTER TABLE pages DROP INDEX uniq_pages_slug`); } catch {}
  try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_pages_parent_slug ON pages (parent_scope, slug)`); } catch {}
  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_pages_parent_sort ON pages (parent_id, sort_order, id)`); } catch {}

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
      definition_json JSON NULL,
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
  await db.query(`ALTER TABLE cultures ADD COLUMN IF NOT EXISTS definition_json JSON NULL`);
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
	  // Optional per-space/per-publication plain-text story (shown on the feed)
	  await db.query(`ALTER TABLE space_publications ADD COLUMN IF NOT EXISTS story_text TEXT NULL`);
	  await db.query(`ALTER TABLE space_publications ADD COLUMN IF NOT EXISTS story_updated_at DATETIME NULL`);
	  // Plan 50: track whether a story is inherited from production default or custom per space
	  await db.query(`ALTER TABLE space_publications ADD COLUMN IF NOT EXISTS story_source VARCHAR(32) NOT NULL DEFAULT 'custom'`);

  // Production captions (VTT) persisted per production (Plan 45)
  await db.query(`
    CREATE TABLE IF NOT EXISTS production_captions (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      production_id BIGINT UNSIGNED NOT NULL,
      provider VARCHAR(32) NOT NULL DEFAULT 'assemblyai',
      transcript_id VARCHAR(128) NULL,
      format VARCHAR(16) NOT NULL DEFAULT 'vtt',
      language VARCHAR(16) NOT NULL DEFAULT 'en',
      s3_bucket VARCHAR(255) NOT NULL,
      s3_key VARCHAR(1024) NOT NULL,
      status ENUM('ready','failed') NOT NULL DEFAULT 'ready',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_production_captions_production (production_id),
      KEY idx_production_captions_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)
  // Plan 88: upload captions (VTT) persisted per upload (system library videos).
  await db.query(`
    CREATE TABLE IF NOT EXISTS upload_captions (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      upload_id BIGINT UNSIGNED NOT NULL,
      provider VARCHAR(32) NOT NULL DEFAULT 'assemblyai',
      transcript_id VARCHAR(128) NULL,
      format VARCHAR(16) NOT NULL DEFAULT 'vtt',
      language VARCHAR(16) NOT NULL DEFAULT 'en',
      s3_bucket VARCHAR(255) NOT NULL,
      s3_key VARCHAR(1024) NOT NULL,
      status ENUM('ready','failed','processing') NOT NULL DEFAULT 'ready',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_upload_captions_upload (upload_id),
      KEY idx_upload_captions_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)
  // Plan 88: library clips (time ranges within system library videos).
  await db.query(`
    CREATE TABLE IF NOT EXISTS library_clips (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      upload_id BIGINT UNSIGNED NOT NULL,
      owner_user_id BIGINT UNSIGNED NOT NULL,
      title VARCHAR(255) NULL,
      description TEXT NULL,
      start_seconds DECIMAL(8,3) NOT NULL,
      end_seconds DECIMAL(8,3) NOT NULL,
      is_system TINYINT(1) NOT NULL DEFAULT 0,
      is_shared TINYINT(1) NOT NULL DEFAULT 0,
      is_favorite TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_library_clips_upload (upload_id, start_seconds, end_seconds),
      KEY idx_library_clips_owner (owner_user_id, created_at, id),
      KEY idx_library_clips_shared (is_shared, id),
      KEY idx_library_clips_system (is_system, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)
  await db.query(`ALTER TABLE library_clips ADD COLUMN IF NOT EXISTS is_favorite TINYINT(1) NOT NULL DEFAULT 0`)
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
      reported_start_seconds INT UNSIGNED NULL,
      reported_end_seconds INT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_space_publication_reports_pub_reporter (space_publication_id, reporter_user_id),
      KEY idx_space_publication_reports_pub_created (space_publication_id, created_at),
      KEY idx_space_publication_reports_space_created (space_id, created_at),
      KEY idx_space_publication_reports_reporter_created (reporter_user_id, created_at),
      KEY idx_space_publication_reports_rule_created (rule_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  // Snapshot fields for user-facing reporting reasons (plan_157A).
  await db.query(`ALTER TABLE space_publication_reports ADD COLUMN IF NOT EXISTS user_facing_rule_id BIGINT UNSIGNED NULL`);
  await db.query(`ALTER TABLE space_publication_reports ADD COLUMN IF NOT EXISTS user_facing_rule_label_at_submit VARCHAR(255) NULL`);
  await db.query(`ALTER TABLE space_publication_reports ADD COLUMN IF NOT EXISTS user_facing_group_key_at_submit VARCHAR(64) NULL`);
  await db.query(`ALTER TABLE space_publication_reports ADD COLUMN IF NOT EXISTS user_facing_group_label_at_submit VARCHAR(128) NULL`);
  await db.query(`ALTER TABLE space_publication_reports ADD COLUMN IF NOT EXISTS reported_start_seconds INT UNSIGNED NULL`);
  await db.query(`ALTER TABLE space_publication_reports ADD COLUMN IF NOT EXISTS reported_end_seconds INT UNSIGNED NULL`);
  // Report triage lifecycle fields (plan_158B)
  await db.query(
    `ALTER TABLE space_publication_reports ADD COLUMN IF NOT EXISTS status ENUM('open','in_review','resolved','dismissed') NOT NULL DEFAULT 'open'`
  );
  await db.query(`ALTER TABLE space_publication_reports ADD COLUMN IF NOT EXISTS assigned_to_user_id BIGINT UNSIGNED NULL`);
  await db.query(`ALTER TABLE space_publication_reports ADD COLUMN IF NOT EXISTS last_action_at DATETIME NULL`);
  await db.query(`ALTER TABLE space_publication_reports ADD COLUMN IF NOT EXISTS resolved_by_user_id BIGINT UNSIGNED NULL`);
  await db.query(`ALTER TABLE space_publication_reports ADD COLUMN IF NOT EXISTS resolved_at DATETIME NULL`);
  await db.query(`ALTER TABLE space_publication_reports ADD COLUMN IF NOT EXISTS resolution_code VARCHAR(64) NULL`);
  await db.query(`ALTER TABLE space_publication_reports ADD COLUMN IF NOT EXISTS resolution_note VARCHAR(500) NULL`);
  await db.query(
    `ALTER TABLE space_publication_reports ADD COLUMN IF NOT EXISTS rule_scope_at_submit ENUM('global','space_culture','unknown') NOT NULL DEFAULT 'unknown'`
  );
  // One-time backfill for pre-plan_158 rows.
  try {
    await db.query(
      `UPDATE space_publication_reports
          SET status = 'open'
        WHERE status IS NULL OR status = ''`
    );
  } catch {}
  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_space_publication_reports_user_facing_rule_created ON space_publication_reports (user_facing_rule_id, created_at)`); } catch {}
  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_space_publication_reports_status_last_action ON space_publication_reports (status, last_action_at, id)`); } catch {}
  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_space_publication_reports_scope_status_created ON space_publication_reports (rule_scope_at_submit, status, created_at, id)`); } catch {}
  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_space_publication_reports_space_status_created ON space_publication_reports (space_id, status, created_at, id)`); } catch {}
  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_space_publication_reports_rule_created_id ON space_publication_reports (rule_id, created_at, id)`); } catch {}
  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_space_publication_reports_pub_reported_range ON space_publication_reports (space_publication_id, reported_start_seconds, reported_end_seconds, id)`); } catch {}

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
      ADD CONSTRAINT fk_space_publication_reports_assigned_to
      FOREIGN KEY (assigned_to_user_id) REFERENCES users(id)
    `);
  } catch {}
  try {
    await db.query(`
      ALTER TABLE space_publication_reports
      ADD CONSTRAINT fk_space_publication_reports_resolved_by
      FOREIGN KEY (resolved_by_user_id) REFERENCES users(id)
    `);
  } catch {}
  try {
    await db.query(`
      ALTER TABLE space_publication_reports
      ADD CONSTRAINT fk_space_publication_reports_rule
      FOREIGN KEY (rule_id) REFERENCES rules(id)
    `);
  } catch {}

  // Immutable report-triage action log (plan_158B)
  await db.query(`
    CREATE TABLE IF NOT EXISTS space_publication_report_actions (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      report_id BIGINT UNSIGNED NOT NULL,
      actor_user_id BIGINT UNSIGNED NOT NULL,
      action_type VARCHAR(64) NOT NULL,
      from_status VARCHAR(32) NULL,
      to_status VARCHAR(32) NULL,
      note VARCHAR(500) NULL,
      detail_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_spra_report_created (report_id, created_at, id),
      KEY idx_spra_actor_created (actor_user_id, created_at, id),
      KEY idx_spra_action_created (action_type, created_at, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  await db.query(`ALTER TABLE space_publication_report_actions ADD COLUMN IF NOT EXISTS report_id BIGINT UNSIGNED NOT NULL`);
  await db.query(`ALTER TABLE space_publication_report_actions ADD COLUMN IF NOT EXISTS actor_user_id BIGINT UNSIGNED NOT NULL`);
  await db.query(`ALTER TABLE space_publication_report_actions ADD COLUMN IF NOT EXISTS action_type VARCHAR(64) NOT NULL`);
  await db.query(`ALTER TABLE space_publication_report_actions ADD COLUMN IF NOT EXISTS from_status VARCHAR(32) NULL`);
  await db.query(`ALTER TABLE space_publication_report_actions ADD COLUMN IF NOT EXISTS to_status VARCHAR(32) NULL`);
  await db.query(`ALTER TABLE space_publication_report_actions ADD COLUMN IF NOT EXISTS note VARCHAR(500) NULL`);
  await db.query(`ALTER TABLE space_publication_report_actions ADD COLUMN IF NOT EXISTS detail_json JSON NULL`);
  await db.query(`ALTER TABLE space_publication_report_actions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await db.query(`ALTER TABLE space_publication_report_actions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`);
  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_spra_report_created ON space_publication_report_actions (report_id, created_at, id)`); } catch {}
  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_spra_actor_created ON space_publication_report_actions (actor_user_id, created_at, id)`); } catch {}
  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_spra_action_created ON space_publication_report_actions (action_type, created_at, id)`); } catch {}
  try {
    await db.query(`
      ALTER TABLE space_publication_report_actions
      ADD CONSTRAINT fk_spra_report
      FOREIGN KEY (report_id) REFERENCES space_publication_reports(id)
    `);
  } catch {}
  try {
    await db.query(`
      ALTER TABLE space_publication_report_actions
      ADD CONSTRAINT fk_spra_actor
      FOREIGN KEY (actor_user_id) REFERENCES users(id)
    `);
  } catch {}
  try {
    await db.query(`
      ALTER TABLE space_publication_reports
      ADD CONSTRAINT fk_space_publication_reports_rule_version
      FOREIGN KEY (rule_version_id) REFERENCES rule_versions(id)
    `);
  } catch {}
  // User-facing reporting layer (plan_157A).
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_facing_rules (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      label VARCHAR(255) NOT NULL,
      short_description VARCHAR(500) NULL,
      group_key VARCHAR(64) NULL,
      group_label VARCHAR(128) NULL,
      group_order INT NOT NULL DEFAULT 0,
      display_order INT NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_user_facing_rules_active_group_display (is_active, group_order, display_order, id),
      KEY idx_user_facing_rules_group (group_key, group_order, display_order, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)
  await db.query(`ALTER TABLE user_facing_rules ADD COLUMN IF NOT EXISTS label VARCHAR(255) NOT NULL`)
  await db.query(`ALTER TABLE user_facing_rules ADD COLUMN IF NOT EXISTS short_description VARCHAR(500) NULL`)
  await db.query(`ALTER TABLE user_facing_rules ADD COLUMN IF NOT EXISTS group_key VARCHAR(64) NULL`)
  await db.query(`ALTER TABLE user_facing_rules ADD COLUMN IF NOT EXISTS group_label VARCHAR(128) NULL`)
  await db.query(`ALTER TABLE user_facing_rules ADD COLUMN IF NOT EXISTS group_order INT NOT NULL DEFAULT 0`)
  await db.query(`ALTER TABLE user_facing_rules ADD COLUMN IF NOT EXISTS display_order INT NOT NULL DEFAULT 0`)
  await db.query(`ALTER TABLE user_facing_rules ADD COLUMN IF NOT EXISTS is_active TINYINT(1) NOT NULL DEFAULT 1`)
  await db.query(`ALTER TABLE user_facing_rules ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`)
  await db.query(`ALTER TABLE user_facing_rules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`)
  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_user_facing_rules_active_group_display ON user_facing_rules (is_active, group_order, display_order, id)`); } catch {}
  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_user_facing_rules_group ON user_facing_rules (group_key, group_order, display_order, id)`); } catch {}

  await db.query(`
    CREATE TABLE IF NOT EXISTS user_facing_rule_rule_map (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_facing_rule_id BIGINT UNSIGNED NOT NULL,
      rule_id BIGINT UNSIGNED NOT NULL,
      priority INT NOT NULL DEFAULT 100,
      is_default TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_facing_rule_rule_map (user_facing_rule_id, rule_id),
      KEY idx_user_facing_rule_rule_map_rule (rule_id, user_facing_rule_id),
      KEY idx_user_facing_rule_rule_map_resolver (user_facing_rule_id, is_default, priority, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)
  await db.query(`ALTER TABLE user_facing_rule_rule_map ADD COLUMN IF NOT EXISTS user_facing_rule_id BIGINT UNSIGNED NOT NULL`)
  await db.query(`ALTER TABLE user_facing_rule_rule_map ADD COLUMN IF NOT EXISTS rule_id BIGINT UNSIGNED NOT NULL`)
  await db.query(`ALTER TABLE user_facing_rule_rule_map ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 100`)
  await db.query(`ALTER TABLE user_facing_rule_rule_map ADD COLUMN IF NOT EXISTS is_default TINYINT(1) NOT NULL DEFAULT 0`)
  await db.query(`ALTER TABLE user_facing_rule_rule_map ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`)
  await db.query(`ALTER TABLE user_facing_rule_rule_map ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`)
  try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_facing_rule_rule_map ON user_facing_rule_rule_map (user_facing_rule_id, rule_id)`); } catch {}
  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_user_facing_rule_rule_map_rule ON user_facing_rule_rule_map (rule_id, user_facing_rule_id)`); } catch {}
  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_user_facing_rule_rule_map_resolver ON user_facing_rule_rule_map (user_facing_rule_id, is_default, priority, id)`); } catch {}
  try {
    await db.query(`
      ALTER TABLE user_facing_rule_rule_map
      ADD CONSTRAINT fk_user_facing_rule_rule_map_user_facing_rule
      FOREIGN KEY (user_facing_rule_id) REFERENCES user_facing_rules(id)
    `);
  } catch {}
  try {
    await db.query(`
      ALTER TABLE user_facing_rule_rule_map
      ADD CONSTRAINT fk_user_facing_rule_rule_map_rule
      FOREIGN KEY (rule_id) REFERENCES rules(id)
    `);
  } catch {}
  try {
    await db.query(`
      ALTER TABLE space_publication_reports
      ADD CONSTRAINT fk_space_publication_reports_user_facing_rule
      FOREIGN KEY (user_facing_rule_id) REFERENCES user_facing_rules(id)
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
  default_story_text?: string | null;
  default_story_updated_at?: string | null;
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
