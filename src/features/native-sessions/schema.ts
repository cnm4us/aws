import type { DB } from '../../db';

export async function ensureNativeSessionSchema(db: Pick<DB, 'query'>) {
  await db.query(`CREATE TABLE IF NOT EXISTS native_sessions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    token_hash BINARY(32) NOT NULL,
    credential_hash BINARY(32) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    revoked_at DATETIME NULL,
    UNIQUE KEY uq_native_sessions_token_hash (token_hash),
    KEY idx_native_sessions_user (user_id, revoked_at, expires_at),
    KEY idx_native_sessions_expiry (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.query(`CREATE TABLE IF NOT EXISTS native_login_limits (
    key_hash BINARY(32) NOT NULL PRIMARY KEY,
    attempts INT UNSIGNED NOT NULL,
    resets_at DATETIME NOT NULL,
    KEY idx_native_login_limits_expiry (resets_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}
