import 'dotenv/config'
import { getPool } from '../src/db'

type LegacyRow = {
  id: number
  intent_key: string
  executor_type: string
  config_json: any
}

function parseJsonObject(value: any): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, any>
    } catch {}
  }
  return {}
}

function normalizePath(raw: any): string | null {
  const v = String(raw || '').trim()
  if (!v) return null
  if (!v.startsWith('/')) return null
  if (v.startsWith('//')) return null
  if (/\s/.test(v)) return null
  return v
}

function buildReplacement(row: LegacyRow): { executorType: 'internal_link'; config: { href: string; successReturn?: string | null; openInNewTab: false } } {
  const intent = String(row.intent_key || '').trim().toLowerCase()
  const cfg = parseJsonObject(row.config_json)
  if (row.executor_type === 'verification_flow') {
    const href = normalizePath(cfg.startPath) || '/verification'
    const successReturn = normalizePath(cfg.successReturn)
    return {
      executorType: 'internal_link',
      config: {
        href,
        ...(successReturn ? { successReturn } : {}),
        openInNewTab: false,
      },
    }
  }

  const mode = String(cfg.mode || '').trim().toLowerCase()
  const flow = (mode === 'donate' || mode === 'subscribe' || mode === 'upgrade')
    ? mode
    : ((intent === 'donate' || intent === 'subscribe' || intent === 'upgrade') ? intent : '')
  const href = flow ? `/support?intent=${encodeURIComponent(flow)}` : '/support'
  const successReturn = normalizePath(cfg.returnUrl)
  return {
    executorType: 'internal_link',
    config: {
      href,
      ...(successReturn ? { successReturn } : {}),
      openInNewTab: false,
    },
  }
}

async function main() {
  const apply = process.argv.includes('--apply')
  const db = getPool()
  try {
    const [rows] = await db.query(
      `SELECT id, intent_key, executor_type, config_json
         FROM feed_message_cta_definitions
        WHERE executor_type IN ('provider_checkout', 'verification_flow')
        ORDER BY id ASC`
    )
    const list = rows as LegacyRow[]
    if (!list.length) {
      console.log('No legacy CTA executors found.')
      return
    }

    console.log(`Found ${list.length} legacy CTA definition(s).`)
    for (const row of list) {
      const next = buildReplacement(row)
      console.log(`#${row.id} ${row.executor_type} -> ${next.executorType} href=${next.config.href}`)
      if (!apply) continue
      await db.query(
        `UPDATE feed_message_cta_definitions
            SET executor_type = ?,
                config_json = ?,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [next.executorType, JSON.stringify(next.config), Number(row.id)]
      )
    }

    if (apply) {
      console.log('Migration applied.')
    } else {
      console.log('Dry run only. Re-run with --apply to persist changes.')
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('message-ctas:migrate-executors failed', err)
  process.exit(1)
})

