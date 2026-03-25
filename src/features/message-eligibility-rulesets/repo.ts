import { getPool } from '../../db'
import type {
  MessageEligibilityRulesetRow,
  MessageEligibilityRulesetStatus,
} from './types'

const SELECT_SQL = `
  SELECT
    id,
    name,
    status,
    description,
    criteria_json,
    created_by,
    updated_by,
    created_at,
    updated_at
  FROM feed_message_eligibility_rulesets
`

type CreateInput = {
  name: string
  status: MessageEligibilityRulesetStatus
  description: string | null
  criteriaJson: string
  createdBy: number
  updatedBy: number
}

type UpdateInput = Partial<CreateInput>

export async function list(params?: {
  limit?: number
  includeArchived?: boolean
  status?: MessageEligibilityRulesetStatus | null
}): Promise<MessageEligibilityRulesetRow[]> {
  const db = getPool()
  const limit = Math.min(Math.max(Number(params?.limit ?? 200), 1), 500)
  const where: string[] = ['1=1']
  const args: any[] = []

  if (!params?.includeArchived) where.push(`status <> 'archived'`)
  if (params?.status) {
    where.push('status = ?')
    args.push(params.status)
  }

  const [rows] = await db.query(
    `${SELECT_SQL}
      WHERE ${where.join(' AND ')}
      ORDER BY id DESC
      LIMIT ?`,
    [...args, limit]
  )
  return rows as MessageEligibilityRulesetRow[]
}

export async function listByIds(ids: number[]): Promise<MessageEligibilityRulesetRow[]> {
  const db = getPool()
  const uniq = Array.from(new Set(ids.filter((id) => Number.isFinite(id) && id > 0).map((id) => Math.round(id))))
  if (!uniq.length) return []
  const placeholders = uniq.map(() => '?').join(',')
  const [rows] = await db.query(
    `${SELECT_SQL}
      WHERE id IN (${placeholders})`,
    uniq
  )
  return rows as MessageEligibilityRulesetRow[]
}

export async function getById(id: number): Promise<MessageEligibilityRulesetRow | null> {
  const db = getPool()
  const [rows] = await db.query(`${SELECT_SQL} WHERE id = ? LIMIT 1`, [id])
  return ((rows as any[])[0] as MessageEligibilityRulesetRow) || null
}

export async function create(input: CreateInput): Promise<MessageEligibilityRulesetRow> {
  const db = getPool()
  const [result] = await db.query(
    `INSERT INTO feed_message_eligibility_rulesets (
      name,
      status,
      description,
      criteria_json,
      created_by,
      updated_by
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.name,
      input.status,
      input.description,
      input.criteriaJson,
      input.createdBy,
      input.updatedBy,
    ]
  )
  const id = Number((result as any).insertId)
  const row = await getById(id)
  if (!row) throw new Error('failed_to_create_message_eligibility_ruleset')
  return row
}

export async function update(id: number, patch: UpdateInput): Promise<MessageEligibilityRulesetRow> {
  const db = getPool()
  const sets: string[] = []
  const args: any[] = []

  if (patch.name !== undefined) { sets.push('name = ?'); args.push(patch.name) }
  if (patch.status !== undefined) { sets.push('status = ?'); args.push(patch.status) }
  if (patch.description !== undefined) { sets.push('description = ?'); args.push(patch.description) }
  if (patch.criteriaJson !== undefined) { sets.push('criteria_json = ?'); args.push(patch.criteriaJson) }
  if (patch.updatedBy !== undefined) { sets.push('updated_by = ?'); args.push(patch.updatedBy) }

  if (sets.length) {
    await db.query(`UPDATE feed_message_eligibility_rulesets SET ${sets.join(', ')} WHERE id = ?`, [...args, id])
  }

  const row = await getById(id)
  if (!row) throw new Error('not_found')
  return row
}

export async function remove(id: number): Promise<boolean> {
  const db = getPool()
  const [result] = await db.query(`DELETE FROM feed_message_eligibility_rulesets WHERE id = ?`, [id])
  return Number((result as any)?.affectedRows || 0) > 0
}
