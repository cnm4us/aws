import { getPool } from '../../db'
import type { VisualizerPresetRow, VisualizerPresetTemplateRow } from './types'

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
  sourceTemplateKey?: string | null
  isStarter?: boolean
  style: string
  fgColor: string
  bgColor: string | 'transparent'
  opacity: number
  scale: string
  barCount: number
  spectrumMode: string
  gradientEnabled: boolean
  gradientStart: string
  gradientEnd: string
  gradientMode: string
  clipMode: string
  clipInsetPct: number
  clipHeightPct: number
  instancesJson?: string | null
}): Promise<VisualizerPresetRow> {
  const db = getPool()
  const [result] = await db.query(
    `INSERT INTO visualizer_presets
      (owner_user_id, name, description, source_template_key, is_starter, style, fg_color, bg_color, opacity, scale, bar_count, spectrum_mode, gradient_enabled, gradient_start, gradient_end, gradient_mode, clip_mode, clip_inset_pct, clip_height_pct, instances_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.ownerUserId,
      input.name,
      input.description ?? null,
      input.sourceTemplateKey ?? null,
      input.isStarter ? 1 : 0,
      input.style,
      input.fgColor,
      input.bgColor,
      input.opacity,
      input.scale,
      input.barCount,
      input.spectrumMode,
      input.gradientEnabled ? 1 : 0,
      input.gradientStart,
      input.gradientEnd,
      input.gradientMode,
      input.clipMode,
      input.clipInsetPct,
      input.clipHeightPct,
      input.instancesJson ?? null,
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
  sourceTemplateKey?: string | null
  isStarter?: boolean
  archivedAt?: string | null
  style?: string
  fgColor?: string
  bgColor?: string | 'transparent'
  opacity?: number
  scale?: string
  barCount?: number
  spectrumMode?: string
  gradientEnabled?: boolean
  gradientStart?: string
  gradientEnd?: string
  gradientMode?: string
  clipMode?: string
  clipInsetPct?: number
  clipHeightPct?: number
  instancesJson?: string | null
}): Promise<VisualizerPresetRow> {
  const db = getPool()
  const sets: string[] = []
  const args: any[] = []
  if (patch.name !== undefined) { sets.push('name = ?'); args.push(patch.name) }
  if (patch.description !== undefined) { sets.push('description = ?'); args.push(patch.description) }
  if (patch.sourceTemplateKey !== undefined) { sets.push('source_template_key = ?'); args.push(patch.sourceTemplateKey) }
  if (patch.isStarter !== undefined) { sets.push('is_starter = ?'); args.push(patch.isStarter ? 1 : 0) }
  if (patch.archivedAt !== undefined) { sets.push('archived_at = ?'); args.push(patch.archivedAt) }
  if (patch.style !== undefined) { sets.push('style = ?'); args.push(patch.style) }
  if (patch.fgColor !== undefined) { sets.push('fg_color = ?'); args.push(patch.fgColor) }
  if (patch.bgColor !== undefined) { sets.push('bg_color = ?'); args.push(patch.bgColor) }
  if (patch.opacity !== undefined) { sets.push('opacity = ?'); args.push(patch.opacity) }
  if (patch.scale !== undefined) { sets.push('scale = ?'); args.push(patch.scale) }
  if (patch.barCount !== undefined) { sets.push('bar_count = ?'); args.push(patch.barCount) }
  if (patch.spectrumMode !== undefined) { sets.push('spectrum_mode = ?'); args.push(patch.spectrumMode) }
  if (patch.gradientEnabled !== undefined) { sets.push('gradient_enabled = ?'); args.push(patch.gradientEnabled ? 1 : 0) }
  if (patch.gradientStart !== undefined) { sets.push('gradient_start = ?'); args.push(patch.gradientStart) }
  if (patch.gradientEnd !== undefined) { sets.push('gradient_end = ?'); args.push(patch.gradientEnd) }
  if (patch.gradientMode !== undefined) { sets.push('gradient_mode = ?'); args.push(patch.gradientMode) }
  if (patch.clipMode !== undefined) { sets.push('clip_mode = ?'); args.push(patch.clipMode) }
  if (patch.clipInsetPct !== undefined) { sets.push('clip_inset_pct = ?'); args.push(patch.clipInsetPct) }
  if (patch.clipHeightPct !== undefined) { sets.push('clip_height_pct = ?'); args.push(patch.clipHeightPct) }
  if (patch.instancesJson !== undefined) { sets.push('instances_json = ?'); args.push(patch.instancesJson) }
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

export async function listActiveTemplates(limit = 200): Promise<VisualizerPresetTemplateRow[]> {
  const db = getPool()
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500)
  const [rows] = await db.query(
    `SELECT *
       FROM visualizer_preset_templates
      WHERE archived_at IS NULL
      ORDER BY template_key ASC
      LIMIT ?`,
    [safeLimit]
  )
  return rows as any[]
}

export async function getTemplateByKey(templateKey: string, opts?: { includeArchived?: boolean }): Promise<VisualizerPresetTemplateRow | null> {
  const db = getPool()
  const includeArchived = Boolean(opts?.includeArchived)
  const [rows] = await db.query(
    `SELECT *
       FROM visualizer_preset_templates
      WHERE template_key = ?
        ${includeArchived ? '' : 'AND archived_at IS NULL'}
      LIMIT 1`,
    [templateKey]
  )
  const row = (rows as any[])[0]
  return row || null
}
