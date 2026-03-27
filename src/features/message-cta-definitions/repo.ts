import { getPool } from '../../db'
import type {
  MessageCtaCompletionContract,
  MessageCtaDefinitionRow,
  MessageCtaDefinitionStatus,
  MessageCtaExecutorType,
  MessageCtaIntentKey,
  MessageCtaScopeType,
} from './types'

const SELECT_SQL = `
  SELECT
    id,
    name,
    status,
    scope_type,
    scope_space_id,
    intent_key,
    executor_type,
    completion_contract,
    label_default,
    config_json,
    created_by,
    updated_by,
    created_at,
    updated_at
  FROM feed_message_cta_definitions
`

type CreateInput = {
  name: string
  status: MessageCtaDefinitionStatus
  scopeType: MessageCtaScopeType
  scopeSpaceId: number | null
  intentKey: MessageCtaIntentKey
  executorType: MessageCtaExecutorType
  completionContract: MessageCtaCompletionContract
  labelDefault: string
  configJson: string
  createdBy: number
  updatedBy: number
}

type UpdateInput = Partial<CreateInput>

export async function list(params?: {
  limit?: number
  includeArchived?: boolean
  status?: MessageCtaDefinitionStatus | null
  scopeType?: MessageCtaScopeType | null
  scopeSpaceId?: number | null
  intentKey?: MessageCtaIntentKey | null
  executorType?: MessageCtaExecutorType | null
}): Promise<MessageCtaDefinitionRow[]> {
  const db = getPool()
  const limit = Math.min(Math.max(Number(params?.limit ?? 200), 1), 500)
  const where: string[] = ['1=1']
  const args: any[] = []

  if (!params?.includeArchived) {
    where.push(`status <> 'archived'`)
  }
  if (params?.status) {
    where.push('status = ?')
    args.push(params.status)
  }
  if (params?.scopeType) {
    where.push('scope_type = ?')
    args.push(params.scopeType)
  }
  if (params?.scopeSpaceId != null) {
    where.push('scope_space_id = ?')
    args.push(params.scopeSpaceId)
  }
  if (params?.intentKey) {
    where.push('intent_key = ?')
    args.push(params.intentKey)
  }
  if (params?.executorType) {
    where.push('executor_type = ?')
    args.push(params.executorType)
  }

  const [rows] = await db.query(
    `${SELECT_SQL}
      WHERE ${where.join(' AND ')}
      ORDER BY id DESC
      LIMIT ?`,
    [...args, limit]
  )

  return rows as MessageCtaDefinitionRow[]
}

export async function listByIds(ids: number[]): Promise<MessageCtaDefinitionRow[]> {
  if (!ids.length) return []
  const db = getPool()
  const uniq = Array.from(new Set(ids.filter((id) => Number.isFinite(id) && id > 0).map((id) => Math.round(id))))
  if (!uniq.length) return []
  const placeholders = uniq.map(() => '?').join(',')
  const [rows] = await db.query(
    `${SELECT_SQL}
      WHERE id IN (${placeholders})`,
    uniq
  )
  return rows as MessageCtaDefinitionRow[]
}

export async function getById(id: number): Promise<MessageCtaDefinitionRow | null> {
  const db = getPool()
  const [rows] = await db.query(`${SELECT_SQL} WHERE id = ? LIMIT 1`, [id])
  return ((rows as any[])[0] as MessageCtaDefinitionRow) || null
}

export async function create(input: CreateInput): Promise<MessageCtaDefinitionRow> {
  const db = getPool()
  const [result] = await db.query(
    `INSERT INTO feed_message_cta_definitions (
      name,
      status,
      scope_type,
      scope_space_id,
      intent_key,
      executor_type,
      completion_contract,
      label_default,
      config_json,
      created_by,
      updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.name,
      input.status,
      input.scopeType,
      input.scopeSpaceId,
      input.intentKey,
      input.executorType,
      input.completionContract,
      input.labelDefault,
      input.configJson,
      input.createdBy,
      input.updatedBy,
    ]
  )

  const id = Number((result as any).insertId)
  const row = await getById(id)
  if (!row) throw new Error('failed_to_create_message_cta_definition')
  return row
}

export async function update(id: number, patch: UpdateInput): Promise<MessageCtaDefinitionRow> {
  const db = getPool()
  const sets: string[] = []
  const args: any[] = []

  if (patch.name !== undefined) { sets.push('name = ?'); args.push(patch.name) }
  if (patch.status !== undefined) { sets.push('status = ?'); args.push(patch.status) }
  if (patch.scopeType !== undefined) { sets.push('scope_type = ?'); args.push(patch.scopeType) }
  if (patch.scopeSpaceId !== undefined) { sets.push('scope_space_id = ?'); args.push(patch.scopeSpaceId) }
  if (patch.intentKey !== undefined) { sets.push('intent_key = ?'); args.push(patch.intentKey) }
  if (patch.executorType !== undefined) { sets.push('executor_type = ?'); args.push(patch.executorType) }
  if (patch.completionContract !== undefined) { sets.push('completion_contract = ?'); args.push(patch.completionContract) }
  if (patch.labelDefault !== undefined) { sets.push('label_default = ?'); args.push(patch.labelDefault) }
  if (patch.configJson !== undefined) { sets.push('config_json = ?'); args.push(patch.configJson) }
  if (patch.updatedBy !== undefined) { sets.push('updated_by = ?'); args.push(patch.updatedBy) }

  if (!sets.length) {
    const row = await getById(id)
    if (!row) throw new Error('not_found')
    return row
  }

  await db.query(`UPDATE feed_message_cta_definitions SET ${sets.join(', ')} WHERE id = ?`, [...args, id])
  const row = await getById(id)
  if (!row) throw new Error('not_found')
  return row
}
