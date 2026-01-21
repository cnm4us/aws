import { getPool } from '../../db'
import type { ScreenTitlePresetRow } from './types'

export async function listByOwner(ownerUserId: number, params?: { includeArchived?: boolean; limit?: number }): Promise<ScreenTitlePresetRow[]> {
  const db = getPool()
  const includeArchived = Boolean(params?.includeArchived)
  const limit = Math.min(Math.max(Number(params?.limit ?? 200), 1), 500)
  const where = includeArchived ? '' : 'AND archived_at IS NULL'
  const [rows] = await db.query(
    `SELECT *
       FROM screen_title_presets
      WHERE owner_user_id = ?
        ${where}
      ORDER BY id DESC
      LIMIT ?`,
    [ownerUserId, limit]
  )
  return rows as any[]
}

export async function getById(id: number): Promise<ScreenTitlePresetRow | null> {
  const db = getPool()
  const [rows] = await db.query(`SELECT * FROM screen_title_presets WHERE id = ? LIMIT 1`, [id])
  const row = (rows as any[])[0]
  return row || null
}

export async function create(input: {
  ownerUserId: number
  name: string
  description?: string | null
  style: string
  fontKey: string
  fontSizePct: number
  trackingPct: number
  fontColor: string
  fontGradientKey?: string | null
  outlineWidthPct?: number | null
  outlineOpacityPct?: number | null
  outlineColor?: string | null
  marginLeftPct?: number | null
  marginRightPct?: number | null
  marginTopPct?: number | null
  marginBottomPct?: number | null
  pillBgColor: string
  pillBgOpacityPct: number
  alignment: string
  position: string
  maxWidthPct: number
  insetXPreset?: string | null
  insetYPreset?: string | null
  timingRule: string
  timingSeconds: number | null
  fade: string
}): Promise<ScreenTitlePresetRow> {
  const db = getPool()
  const [result] = await db.query(
    `INSERT INTO screen_title_presets
      (owner_user_id, name, description, style, font_key, font_size_pct, tracking_pct, font_color, font_gradient_key, outline_width_pct, outline_opacity_pct, outline_color, margin_left_pct, margin_right_pct, margin_top_pct, margin_bottom_pct, pill_bg_color, pill_bg_opacity_pct, alignment, position, max_width_pct, inset_x_preset, inset_y_preset, timing_rule, timing_seconds, fade)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.ownerUserId,
      input.name,
      input.description ?? null,
      input.style,
      input.fontKey,
      input.fontSizePct,
      input.trackingPct,
      input.fontColor,
      input.fontGradientKey ?? null,
      input.outlineWidthPct ?? null,
      input.outlineOpacityPct ?? null,
      input.outlineColor ?? null,
      input.marginLeftPct ?? null,
      input.marginRightPct ?? null,
      input.marginTopPct ?? null,
      input.marginBottomPct ?? null,
      input.pillBgColor,
      input.pillBgOpacityPct,
      input.alignment,
      input.position,
      input.maxWidthPct,
      input.insetXPreset ?? null,
      input.insetYPreset ?? null,
      input.timingRule,
      input.timingSeconds,
      input.fade,
    ]
  )
  const id = Number((result as any).insertId)
  const row = await getById(id)
  if (!row) throw new Error('failed_to_create_screen_title_preset')
  return row
}

export async function update(id: number, patch: {
  name?: string
  description?: string | null
  style?: string
  fontKey?: string
  fontSizePct?: number
  trackingPct?: number
  fontColor?: string
  fontGradientKey?: string | null
  outlineWidthPct?: number | null
  outlineOpacityPct?: number | null
  outlineColor?: string | null
  marginLeftPct?: number | null
  marginRightPct?: number | null
  marginTopPct?: number | null
  marginBottomPct?: number | null
  pillBgColor?: string
  pillBgOpacityPct?: number
  alignment?: string
  position?: string
  maxWidthPct?: number
  insetXPreset?: string | null
  insetYPreset?: string | null
  timingRule?: string
  timingSeconds?: number | null
  fade?: string
}): Promise<ScreenTitlePresetRow> {
  const db = getPool()
  const sets: string[] = []
  const args: any[] = []
  if (patch.name !== undefined) { sets.push('name = ?'); args.push(patch.name) }
  if (patch.description !== undefined) { sets.push('description = ?'); args.push(patch.description) }
  if (patch.style !== undefined) { sets.push('style = ?'); args.push(patch.style) }
  if (patch.fontKey !== undefined) { sets.push('font_key = ?'); args.push(patch.fontKey) }
  if (patch.fontSizePct !== undefined) { sets.push('font_size_pct = ?'); args.push(patch.fontSizePct) }
  if (patch.trackingPct !== undefined) { sets.push('tracking_pct = ?'); args.push(patch.trackingPct) }
  if (patch.fontColor !== undefined) { sets.push('font_color = ?'); args.push(patch.fontColor) }
  if (patch.fontGradientKey !== undefined) { sets.push('font_gradient_key = ?'); args.push(patch.fontGradientKey) }
  if (patch.outlineWidthPct !== undefined) { sets.push('outline_width_pct = ?'); args.push(patch.outlineWidthPct) }
  if (patch.outlineOpacityPct !== undefined) { sets.push('outline_opacity_pct = ?'); args.push(patch.outlineOpacityPct) }
  if (patch.outlineColor !== undefined) { sets.push('outline_color = ?'); args.push(patch.outlineColor) }
  if (patch.marginLeftPct !== undefined) { sets.push('margin_left_pct = ?'); args.push(patch.marginLeftPct) }
  if (patch.marginRightPct !== undefined) { sets.push('margin_right_pct = ?'); args.push(patch.marginRightPct) }
  if (patch.marginTopPct !== undefined) { sets.push('margin_top_pct = ?'); args.push(patch.marginTopPct) }
  if (patch.marginBottomPct !== undefined) { sets.push('margin_bottom_pct = ?'); args.push(patch.marginBottomPct) }
  if (patch.pillBgColor !== undefined) { sets.push('pill_bg_color = ?'); args.push(patch.pillBgColor) }
  if (patch.pillBgOpacityPct !== undefined) { sets.push('pill_bg_opacity_pct = ?'); args.push(patch.pillBgOpacityPct) }
  if (patch.alignment !== undefined) { sets.push('alignment = ?'); args.push(patch.alignment) }
  if (patch.position !== undefined) { sets.push('position = ?'); args.push(patch.position) }
  if (patch.maxWidthPct !== undefined) { sets.push('max_width_pct = ?'); args.push(patch.maxWidthPct) }
  if (patch.insetXPreset !== undefined) { sets.push('inset_x_preset = ?'); args.push(patch.insetXPreset) }
  if (patch.insetYPreset !== undefined) { sets.push('inset_y_preset = ?'); args.push(patch.insetYPreset) }
  if (patch.timingRule !== undefined) { sets.push('timing_rule = ?'); args.push(patch.timingRule) }
  if (patch.timingSeconds !== undefined) { sets.push('timing_seconds = ?'); args.push(patch.timingSeconds) }
  if (patch.fade !== undefined) { sets.push('fade = ?'); args.push(patch.fade) }
  if (!sets.length) {
    const row = await getById(id)
    if (!row) throw new Error('not_found')
    return row
  }
  await db.query(`UPDATE screen_title_presets SET ${sets.join(', ')} WHERE id = ?`, [...args, id])
  const row = await getById(id)
  if (!row) throw new Error('not_found')
  return row
}

export async function archive(id: number): Promise<void> {
  const db = getPool()
  await db.query(`UPDATE screen_title_presets SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP) WHERE id = ?`, [id])
}
