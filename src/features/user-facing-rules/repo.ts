import { getPool } from '../../db'
import type { UserFacingRuleMappingRow, UserFacingRuleRow } from './types'

const SELECT_RULE_SQL = `
  SELECT
    id,
    label,
    short_description,
    group_order,
    display_order,
    is_active,
    created_at,
    updated_at
  FROM user_facing_rules
`

const SELECT_MAPPING_SQL = `
  SELECT
    id,
    user_facing_rule_id,
    rule_id,
    priority,
    is_default,
    created_at,
    updated_at
  FROM user_facing_rule_rule_map
`

export async function listRules(params?: {
  includeInactive?: boolean
  limit?: number
}): Promise<UserFacingRuleRow[]> {
  const db = getPool()
  const includeInactive = Boolean(params?.includeInactive)
  const limit = Math.min(Math.max(Number(params?.limit ?? 200), 1), 500)
  const where: string[] = ['1=1']
  const args: any[] = []
  if (!includeInactive) where.push('is_active = 1')
  const [rows] = await db.query(
    `${SELECT_RULE_SQL}
      WHERE ${where.join(' AND ')}
      ORDER BY group_order ASC, display_order ASC, label ASC, id ASC
      LIMIT ?`,
    [...args, limit]
  )
  return rows as UserFacingRuleRow[]
}

export async function getRuleById(id: number): Promise<UserFacingRuleRow | null> {
  const db = getPool()
  const [rows] = await db.query(`${SELECT_RULE_SQL} WHERE id = ? LIMIT 1`, [id])
  return ((rows as any[])[0] as UserFacingRuleRow) || null
}

export async function createRule(input: {
  label: string
  shortDescription: string | null
  groupOrder: number
  displayOrder: number
  isActive: boolean
}): Promise<UserFacingRuleRow> {
  const db = getPool()
  const [result] = await db.query(
    `INSERT INTO user_facing_rules
      (label, short_description, group_key, group_label, group_order, display_order, is_active)
     VALUES (?, ?, NULL, NULL, ?, ?, ?)`,
    [
      input.label,
      input.shortDescription,
      input.groupOrder,
      input.displayOrder,
      input.isActive ? 1 : 0,
    ]
  )
  const id = Number((result as any).insertId)
  const row = await getRuleById(id)
  if (!row) throw new Error('failed_to_create_user_facing_rule')
  return row
}

export async function updateRule(id: number, patch: {
  label?: string
  shortDescription?: string | null
  groupOrder?: number
  displayOrder?: number
  isActive?: boolean
}): Promise<UserFacingRuleRow> {
  const db = getPool()
  const sets: string[] = []
  const args: any[] = []
  if (patch.label !== undefined) { sets.push('label = ?'); args.push(patch.label) }
  if (patch.shortDescription !== undefined) { sets.push('short_description = ?'); args.push(patch.shortDescription) }
  if (patch.groupOrder !== undefined) { sets.push('group_order = ?'); args.push(patch.groupOrder) }
  if (patch.displayOrder !== undefined) { sets.push('display_order = ?'); args.push(patch.displayOrder) }
  if (patch.isActive !== undefined) { sets.push('is_active = ?'); args.push(patch.isActive ? 1 : 0) }
  sets.push('group_key = NULL')
  sets.push('group_label = NULL')
  if (sets.length) await db.query(`UPDATE user_facing_rules SET ${sets.join(', ')} WHERE id = ?`, [...args, id])
  const row = await getRuleById(id)
  if (!row) throw new Error('user_facing_rule_not_found')
  return row
}

export async function removeRule(id: number): Promise<boolean> {
  const db = getPool()
  const [result] = await db.query(`DELETE FROM user_facing_rules WHERE id = ?`, [id])
  return Number((result as any)?.affectedRows || 0) > 0
}

export async function listMappingsByRuleId(userFacingRuleId: number): Promise<UserFacingRuleMappingRow[]> {
  const db = getPool()
  const [rows] = await db.query(
    `${SELECT_MAPPING_SQL}
      WHERE user_facing_rule_id = ?
      ORDER BY is_default DESC, priority ASC, id ASC`,
    [userFacingRuleId]
  )
  return rows as UserFacingRuleMappingRow[]
}

export async function getMappingById(mappingId: number): Promise<UserFacingRuleMappingRow | null> {
  const db = getPool()
  const [rows] = await db.query(`${SELECT_MAPPING_SQL} WHERE id = ? LIMIT 1`, [mappingId])
  return ((rows as any[])[0] as UserFacingRuleMappingRow) || null
}

export async function getMappingByRulePair(userFacingRuleId: number, ruleId: number): Promise<UserFacingRuleMappingRow | null> {
  const db = getPool()
  const [rows] = await db.query(
    `${SELECT_MAPPING_SQL}
      WHERE user_facing_rule_id = ?
        AND rule_id = ?
      LIMIT 1`,
    [userFacingRuleId, ruleId]
  )
  return ((rows as any[])[0] as UserFacingRuleMappingRow) || null
}

export async function createMapping(input: {
  userFacingRuleId: number
  ruleId: number
  priority: number
  isDefault: boolean
}): Promise<UserFacingRuleMappingRow> {
  const db = getPool()
  const [result] = await db.query(
    `INSERT INTO user_facing_rule_rule_map
      (user_facing_rule_id, rule_id, priority, is_default)
     VALUES (?, ?, ?, ?)`,
    [input.userFacingRuleId, input.ruleId, input.priority, input.isDefault ? 1 : 0]
  )
  const id = Number((result as any).insertId)
  const row = await getMappingById(id)
  if (!row) throw new Error('failed_to_create_user_facing_rule_mapping')
  return row
}

export async function updateMapping(mappingId: number, patch: {
  ruleId?: number
  priority?: number
  isDefault?: boolean
}): Promise<UserFacingRuleMappingRow> {
  const db = getPool()
  const sets: string[] = []
  const args: any[] = []
  if (patch.ruleId !== undefined) { sets.push('rule_id = ?'); args.push(patch.ruleId) }
  if (patch.priority !== undefined) { sets.push('priority = ?'); args.push(patch.priority) }
  if (patch.isDefault !== undefined) { sets.push('is_default = ?'); args.push(patch.isDefault ? 1 : 0) }
  if (sets.length) await db.query(`UPDATE user_facing_rule_rule_map SET ${sets.join(', ')} WHERE id = ?`, [...args, mappingId])
  const row = await getMappingById(mappingId)
  if (!row) throw new Error('user_facing_rule_mapping_not_found')
  return row
}

export async function clearDefaultMappings(userFacingRuleId: number, exceptMappingId?: number | null): Promise<void> {
  const db = getPool()
  if (exceptMappingId && Number.isFinite(exceptMappingId) && Number(exceptMappingId) > 0) {
    await db.query(
      `UPDATE user_facing_rule_rule_map
          SET is_default = 0
        WHERE user_facing_rule_id = ?
          AND id <> ?`,
      [userFacingRuleId, Number(exceptMappingId)]
    )
    return
  }
  await db.query(
    `UPDATE user_facing_rule_rule_map
        SET is_default = 0
      WHERE user_facing_rule_id = ?`,
    [userFacingRuleId]
  )
}

export async function removeMapping(mappingId: number): Promise<boolean> {
  const db = getPool()
  const [result] = await db.query(`DELETE FROM user_facing_rule_rule_map WHERE id = ?`, [mappingId])
  return Number((result as any)?.affectedRows || 0) > 0
}

export async function listRuleOptions(): Promise<Array<{ id: number; title: string; slug: string; visibility: string }>> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT
        r.id,
        r.title,
        r.slug,
        r.visibility
       FROM rules r
      ORDER BY r.title ASC, r.id ASC`
  )
  return (rows as any[]).map((row) => ({
    id: Number(row.id),
    title: String(row.title || ''),
    slug: String(row.slug || ''),
    visibility: String(row.visibility || ''),
  }))
}
