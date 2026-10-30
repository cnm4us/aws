import { randomBytes } from 'node:crypto';
import type { Queryable } from '../../db';

/** Additive only. Existing relationship, culture and publication tables are untouched. */
export async function ensureDiscoverySchema(db: Queryable) {
  const tables = [
    `viewer_feed_checkpoints (user_id BIGINT UNSIGNED NOT NULL, feed_kind ENUM('following','creations') NOT NULL,
      revision BIGINT UNSIGNED NOT NULL DEFAULT 1,publication_id BIGINT UNSIGNED NOT NULL,production_ulid CHAR(26) NOT NULL,
      space_id BIGINT UNSIGNED NOT NULL,position_seconds DOUBLE NOT NULL DEFAULT 0,user_paused TINYINT NOT NULL DEFAULT 0,
      visited_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),PRIMARY KEY(user_id,feed_kind))`,
    `discovery_state (id TINYINT UNSIGNED PRIMARY KEY, root_home TINYINT NOT NULL DEFAULT 0,
      native_home TINYINT NOT NULL DEFAULT 0, receipt_secret BINARY(32) NOT NULL)`,
    `discovery_genres (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, slug VARCHAR(80) NOT NULL UNIQUE,
      name VARCHAR(100) NOT NULL, sort_order INT NOT NULL DEFAULT 0, published TINYINT NOT NULL DEFAULT 1)`,
    `discovery_spaces (space_id BIGINT UNSIGNED PRIMARY KEY, listed TINYINT NOT NULL DEFAULT 0,
      artwork_url VARCHAR(1024) NULL, draft TEXT NULL, welcome TEXT NULL, entry_enabled TINYINT NOT NULL DEFAULT 0,
      updated_by BIGINT UNSIGNED NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`,
    `discovery_placements (genre_id BIGINT UNSIGNED NOT NULL, space_id BIGINT UNSIGNED NOT NULL,
      sort_order INT NOT NULL DEFAULT 0, PRIMARY KEY (genre_id, space_id), KEY idx_discovery_space (space_id, genre_id))`,
    `viewer_saved_spaces (user_id BIGINT UNSIGNED NOT NULL, space_id BIGINT UNSIGNED NOT NULL,
      removed TINYINT NOT NULL DEFAULT 0, origin ENUM('legacy','explicit') NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, space_id))`,
    `viewer_discovery_migrations (user_id BIGINT UNSIGNED PRIMARY KEY, completed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `space_entry_documents (space_id BIGINT UNSIGNED NOT NULL, revision CHAR(64) NOT NULL,
      manifest JSON NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (space_id, revision))`,
    `viewer_space_acknowledgments (user_id BIGINT UNSIGNED NOT NULL, space_id BIGINT UNSIGNED NOT NULL,
      revision CHAR(64) NOT NULL, manifest JSON NOT NULL, accepted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, space_id))`,
    `viewer_recent_spaces (user_id BIGINT UNSIGNED NOT NULL, space_id BIGINT UNSIGNED NOT NULL,
      revision BIGINT UNSIGNED NOT NULL DEFAULT 1, publication_id BIGINT UNSIGNED NULL,
      production_ulid CHAR(26) NULL, position_seconds DOUBLE NOT NULL DEFAULT 0, user_paused TINYINT NOT NULL DEFAULT 0,
      visited_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (user_id, space_id), KEY idx_viewer_recent (user_id, visited_at, space_id))`,
  ];
  for (const definition of tables) await db.query(`CREATE TABLE IF NOT EXISTS ${definition} ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  const [menuColumns]:any=await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='discovery_state' AND COLUMN_NAME='native_destinations'");
  if(!menuColumns.length)try{await db.query('ALTER TABLE discovery_state ADD COLUMN native_destinations TINYINT NOT NULL DEFAULT 0');}catch(error){if((error as {code?:string}).code!=='ER_DUP_FIELDNAME')throw error;}
  const [catalogColumn]:any=await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='discovery_state' AND COLUMN_NAME='native_catalog'");
  if(!catalogColumn.length)try{await db.query('ALTER TABLE discovery_state ADD COLUMN native_catalog TINYINT NOT NULL DEFAULT 0');}catch(e){if((e as any).code!=='ER_DUP_FIELDNAME')throw e;}
  const [savedType]:any=await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='viewer_saved_spaces' AND COLUMN_NAME='space_type'");
  if(!savedType.length){try{await db.query("ALTER TABLE viewer_saved_spaces ADD COLUMN space_type ENUM('group','channel') NULL");}catch(e){if((e as any).code!=='ER_DUP_FIELDNAME')throw e;}await db.query("UPDATE viewer_saved_spaces v JOIN spaces s ON s.id=v.space_id SET v.space_type=s.type,v.updated_at=v.updated_at WHERE v.space_type IS NULL AND s.type IN ('group','channel')");}
  const [precision]:any=await db.query("SELECT DATETIME_PRECISION AS value FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='viewer_recent_spaces' AND COLUMN_NAME='visited_at'");
  if(Number(precision[0]?.value)!==3)await db.query('ALTER TABLE viewer_recent_spaces MODIFY visited_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)');
  await db.query('INSERT IGNORE INTO discovery_state (id,receipt_secret) VALUES (1,?)', [randomBytes(32)]);
  for (const [index, name] of ['Travel','Cooking','Technology','Arts'].entries())
    await db.query('INSERT IGNORE INTO discovery_genres (slug,name,sort_order) VALUES (?,?,?)', [name.toLowerCase(),name,index]);
}
