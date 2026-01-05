import { getPool } from '../../db'
import type { LowerThirdConfigRow, LowerThirdTemplateRow } from './types'

function normalizeJson(raw: any): any {
  if (raw == null) return null
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return raw }
  }
  return raw
}

export async function listTemplates(params?: { includeArchived?: boolean }): Promise<LowerThirdTemplateRow[]> {
  const db = getPool()
  const includeArchived = Boolean(params?.includeArchived)
  const where = includeArchived ? '' : 'WHERE archived_at IS NULL'
  const [rows] = await db.query(
    `
      SELECT *
        FROM lower_third_templates
        ${where}
       ORDER BY template_key ASC, version DESC
    `
  )
  return (rows as any[]).map((r) => ({ ...r, descriptor_json: normalizeJson((r as any).descriptor_json) }))
}

export async function getTemplateByKeyVersion(templateKey: string, version: number): Promise<LowerThirdTemplateRow | null> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT * FROM lower_third_templates WHERE template_key = ? AND version = ? LIMIT 1`,
    [templateKey, version]
  )
  const row = (rows as any[])[0]
  if (!row) return null
  return { ...row, descriptor_json: normalizeJson((row as any).descriptor_json) } as any
}

export async function listConfigsByOwner(ownerUserId: number, params?: { includeArchived?: boolean; limit?: number }): Promise<LowerThirdConfigRow[]> {
  const db = getPool()
  const includeArchived = Boolean(params?.includeArchived)
  const limit = Math.min(Math.max(Number(params?.limit ?? 200), 1), 500)
  const where = includeArchived ? '' : 'AND archived_at IS NULL'
  const [rows] = await db.query(
    `
      SELECT *
        FROM lower_third_configurations
       WHERE owner_user_id = ?
         ${where}
       ORDER BY id DESC
       LIMIT ?
    `,
    [ownerUserId, limit]
  )
  return (rows as any[]).map((r) => ({ ...r, params_json: normalizeJson((r as any).params_json) }))
}

export async function getConfigById(id: number): Promise<LowerThirdConfigRow | null> {
  const db = getPool()
  const [rows] = await db.query(`SELECT * FROM lower_third_configurations WHERE id = ? LIMIT 1`, [id])
  const row = (rows as any[])[0]
  if (!row) return null
  return { ...row, params_json: normalizeJson((row as any).params_json) } as any
}

export async function createConfig(input: {
  ownerUserId: number
  name: string
  templateKey: string
  templateVersion: number
  paramsJson: any
  timingRule: 'first_only' | 'entire'
  timingSeconds: number | null
}): Promise<LowerThirdConfigRow> {
  const db = getPool()
  const [result] = await db.query(
    `
      INSERT INTO lower_third_configurations
        (owner_user_id, name, template_key, template_version, params_json, timing_rule, timing_seconds)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.ownerUserId,
      input.name,
      input.templateKey,
      input.templateVersion,
      JSON.stringify(input.paramsJson),
      input.timingRule,
      input.timingSeconds,
    ]
  )
  const id = Number((result as any).insertId)
  const row = await getConfigById(id)
  if (!row) throw new Error('failed_to_create_lower_third_config')
  return row
}

export async function updateConfig(
  id: number,
  patch: {
    name?: string
    templateKey?: string
    templateVersion?: number
    paramsJson?: any
    timingRule?: 'first_only' | 'entire'
    timingSeconds?: number | null
  }
): Promise<LowerThirdConfigRow> {
  const db = getPool()
  const sets: string[] = []
  const args: any[] = []
  if (patch.name !== undefined) { sets.push('name = ?'); args.push(patch.name) }
  if (patch.templateKey !== undefined) { sets.push('template_key = ?'); args.push(patch.templateKey) }
  if (patch.templateVersion !== undefined) { sets.push('template_version = ?'); args.push(patch.templateVersion) }
  if (patch.paramsJson !== undefined) { sets.push('params_json = ?'); args.push(JSON.stringify(patch.paramsJson)) }
  if (patch.timingRule !== undefined) { sets.push('timing_rule = ?'); args.push(patch.timingRule) }
  if (patch.timingSeconds !== undefined) { sets.push('timing_seconds = ?'); args.push(patch.timingSeconds) }
  if (!sets.length) {
    const row = await getConfigById(id)
    if (!row) throw new Error('not_found')
    return row
  }
  await db.query(`UPDATE lower_third_configurations SET ${sets.join(', ')} WHERE id = ?`, [...args, id])
  const row = await getConfigById(id)
  if (!row) throw new Error('not_found')
  return row
}

export async function archiveConfig(id: number): Promise<void> {
  const db = getPool()
  await db.query(
    `UPDATE lower_third_configurations SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP) WHERE id = ?`,
    [id]
  )
}
