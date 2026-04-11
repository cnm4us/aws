import { getPool } from '../../db'
import { deriveSignalClassification } from './classification'
import type {
  ModerationSignalFamily,
  ModerationSignalPolarity,
  ModerationSignalCultureUsage,
  ModerationSignalRecord,
  ModerationSignalRuleUsage,
  ModerationSignalStatus,
  ModerationSignalUpsertInput,
  ModerationSignalUsageDetail,
  ModerationSignalUsageCounts,
  ModerationSignalWithUsage,
} from './types'
import {
  getAllowedSignalFamiliesForPolarity,
  MODERATION_SIGNAL_POLARITIES,
  MODERATION_SIGNAL_STATUSES,
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
  const metadataJson = parseJsonCell(row.metadata_json)
  const classification = deriveSignalClassification({
    signalId: String(row.signal_id || ''),
    metadataJson,
    polarity: row.polarity == null ? null : String(row.polarity),
    signalFamily: row.signal_family == null ? null : String(row.signal_family),
  })
  if (!classification) throw new Error(`missing_signal_classification:${String(row.signal_id || '')}`)
  return {
    signal_id: String(row.signal_id || ''),
    label: String(row.label || ''),
    short_description: row.short_description == null ? null : String(row.short_description),
    long_description: row.long_description == null ? null : String(row.long_description),
    polarity: classification.polarity,
    signal_family: classification.signal_family,
    status: String(row.status || 'draft') as ModerationSignalStatus,
    metadata_json: metadataJson,
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
    future_mappings: 0,
    total: 0,
  }
  usageCounts.total =
    usageCounts.rules +
    usageCounts.culture_positive +
    usageCounts.culture_disruption +
    usageCounts.future_mappings
  return {
    ...base,
    usage_counts: usageCounts,
  }
}

function normalizeSignalStatus(value: string): ModerationSignalStatus {
  const normalized = String(value || '').trim().toLowerCase()
  if ((MODERATION_SIGNAL_STATUSES as readonly string[]).includes(normalized)) {
    return normalized as ModerationSignalStatus
  }
  throw new Error('invalid_signal_status')
}

function normalizeSignalPolarity(value: string): ModerationSignalPolarity {
  const normalized = String(value || '').trim().toLowerCase()
  if ((MODERATION_SIGNAL_POLARITIES as readonly string[]).includes(normalized)) {
    return normalized as ModerationSignalPolarity
  }
  throw new Error('invalid_signal_polarity')
}

function normalizeSignalFamily(
  polarity: ModerationSignalPolarity,
  value: string
): ModerationSignalFamily {
  const normalized = String(value || '').trim().toLowerCase()
  if (getAllowedSignalFamiliesForPolarity(polarity).includes(normalized as ModerationSignalFamily)) {
    return normalized as ModerationSignalFamily
  }
  throw new Error('invalid_signal_family')
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
        ms.polarity,
        ms.signal_family,
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
        ms.polarity,
        ms.signal_family,
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
  const status = normalizeSignalStatus(String(input.status || 'draft') || 'draft')
  const metadataJson = input.metadata_json == null ? null : input.metadata_json
  const existing = await getSignalById(signalId, q)
  const classification = deriveSignalClassification({
    signalId,
    metadataJson,
    polarity: input.polarity ?? existing?.polarity ?? null,
    signalFamily: input.signal_family ?? existing?.signal_family ?? null,
  })
  if (!classification) throw new Error('missing_signal_classification')
  const polarity = normalizeSignalPolarity(classification.polarity)
  const signalFamily = normalizeSignalFamily(polarity, classification.signal_family)
  await q.query(
    `
      INSERT INTO moderation_signals
        (signal_id, label, short_description, long_description, polarity, signal_family, status, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        label = VALUES(label),
        short_description = VALUES(short_description),
        long_description = VALUES(long_description),
        polarity = VALUES(polarity),
        signal_family = VALUES(signal_family),
        status = VALUES(status),
        metadata_json = VALUES(metadata_json)
    `,
    [
      signalId,
      label,
      shortDescription,
      longDescription,
      polarity,
      signalFamily,
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

export async function listSignalRuleUsage(
  signalId: string,
  db?: DbLike
): Promise<ModerationSignalRuleUsage[]> {
  const q = dbOrPool(db)
  const normalized = normalizeSignalId(signalId)
  if (!normalized) return []
  const [rows] = await q.query(
    `
      SELECT
        r.id,
        r.slug,
        r.title,
        rc.name AS category_name,
        rv.version AS current_version
      FROM rule_signals rs
      JOIN rules r
        ON r.id = rs.rule_id
 LEFT JOIN rule_categories rc
        ON rc.id = r.category_id
 LEFT JOIN rule_versions rv
        ON rv.id = r.current_version_id
     WHERE rs.signal_id = ?
     ORDER BY r.title ASC, r.slug ASC, r.id ASC
    `,
    [normalized]
  )
  return (rows as any[]).map((row) => ({
    id: Number(row.id),
    slug: String(row.slug || ''),
    title: String(row.title || ''),
    category_name: row.category_name == null ? null : String(row.category_name),
    current_version:
      row.current_version == null ? null : Math.max(0, Number(row.current_version || 0)) || null,
  }))
}

async function listSignalCultureUsageByTable(
  tableName: 'culture_positive_signals' | 'culture_disruption_signals',
  signalId: string,
  db?: DbLike
): Promise<ModerationSignalCultureUsage[]> {
  const q = dbOrPool(db)
  const normalized = normalizeSignalId(signalId)
  if (!normalized) return []
  const [rows] = await q.query(
    `
      SELECT c.id, c.name
      FROM ${tableName} cs
      JOIN cultures c
        ON c.id = cs.culture_id
     WHERE cs.signal_id = ?
     ORDER BY c.name ASC, c.id ASC
    `,
    [normalized]
  )
  return (rows as any[]).map((row) => ({
    id: Number(row.id),
    name: String(row.name || ''),
  }))
}

export async function listSignalPositiveCultureUsage(
  signalId: string,
  db?: DbLike
): Promise<ModerationSignalCultureUsage[]> {
  return listSignalCultureUsageByTable('culture_positive_signals', signalId, db)
}

export async function listSignalDisruptionCultureUsage(
  signalId: string,
  db?: DbLike
): Promise<ModerationSignalCultureUsage[]> {
  return listSignalCultureUsageByTable('culture_disruption_signals', signalId, db)
}

export async function getSignalUsageDetail(
  signalId: string,
  db?: DbLike
): Promise<ModerationSignalUsageDetail> {
  const [rules, culturePositive, cultureDisruption] = await Promise.all([
    listSignalRuleUsage(signalId, db),
    listSignalPositiveCultureUsage(signalId, db),
    listSignalDisruptionCultureUsage(signalId, db),
  ])
  return {
    rules,
    culture_positive: culturePositive,
    culture_disruption: cultureDisruption,
  }
}
