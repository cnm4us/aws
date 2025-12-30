import 'dotenv/config';
import { getPool } from '../src/db';

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

  console.log('--- uploads migrate: add kind column (video/logo/audio) ---');
  await exec(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS kind VARCHAR(16) NOT NULL DEFAULT 'video'`);

  console.log('--- uploads migrate: add index for kind filtering ---');
  // MySQL does not universally support IF NOT EXISTS for indexes; check information_schema for idempotency.
  const [idxRows] = await exec(
    `SELECT 1
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'uploads'
        AND index_name = 'idx_uploads_kind_created_at'
      LIMIT 1`
  );
  const hasIndex = Array.isArray(idxRows) && (idxRows as any[]).length > 0;
  if (!hasIndex) {
    await exec(`CREATE INDEX idx_uploads_kind_created_at ON uploads (kind, created_at)`);
  } else {
    console.log('Index idx_uploads_kind_created_at already exists; skipping.');
  }

  console.log('Uploads kind migration complete.', dry ? '(dry run)' : '');
  if (!dry) process.exit(0);
}

main().catch((err) => {
  console.error('Uploads kind migration failed', err);
  process.exit(1);
});

