import 'dotenv/config'
import { getPool } from '../src/db'

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw == null || String(raw).trim() === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? Math.round(n) : fallback
}

async function main() {
  const db = getPool()

  const globalSpaceId = envInt('MESSAGE_AUDIENCE_GLOBAL_SPACE_ID', 29)
  const nonSubscriberUserId = envInt('MESSAGE_AUDIENCE_NON_SUB_USER_ID', 7)
  const subscriberUserId = envInt('MESSAGE_AUDIENCE_SUB_USER_ID', 8)

  if (globalSpaceId <= 0 || nonSubscriberUserId <= 0 || subscriberUserId <= 0) {
    throw new Error('invalid_seed_ids')
  }

  const [spaceRows] = await db.query(`SELECT id, slug FROM spaces WHERE id = ? LIMIT 1`, [globalSpaceId])
  if (!Array.isArray(spaceRows) || (spaceRows as any[]).length === 0) {
    throw new Error(`global_space_not_found:${globalSpaceId}`)
  }

  const [userRows] = await db.query(
    `SELECT id FROM users WHERE id IN (?, ?) ORDER BY id ASC`,
    [nonSubscriberUserId, subscriberUserId]
  )
  const found = new Set((userRows as any[]).map((r: any) => Number(r.id)))
  if (!found.has(nonSubscriberUserId)) throw new Error(`non_subscriber_user_not_found:${nonSubscriberUserId}`)
  if (!found.has(subscriberUserId)) throw new Error(`subscriber_user_not_found:${subscriberUserId}`)

  await db.query(
    `DELETE FROM space_subscriptions
      WHERE user_id = ? AND space_id = ?`,
    [nonSubscriberUserId, globalSpaceId]
  )

  await db.query(
    `INSERT INTO space_subscriptions
      (user_id, space_id, tier, status, started_at, ended_at)
     VALUES (?, ?, 'test', 'active', NOW(), NULL)
     ON DUPLICATE KEY UPDATE
       tier = VALUES(tier),
       status = 'active',
       started_at = NOW(),
       ended_at = NULL`,
    [subscriberUserId, globalSpaceId]
  )

  const [rows] = await db.query(
    `SELECT user_id, space_id, tier, status, started_at, ended_at
       FROM space_subscriptions
      WHERE space_id = ? AND user_id IN (?, ?)
      ORDER BY user_id ASC`,
    [globalSpaceId, nonSubscriberUserId, subscriberUserId]
  )

  console.log(
    JSON.stringify(
      {
        ok: true,
        globalSpaceId,
        nonSubscriberUserId,
        subscriberUserId,
        rows,
      },
      null,
      2
    )
  )

  await db.end()
}

main().catch(async (err) => {
  console.error(err)
  try { await getPool().end() } catch {}
  process.exit(1)
})
