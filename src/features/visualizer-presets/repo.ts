import { getPool } from '../../db'
import type { VisualizerPresetRow } from './types'

export async function listByOwner(ownerUserId: number, params?: { includeArchived?: boolean; limit?: number }): Promise<VisualizerPresetRow[]> {
  const db = getPool()
  const includeArchived = Boolean(params?.includeArchived)
  const limit = Math.min(Math.max(Number(params?.limit ?? 200), 1), 500)
  const where = includeArchived ? '' : 'AND archived_at IS NULL'
  const [rows] = await db.query(
    `SELECT *
       FROM visualizer_presets
      WHERE owner_user_id = ?
        ${where}
      ORDER BY id DESC
      LIMIT ?`,
    [ownerUserId, limit]
  )
  return rows as any[]
}

export async function getById(id: number): Promise<VisualizerPresetRow | null> {
  const db = getPool()
  const [rows] = await db.query(`SELECT * FROM visualizer_presets WHERE id = ? LIMIT 1`, [id])
  const row = (rows as any[])[0]
  return row || null
}

export async function create(input: {
  ownerUserId: number
  name: string
  description?: string | null
  style: string
  fgColor: string
  bgColor: string | 'transparent'
  opacity: number
  scale: string
  gradientEnabled: boolean
  gradientStart: string
  gradientEnd: string
  gradientMode: string
  clipMode: string
  clipInsetPct: number
  clipHeightPct: number
}): Promise<VisualizerPresetRow> {
  const db = getPool()
  const [result] = await db.query(
    `INSERT INTO visualizer_presets
      (owner_user_id, name, description, style, fg_color, bg_color, opacity, scale, gradient_enabled, gradient_start, gradient_end, gradient_mode, clip_mode, clip_inset_pct, clip_height_pct)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.ownerUserId,
      input.name,
      input.description ?? null,
      input.style,
      input.fgColor,
      input.bgColor,
      input.opacity,
      input.scale,
      input.gradientEnabled ? 1 : 0,
      input.gradientStart,
      input.gradientEnd,
      input.gradientMode,
      input.clipMode,
      input.clipInsetPct,
      input.clipHeightPct,
    ]
  )
  const id = Number((result as any).insertId)
  const row = await getById(id)
  if (!row) throw new Error('failed_to_create_visualizer_preset')
  return row
}

export async function update(id: number, patch: {
  name?: string
  description?: string | null
  style?: string
  fgColor?: string
  bgColor?: string | 'transparent'
  opacity?: number
  scale?: string
  gradientEnabled?: boolean
  gradientStart?: string
  gradientEnd?: string
  gradientMode?: string
  clipMode?: string
  clipInsetPct?: number
  clipHeightPct?: number
}): Promise<VisualizerPresetRow> {
  const db = getPool()
  const sets: string[] = []
  const args: any[] = []
  if (patch.name !== undefined) { sets.push('name = ?'); args.push(patch.name) }
  if (patch.description !== undefined) { sets.push('description = ?'); args.push(patch.description) }
  if (patch.style !== undefined) { sets.push('style = ?'); args.push(patch.style) }
  if (patch.fgColor !== undefined) { sets.push('fg_color = ?'); args.push(patch.fgColor) }
  if (patch.bgColor !== undefined) { sets.push('bg_color = ?'); args.push(patch.bgColor) }
  if (patch.opacity !== undefined) { sets.push('opacity = ?'); args.push(patch.opacity) }
  if (patch.scale !== undefined) { sets.push('scale = ?'); args.push(patch.scale) }
  if (patch.gradientEnabled !== undefined) { sets.push('gradient_enabled = ?'); args.push(patch.gradientEnabled ? 1 : 0) }
  if (patch.gradientStart !== undefined) { sets.push('gradient_start = ?'); args.push(patch.gradientStart) }
  if (patch.gradientEnd !== undefined) { sets.push('gradient_end = ?'); args.push(patch.gradientEnd) }
  if (patch.gradientMode !== undefined) { sets.push('gradient_mode = ?'); args.push(patch.gradientMode) }
  if (patch.clipMode !== undefined) { sets.push('clip_mode = ?'); args.push(patch.clipMode) }
  if (patch.clipInsetPct !== undefined) { sets.push('clip_inset_pct = ?'); args.push(patch.clipInsetPct) }
  if (patch.clipHeightPct !== undefined) { sets.push('clip_height_pct = ?'); args.push(patch.clipHeightPct) }
  if (!sets.length) {
    const row = await getById(id)
    if (!row) throw new Error('not_found')
    return row
  }
  await db.query(`UPDATE visualizer_presets SET ${sets.join(', ')} WHERE id = ?`, [...args, id])
  const row = await getById(id)
  if (!row) throw new Error('not_found')
  return row
}

export async function archive(id: number): Promise<void> {
  const db = getPool()
  await db.query(`UPDATE visualizer_presets SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP) WHERE id = ?`, [id])
}
