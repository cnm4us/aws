import { getPool } from '../../db'
import type { LogoConfigRow } from './types'

export async function listByOwner(ownerUserId: number, params?: { includeArchived?: boolean; limit?: number }): Promise<LogoConfigRow[]> {
  const db = getPool()
  const includeArchived = Boolean(params?.includeArchived)
  const limit = Math.min(Math.max(Number(params?.limit ?? 200), 1), 500)
  const where = includeArchived ? '' : 'AND archived_at IS NULL'
  const [rows] = await db.query(
    `SELECT *
       FROM logo_configurations
      WHERE owner_user_id = ?
        ${where}
      ORDER BY id DESC
      LIMIT ?`,
    [ownerUserId, limit]
  )
  return rows as any[]
}

export async function getById(id: number): Promise<LogoConfigRow | null> {
  const db = getPool()
  const [rows] = await db.query(`SELECT * FROM logo_configurations WHERE id = ? LIMIT 1`, [id])
  const row = (rows as any[])[0]
  return row || null
}

export async function create(input: {
  ownerUserId: number
  name: string
  position: string
  sizePctWidth: number
  opacityPct: number
  timingRule: string
  timingSeconds: number | null
  fade: string
}): Promise<LogoConfigRow> {
  const db = getPool()
  const [result] = await db.query(
    `INSERT INTO logo_configurations
      (owner_user_id, name, position, size_pct_width, opacity_pct, timing_rule, timing_seconds, fade)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.ownerUserId,
      input.name,
      input.position,
      input.sizePctWidth,
      input.opacityPct,
      input.timingRule,
      input.timingSeconds,
      input.fade,
    ]
  )
  const id = Number((result as any).insertId)
  const row = await getById(id)
  if (!row) throw new Error('failed_to_create_logo_config')
  return row
}

export async function update(id: number, patch: {
  name?: string
  position?: string
  sizePctWidth?: number
  opacityPct?: number
  timingRule?: string
  timingSeconds?: number | null
  fade?: string
}): Promise<LogoConfigRow> {
  const db = getPool()
  const sets: string[] = []
  const args: any[] = []
  if (patch.name !== undefined) { sets.push('name = ?'); args.push(patch.name) }
  if (patch.position !== undefined) { sets.push('position = ?'); args.push(patch.position) }
  if (patch.sizePctWidth !== undefined) { sets.push('size_pct_width = ?'); args.push(patch.sizePctWidth) }
  if (patch.opacityPct !== undefined) { sets.push('opacity_pct = ?'); args.push(patch.opacityPct) }
  if (patch.timingRule !== undefined) { sets.push('timing_rule = ?'); args.push(patch.timingRule) }
  if (patch.timingSeconds !== undefined) { sets.push('timing_seconds = ?'); args.push(patch.timingSeconds) }
  if (patch.fade !== undefined) { sets.push('fade = ?'); args.push(patch.fade) }
  if (!sets.length) {
    const row = await getById(id)
    if (!row) throw new Error('not_found')
    return row
  }
  await db.query(`UPDATE logo_configurations SET ${sets.join(', ')} WHERE id = ?`, [...args, id])
  const row = await getById(id)
  if (!row) throw new Error('not_found')
  return row
}

export async function archive(id: number): Promise<void> {
  const db = getPool()
  await db.query(`UPDATE logo_configurations SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP) WHERE id = ?`, [id])
}

export async function ensureDefaultForOwner(ownerUserId: number): Promise<{ created: boolean }> {
  const db = getPool()
  const [result] = await db.query(
    `INSERT INTO logo_configurations (owner_user_id, name, position, size_pct_width, opacity_pct, timing_rule, timing_seconds, fade)
     SELECT ?, 'Standard watermark', 'bottom_right', 15, 35, 'entire', NULL, 'none'
      WHERE NOT EXISTS (
        SELECT 1 FROM logo_configurations WHERE owner_user_id = ? AND archived_at IS NULL LIMIT 1
      )`,
    [ownerUserId, ownerUserId]
  )
  const affected = Number((result as any)?.affectedRows || 0)
  return { created: affected > 0 }
}
