import 'dotenv/config';
import { getPool } from '../../src/db';

async function main() {
  const db = getPool();
  const really = process.argv.includes('--yes');
  if (!really) {
    console.log('Dry-run. Use --yes to actually truncate dev tables.');
  }
  const exec = async (sql: string) => {
    if (!really) { console.log('[DRY] SQL:', sql); return; }
    await db.query(sql);
  };

  // Order matters due to FKs (if present). Using simple deletes for idempotence.
  const tables = [
    'space_publication_events',
    'space_publications',
    'productions',
    'uploads',
    'action_log',
  ];
  for (const t of tables) {
    await exec(`DELETE FROM ${t}`);
  }
  console.log('Truncate-dev completed', really ? '' : '(dry run)');
}

main().catch((err) => {
  console.error('truncate-dev failed', err);
  process.exit(1);
});

