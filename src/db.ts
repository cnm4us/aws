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
  created_at: string;
  uploaded_at: string | null;
};
