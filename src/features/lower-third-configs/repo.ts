import { getPool } from '../../db'
import type { LowerThirdConfigurationRow } from './types'

export async function listForUser(userId: number, opts: { includeArchived?: boolean; limit?: number } = {}) {
  const includeArchived = Boolean(opts.includeArchived)
  const limit = opts.limit != null && Number.isFinite(opts.limit) ? Math.max(1, Math.min(500, Math.round(opts.limit))) : 200
  const db = getPool()
  const where = includeArchived ? '' : 'AND archived_at IS NULL'
  const [rows] = await db.query(
    `
      SELECT *
        FROM lower_third_image_configurations
       WHERE owner_user_id = ?
         ${where}
       ORDER BY id DESC
       LIMIT ?
    `,
    [userId, limit]
  )
  return rows as LowerThirdConfigurationRow[]
}

export async function getById(id: number): Promise<LowerThirdConfigurationRow | null> {
  const db = getPool()
  const [rows] = await db.query(`SELECT * FROM lower_third_image_configurations WHERE id = ? LIMIT 1`, [id])
  return (rows as any[])[0] || null
}

export async function insert(row: {
  ownerUserId: number
  name: string
  sizeMode: string
  baselineWidth: number
  position: string
  sizePctWidth: number
  opacityPct: number
  timingRule: string
  timingSeconds: number | null
  fade: string
  insetXPreset: string | null
  insetYPreset: string | null
}): Promise<number> {
  const db = getPool()
  const [res] = await db.query(
    `
      INSERT INTO lower_third_image_configurations
        (owner_user_id, name, size_mode, baseline_width, position, size_pct_width, opacity_pct, timing_rule, timing_seconds, fade, inset_x_preset, inset_y_preset)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      row.ownerUserId,
      row.name,
      row.sizeMode,
      row.baselineWidth,
      row.position,
      row.sizePctWidth,
      row.opacityPct,
      row.timingRule,
      row.timingSeconds,
      row.fade,
      row.insetXPreset,
      row.insetYPreset,
    ]
  )
  return Number((res as any).insertId)
}

export async function update(
  id: number,
  row: {
    name: string
    sizeMode: string
    baselineWidth: number
    position: string
    sizePctWidth: number
    opacityPct: number
    timingRule: string
    timingSeconds: number | null
    fade: string
    insetXPreset: string | null
    insetYPreset: string | null
  }
) {
  const db = getPool()
  await db.query(
    `
      UPDATE lower_third_image_configurations
         SET name = ?,
             size_mode = ?,
             baseline_width = ?,
             position = ?,
             size_pct_width = ?,
             opacity_pct = ?,
             timing_rule = ?,
             timing_seconds = ?,
             fade = ?,
             inset_x_preset = ?,
             inset_y_preset = ?
       WHERE id = ?
       LIMIT 1
    `,
    [
      row.name,
      row.sizeMode,
      row.baselineWidth,
      row.position,
      row.sizePctWidth,
      row.opacityPct,
      row.timingRule,
      row.timingSeconds,
      row.fade,
      row.insetXPreset,
      row.insetYPreset,
      id,
    ]
  )
}

export async function archive(id: number) {
  const db = getPool()
  await db.query(`UPDATE lower_third_image_configurations SET archived_at = NOW() WHERE id = ? LIMIT 1`, [id])
}
