import 'dotenv/config'
import { getPool, ensureSchema } from '../src/db'

async function main() {
  const db = getPool()
  await ensureSchema(db as any)

  const [res] = await db.query(
    `INSERT IGNORE INTO rule_drafts (
       rule_id,
       markdown, html,
       short_description,
       allowed_examples_markdown, allowed_examples_html,
       disallowed_examples_markdown, disallowed_examples_html,
       guidance_markdown, guidance_html,
       guidance_moderators_markdown, guidance_moderators_html,
       guidance_agents_markdown, guidance_agents_html,
       updated_by
     )
     SELECT r.id,
            COALESCE(rv.markdown, ''), COALESCE(rv.html, ''),
            rv.short_description,
            rv.allowed_examples_markdown, rv.allowed_examples_html,
            rv.disallowed_examples_markdown, rv.disallowed_examples_html,
            COALESCE(rv.guidance_markdown, rv.guidance_moderators_markdown), COALESCE(rv.guidance_html, rv.guidance_moderators_html),
            COALESCE(rv.guidance_moderators_markdown, rv.guidance_markdown), COALESCE(rv.guidance_moderators_html, rv.guidance_html),
            rv.guidance_agents_markdown, rv.guidance_agents_html,
            NULL
       FROM rules r
       JOIN rule_versions rv ON rv.id = r.current_version_id
       LEFT JOIN rule_drafts d ON d.rule_id = r.id
      WHERE d.rule_id IS NULL`
  )

  const affected = Number((res as any)?.affectedRows ?? 0)
  console.log(`Done. Inserted ${affected} missing rule_drafts rows.`)
  await db.end()
}

main().catch(async (err) => {
  console.error(err)
  try { await getPool().end() } catch {}
  process.exit(1)
})
