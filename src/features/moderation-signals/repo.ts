import { getPool } from '../../db'
import type {
  ModerationSignalRecord,
  ModerationSignalStatus,
  ModerationSignalUpsertInput,
  ModerationSignalUsageCounts,
  ModerationSignalWithUsage,
} from './types'

type DbLike = { query: (sql: string, params?: any[]) => Promise<any> }

function dbOrPool(db?: DbLike): DbLike {
  return (db as any) || getPool()
}

function parseJsonCell(value: unknown): Record<string, unknown> | null {
  if (value == null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    try {
      const parsed = JSON.parse(trimmed)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function normalizeSignalId(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_ -]+/g, '')
    .replace(/[-\s]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function normalizeSignalIds(values: Iterable<string>): string[] {
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = normalizeSignalId(value)
    if (normalized) seen.add(normalized)
  }
  return Array.from(seen)
}

function toSignalRecord(row: any): ModerationSignalRecord {
  return {
    signal_id: String(row.signal_id || ''),
    label: String(row.label || ''),
    short_description: row.short_description == null ? null : String(row.short_description),
    long_description: row.long_description == null ? null : String(row.long_description),
    status: String(row.status || 'draft') as ModerationSignalStatus,
    metadata_json: parseJsonCell(row.metadata_json),
    created_at: row.created_at == null ? undefined : String(row.created_at),
    updated_at: row.updated_at == null ? undefined : String(row.updated_at),
  }
}

function toSignalWithUsage(row: any): ModerationSignalWithUsage {
  const base = toSignalRecord(row)
  const usageCounts: ModerationSignalUsageCounts = {
    rules: Math.max(0, Number(row.rule_count || 0)),
    culture_positive: Math.max(0, Number(row.culture_positive_count || 0)),
    culture_disruption: Math.max(0, Number(row.culture_disruption_count || 0)),
    total: 0,
  }
  usageCounts.total = usageCounts.rules + usageCounts.culture_positive + usageCounts.culture_disruption
  return {
    ...base,
    usage_counts: usageCounts,
  }
}

export async function listSignals(params?: {
  status?: ModerationSignalStatus | 'all'
  search?: string
  limit?: number
  db?: DbLike
}): Promise<ModerationSignalWithUsage[]> {
  const q = dbOrPool(params?.db)
  const where: string[] = ['1=1']
  const args: any[] = []
  const status = String(params?.status || 'all').trim().toLowerCase()
  if (status && status !== 'all') {
    where.push('ms.status = ?')
    args.push(status)
  }
  const search = String(params?.search || '').trim()
  if (search) {
    const like = `%${search}%`
    where.push('(ms.signal_id LIKE ? OR ms.label LIKE ? OR COALESCE(ms.short_description, \'\') LIKE ?)')
    args.push(like, like, like)
  }
  const limit = Math.min(Math.max(Number(params?.limit ?? 200), 1), 500)
  const [rows] = await q.query(
    `
      SELECT
        ms.signal_id,
        ms.label,
        ms.short_description,
        ms.long_description,
        ms.status,
        ms.metadata_json,
        ms.created_at,
        ms.updated_at,
        COALESCE(rs.rule_count, 0) AS rule_count,
        COALESCE(cps.culture_positive_count, 0) AS culture_positive_count,
        COALESCE(cds.culture_disruption_count, 0) AS culture_disruption_count
      FROM moderation_signals ms
      LEFT JOIN (
        SELECT signal_id, COUNT(*) AS rule_count
        FROM rule_signals
        GROUP BY signal_id
      ) rs ON rs.signal_id = ms.signal_id
      LEFT JOIN (
        SELECT signal_id, COUNT(*) AS culture_positive_count
        FROM culture_positive_signals
        GROUP BY signal_id
      ) cps ON cps.signal_id = ms.signal_id
      LEFT JOIN (
        SELECT signal_id, COUNT(*) AS culture_disruption_count
        FROM culture_disruption_signals
        GROUP BY signal_id
      ) cds ON cds.signal_id = ms.signal_id
      WHERE ${where.join(' AND ')}
      ORDER BY
        FIELD(ms.status, 'active', 'draft', 'inactive', 'archived'),
        ms.label ASC,
        ms.signal_id ASC
      LIMIT ?
    `,
    [...args, limit]
  )
  return (rows as any[]).map(toSignalWithUsage)
}

export async function getSignalById(
  signalId: string,
  db?: DbLike
): Promise<ModerationSignalWithUsage | null> {
  const q = dbOrPool(db)
  const normalized = normalizeSignalId(signalId)
  if (!normalized) return null
  const [rows] = await q.query(
    `
      SELECT
        ms.signal_id,
        ms.label,
        ms.short_description,
        ms.long_description,
        ms.status,
        ms.metadata_json,
        ms.created_at,
        ms.updated_at,
        COALESCE(rs.rule_count, 0) AS rule_count,
        COALESCE(cps.culture_positive_count, 0) AS culture_positive_count,
        COALESCE(cds.culture_disruption_count, 0) AS culture_disruption_count
      FROM moderation_signals ms
      LEFT JOIN (
        SELECT signal_id, COUNT(*) AS rule_count
        FROM rule_signals
        GROUP BY signal_id
      ) rs ON rs.signal_id = ms.signal_id
      LEFT JOIN (
        SELECT signal_id, COUNT(*) AS culture_positive_count
        FROM culture_positive_signals
        GROUP BY signal_id
      ) cps ON cps.signal_id = ms.signal_id
      LEFT JOIN (
        SELECT signal_id, COUNT(*) AS culture_disruption_count
        FROM culture_disruption_signals
        GROUP BY signal_id
      ) cds ON cds.signal_id = ms.signal_id
      WHERE ms.signal_id = ?
      LIMIT 1
    `,
    [normalized]
  )
  const row = (rows as any[])[0]
  return row ? toSignalWithUsage(row) : null
}

export async function upsertSignal(
  input: ModerationSignalUpsertInput,
  db?: DbLike
): Promise<ModerationSignalWithUsage> {
  const q = dbOrPool(db)
  const signalId = normalizeSignalId(input.signal_id)
  const label = String(input.label || '').trim()
  if (!signalId) throw new Error('invalid_signal_id')
  if (!label) throw new Error('invalid_signal_label')
  const shortDescription =
    input.short_description == null ? null : String(input.short_description).trim() || null
  const longDescription =
    input.long_description == null ? null : String(input.long_description).trim() || null
  const status = String(input.status || 'draft').trim().toLowerCase() || 'draft'
  const metadataJson = input.metadata_json == null ? null : input.metadata_json
  await q.query(
    `
      INSERT INTO moderation_signals
        (signal_id, label, short_description, long_description, status, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        label = VALUES(label),
        short_description = VALUES(short_description),
        long_description = VALUES(long_description),
        status = VALUES(status),
        metadata_json = VALUES(metadata_json)
    `,
    [
      signalId,
      label,
      shortDescription,
      longDescription,
      status,
      metadataJson == null ? null : JSON.stringify(metadataJson),
    ]
  )
  const row = await getSignalById(signalId, q)
  if (!row) throw new Error('failed_to_upsert_signal')
  return row
}

async function replaceSignalLinks(
  tableName: 'rule_signals' | 'culture_positive_signals' | 'culture_disruption_signals',
  ownerColumn: 'rule_id' | 'culture_id',
  ownerId: number,
  signalIds: Iterable<string>,
  db?: DbLike
): Promise<void> {
  const q = dbOrPool(db)
  const normalized = normalizeSignalIds(signalIds)
  await q.query(`DELETE FROM ${tableName} WHERE ${ownerColumn} = ?`, [ownerId])
  for (const signalId of normalized) {
    await q.query(
      `INSERT INTO ${tableName} (${ownerColumn}, signal_id) VALUES (?, ?)`,
      [ownerId, signalId]
    )
  }
}

async function listLinkedSignalIds(
  tableName: 'rule_signals' | 'culture_positive_signals' | 'culture_disruption_signals',
  ownerColumn: 'rule_id' | 'culture_id',
  ownerId: number,
  db?: DbLike
): Promise<string[]> {
  const q = dbOrPool(db)
  const [rows] = await q.query(
    `SELECT signal_id FROM ${tableName} WHERE ${ownerColumn} = ? ORDER BY signal_id ASC`,
    [ownerId]
  )
  return (rows as any[]).map((row) => String(row.signal_id || '')).filter(Boolean)
}

export async function replaceRuleSignals(
  ruleId: number,
  signalIds: Iterable<string>,
  db?: DbLike
): Promise<void> {
  await replaceSignalLinks('rule_signals', 'rule_id', ruleId, signalIds, db)
}

export async function replaceCulturePositiveSignals(
  cultureId: number,
  signalIds: Iterable<string>,
  db?: DbLike
): Promise<void> {
  await replaceSignalLinks('culture_positive_signals', 'culture_id', cultureId, signalIds, db)
}

export async function replaceCultureDisruptionSignals(
  cultureId: number,
  signalIds: Iterable<string>,
  db?: DbLike
): Promise<void> {
  await replaceSignalLinks('culture_disruption_signals', 'culture_id', cultureId, signalIds, db)
}

export async function listRuleSignalIds(ruleId: number, db?: DbLike): Promise<string[]> {
  return listLinkedSignalIds('rule_signals', 'rule_id', ruleId, db)
}

export async function listCulturePositiveSignalIds(cultureId: number, db?: DbLike): Promise<string[]> {
  return listLinkedSignalIds('culture_positive_signals', 'culture_id', cultureId, db)
}

export async function listCultureDisruptionSignalIds(cultureId: number, db?: DbLike): Promise<string[]> {
  return listLinkedSignalIds('culture_disruption_signals', 'culture_id', cultureId, db)
}

export async function getSignalRegistryCounts(db?: DbLike): Promise<{
  total: number
  active: number
  draft: number
  inactive: number
  archived: number
}> {
  const q = dbOrPool(db)
  const [rows] = await q.query(
    `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft,
        SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) AS inactive,
        SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS archived
      FROM moderation_signals
    `
  )
  const row = (rows as any[])[0] || {}
  return {
    total: Math.max(0, Number(row.total || 0)),
    active: Math.max(0, Number(row.active || 0)),
    draft: Math.max(0, Number(row.draft || 0)),
    inactive: Math.max(0, Number(row.inactive || 0)),
    archived: Math.max(0, Number(row.archived || 0)),
  }
}
