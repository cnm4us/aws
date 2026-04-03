import 'dotenv/config'
import { getPool } from '../src/db'

async function main() {
  const db = getPool()
  try {
    await db.query('DELETE FROM pages')
    await db.query(
      `INSERT INTO pages (type, parent_id, sort_order, slug, title, markdown, html, visibility, layout, created_by, updated_by)
       VALUES
       ('document', NULL, 0, 'home', 'Home', '# Home\\n\\nWelcome.', '<h1>Home</h1><p>Welcome.</p>', 'public', 'default', NULL, NULL),
       ('document', NULL, 10, 'docs', 'Docs', '# Docs\\n\\nStart here.', '<h1>Docs</h1><p>Start here.</p>', 'public', 'default', NULL, NULL)`
    )
    console.log('Reset pages hierarchy: inserted root documents [home, docs]')
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('db:reset:pages failed', err)
  process.exit(1)
})

