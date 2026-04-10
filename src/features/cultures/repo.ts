import { getPool } from '../../db'
import { createDefaultCultureDefinitionV1 } from './defaults'
import { deriveCultureDefinitionIdFromKey } from './normalize'
import * as moderationSignals from '../moderation-signals'
import {
  assertCultureDefinitionV1,
} from './validator'
import {
  type CultureDefinitionV1,
  type CultureDefinitionValidationError,
} from './types'

type DbLike = { query: (sql: string, params?: any[]) => Promise<any> }

export type CultureRecord = {
  id: number
  name: string
  description: string | null
  definition_json: unknown | null
  created_at?: string
  updated_at?: string
}

export type CultureDefinitionHydrationSource =
  | 'stored'
  | 'default_missing'
  | 'default_invalid'

export type CultureDefinitionHydration = {
  definition: CultureDefinitionV1
  source: CultureDefinitionHydrationSource
  validationErrors: CultureDefinitionValidationError[]
}

export type CultureWithDefinitionRecord = CultureRecord & {
  definition: CultureDefinitionV1
  definition_source: CultureDefinitionHydrationSource
  definition_validation_errors: CultureDefinitionValidationError[]
}

function dbOrPool(db?: DbLike): DbLike {
  return (db as any) || getPool()
}

function parseJsonCell(value: unknown): unknown | null {
  if (value == null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    try {
      return JSON.parse(trimmed)
    } catch {
      return null
    }
  }
  return value
}

function metadataContextFromCulture(culture: {
  name?: string | null
  key?: string | null
}) {
  const cultureName = String(culture.name || '').trim()
  const cultureKey = String(culture.key || culture.name || '').trim()
  return {
    cultureName,
    cultureKey: cultureKey || deriveCultureDefinitionIdFromKey(cultureName || 'culture'),
    defaultVersion: 'v1' as const,
  }
}

function toCultureRecord(row: any): CultureRecord {
  return {
    id: Number(row.id),
    name: String(row.name || ''),
    description: row.description != null ? String(row.description) : null,
    definition_json: parseJsonCell(row.definition_json),
    created_at: row.created_at != null ? String(row.created_at) : undefined,
    updated_at: row.updated_at != null ? String(row.updated_at) : undefined,
  }
}

async function projectCultureDefinitionSignals(
  cultureId: number,
  definition: CultureDefinitionV1,
  db?: DbLike
): Promise<CultureDefinitionV1> {
  const q = dbOrPool(db)
  const storedPositive = Array.from(definition.positive_signals || [])
  const storedDisruption = Array.from(definition.disruption_signals || [])

  let positive = await moderationSignals.listCulturePositiveSignalIds(cultureId, q)
  if (!positive.length && storedPositive.length) {
    const ensured = await moderationSignals.ensureSignalsExist(storedPositive, 'culture_definition_positive_backfill')
    await moderationSignals.replaceCulturePositiveSignals(cultureId, ensured, q)
    positive = await moderationSignals.listCulturePositiveSignalIds(cultureId, q)
  }

  let disruption = await moderationSignals.listCultureDisruptionSignalIds(cultureId, q)
  if (!disruption.length && storedDisruption.length) {
    const ensured = await moderationSignals.ensureSignalsExist(storedDisruption, 'culture_definition_disruption_backfill')
    await moderationSignals.replaceCultureDisruptionSignals(cultureId, ensured, q)
    disruption = await moderationSignals.listCultureDisruptionSignalIds(cultureId, q)
  }

  return {
    ...definition,
    positive_signals: positive as any,
    disruption_signals: disruption as any,
  }
}

async function syncCultureDefinitionSignals(
  cultureId: number,
  definition: CultureDefinitionV1,
  db?: DbLike
): Promise<CultureDefinitionV1> {
  const q = dbOrPool(db)
  const resolveExistingSignalIds = async (rawIds: string[], field: 'positive_signals' | 'disruption_signals') => {
    const resolved: string[] = []
    const missing: string[] = []
    for (const rawId of rawIds) {
      const signal = await moderationSignals.getSignalById(rawId, q)
      if (!signal) {
        missing.push(String(rawId || '').trim())
        continue
      }
      resolved.push(signal.signal_id)
    }
    if (missing.length) {
      const err = new Error(`unknown_${field}`) as Error & {
        code?: string
        field?: string
        signalIds?: string[]
      }
      err.code = 'unknown_culture_signal_ids'
      err.field = field
      err.signalIds = missing
      throw err
    }
    return resolved
  }

  const resolvedPositive = await resolveExistingSignalIds(
    Array.from(definition.positive_signals || []),
    'positive_signals'
  )
  const resolvedDisruption = await resolveExistingSignalIds(
    Array.from(definition.disruption_signals || []),
    'disruption_signals'
  )
  await moderationSignals.replaceCulturePositiveSignals(cultureId, resolvedPositive, q)
  await moderationSignals.replaceCultureDisruptionSignals(cultureId, resolvedDisruption, q)
  return {
    ...definition,
    positive_signals: resolvedPositive as any,
    disruption_signals: resolvedDisruption as any,
  }
}

export async function backfillAllCultureSignalMemberships(db?: DbLike): Promise<number> {
  const q = dbOrPool(db)
  const [rows] = await q.query(
    `SELECT id, name, description, definition_json, created_at, updated_at
       FROM cultures
      ORDER BY id ASC`
  )
  let count = 0
  for (const row of rows as any[]) {
    const culture = toCultureRecord(row)
    const hydrated = hydrateCultureDefinitionWithFallback(culture)
    await projectCultureDefinitionSignals(culture.id, hydrated.definition, q)
    count += 1
  }
  return count
}

export function hydrateCultureDefinition(
  culture: Pick<CultureRecord, 'name' | 'definition_json'>
): CultureDefinitionHydration {
  const context = metadataContextFromCulture({ name: culture.name })
  const candidate = culture.definition_json ?? createDefaultCultureDefinitionV1(context)
  const validated = assertCultureDefinitionV1(candidate, context)

  if (culture.definition_json == null) {
    return {
      definition: validated,
      source: 'default_missing',
      validationErrors: [],
    }
  }
  return {
    definition: validated,
    source: 'stored',
    validationErrors: [],
  }
}

function hydrateCultureDefinitionWithFallback(
  culture: Pick<CultureRecord, 'name' | 'definition_json'>
): CultureDefinitionHydration {
  const context = metadataContextFromCulture({ name: culture.name })
  const candidate = parseJsonCell(culture.definition_json)
  if (candidate == null) {
    const fallback = assertCultureDefinitionV1(createDefaultCultureDefinitionV1(context), context)
    return {
      definition: fallback,
      source: 'default_missing',
      validationErrors: [],
    }
  }
  try {
    const definition = assertCultureDefinitionV1(candidate, context)
    return {
      definition,
      source: 'stored',
      validationErrors: [],
    }
  } catch (err: any) {
    const fallback = assertCultureDefinitionV1(createDefaultCultureDefinitionV1(context), context)
    const validationErrors = Array.isArray(err?.details) ? err.details : []
    return {
      definition: fallback,
      source: 'default_invalid',
      validationErrors,
    }
  }
}

export async function getCultureById(
  cultureId: number,
  db?: DbLike
): Promise<CultureRecord | null> {
  const q = dbOrPool(db)
  const [rows] = await q.query(
    `SELECT id, name, description, definition_json, created_at, updated_at
       FROM cultures
      WHERE id = ?
      LIMIT 1`,
    [cultureId]
  )
  const row = (rows as any[])[0]
  if (!row) return null
  return toCultureRecord(row)
}

export async function getCultureWithDefinition(
  cultureId: number,
  db?: DbLike
): Promise<CultureWithDefinitionRecord | null> {
  const culture = await getCultureById(cultureId, db)
  if (!culture) return null
  const hydrated = hydrateCultureDefinitionWithFallback(culture)
  const definition = await projectCultureDefinitionSignals(culture.id, hydrated.definition, db)
  return {
    ...culture,
    definition,
    definition_source: hydrated.source,
    definition_validation_errors: hydrated.validationErrors,
  }
}

export async function getCultureWithDefinitionByDefinitionId(
  definitionId: string,
  db?: DbLike
): Promise<CultureWithDefinitionRecord | null> {
  const q = dbOrPool(db)
  const id = String(definitionId || '').trim()
  if (!id) return null
  const [rows] = await q.query(
    `SELECT id, name, description, definition_json, created_at, updated_at
       FROM cultures
      WHERE JSON_UNQUOTE(JSON_EXTRACT(definition_json, '$.id')) = ?
      ORDER BY id DESC
      LIMIT 1`,
    [id]
  )
  const row = (rows as any[])[0]
  if (!row) return null
  const culture = toCultureRecord(row)
  const hydrated = hydrateCultureDefinitionWithFallback(culture)
  const definition = await projectCultureDefinitionSignals(culture.id, hydrated.definition, q)
  return {
    ...culture,
    definition,
    definition_source: hydrated.source,
    definition_validation_errors: hydrated.validationErrors,
  }
}

export async function createCulture(
  input: { name: string; description?: string | null; definition_json?: unknown },
  db?: DbLike
): Promise<number> {
  const q = dbOrPool(db)
  const name = String(input.name || '').trim()
  const description = input.description == null ? null : String(input.description).trim() || null
  const context = metadataContextFromCulture({ name })
  const candidateDefinition =
    input.definition_json == null
      ? createDefaultCultureDefinitionV1(context)
      : input.definition_json
  const definition = assertCultureDefinitionV1(candidateDefinition, context)
  const [result] = await q.query(
    `INSERT INTO cultures (name, description, definition_json)
     VALUES (?, ?, ?)`,
    [name, description, JSON.stringify(definition)]
  )
  const cultureId = Number((result as any).insertId || 0)
  if (cultureId > 0) {
    await syncCultureDefinitionSignals(cultureId, definition, q)
  }
  return cultureId
}

export async function saveCulture(
  cultureId: number,
  input: { name: string; description?: string | null; definition_json?: unknown },
  db: DbLike
): Promise<{
  culture: CultureRecord
  definition: CultureDefinitionV1
  definitionSource: CultureDefinitionHydrationSource
  definitionValidationErrors: CultureDefinitionValidationError[]
}> {
  const q = dbOrPool(db)
  const [rows] = await q.query(
    `SELECT id, name, description, definition_json, created_at, updated_at
       FROM cultures
      WHERE id = ?
      LIMIT 1 FOR UPDATE`,
    [cultureId]
  )
  const existingRow = (rows as any[])[0]
  if (!existingRow) {
    const notFoundError = new Error('culture_not_found') as Error & { code?: string }
    notFoundError.code = 'culture_not_found'
    throw notFoundError
  }

  const existing = toCultureRecord(existingRow)
  const nextName = String(input.name || existing.name || '').trim()
  const nextDescription =
    input.description === undefined
      ? existing.description
      : input.description == null
        ? null
        : String(input.description).trim() || null
  const metadataContext = metadataContextFromCulture({ name: nextName })

  let normalizedDefinition: CultureDefinitionV1
  let definitionSource: CultureDefinitionHydrationSource
  let definitionValidationErrors: CultureDefinitionValidationError[] = []
  if (input.definition_json !== undefined) {
    normalizedDefinition = assertCultureDefinitionV1(input.definition_json, metadataContext)
    definitionSource = 'stored'
  } else {
    const hydratedBeforeSave = hydrateCultureDefinitionWithFallback({
      name: nextName,
      definition_json: existing.definition_json,
    })
    normalizedDefinition = assertCultureDefinitionV1(hydratedBeforeSave.definition, metadataContext)
    definitionSource = hydratedBeforeSave.source
    definitionValidationErrors = hydratedBeforeSave.validationErrors
  }

  await q.query(
    `UPDATE cultures
        SET name = ?,
            description = ?,
            definition_json = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [nextName, nextDescription, JSON.stringify(normalizedDefinition), cultureId]
  )

  const projectedDefinition = await syncCultureDefinitionSignals(cultureId, normalizedDefinition, q)

  return {
    culture: {
      ...existing,
      name: nextName,
      description: nextDescription,
      definition_json: projectedDefinition,
    },
    definition: projectedDefinition,
    definitionSource,
    definitionValidationErrors,
  }
}
