import { getPool } from '../../db'
import {
  CULTURE_DISRUPTION_SIGNALS,
  CULTURE_POSITIVE_SIGNALS,
} from '../cultures/types'
import {
  deriveSignalClassification,
  getKnownSignalClassification,
  listDeferredSignalIdAliases,
} from './classification'
import * as repo from './repo'
import type {
  ModerationSignalClassificationBackfillResult,
  ModerationSignalClassificationCoverage,
  ModerationSignalSeed,
  ModerationSignalUpsertInput,
  ModerationSignalWithUsage,
} from './types'

function parseJsonObjectCell(value: unknown): Record<string, unknown> | null {
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

function replaceSignalIdInStringArray(values: unknown, fromSignalId: string, toSignalId: string): {
  next: string[]
  changed: boolean
} {
  if (!Array.isArray(values)) return { next: [], changed: false }
  const next: string[] = []
  let changed = false
  for (const value of values) {
    const candidate = String(value || '').trim()
    if (!candidate) continue
    const rewritten = candidate === fromSignalId ? toSignalId : candidate
    if (rewritten !== candidate) changed = true
    if (!next.includes(rewritten)) next.push(rewritten)
  }
  if (next.length !== values.length) changed = true
  return { next, changed }
}

function rewriteRuleAiSpecSignalId(
  value: unknown,
  fromSignalId: string,
  toSignalId: string
): { next: Record<string, unknown> | null; changed: boolean } {
  const aiSpec = parseJsonObjectCell(value)
  if (!aiSpec) return { next: aiSpec, changed: false }
  let changed = false
  const next: Record<string, unknown> = { ...aiSpec }

  if (Array.isArray(aiSpec.signal_ids)) {
    const rewritten = replaceSignalIdInStringArray(aiSpec.signal_ids, fromSignalId, toSignalId)
    next.signal_ids = rewritten.next
    changed = changed || rewritten.changed
  }

  if (aiSpec.signals && typeof aiSpec.signals === 'object' && !Array.isArray(aiSpec.signals)) {
    const nextSignals: Record<string, unknown> = { ...(aiSpec.signals as Record<string, unknown>) }
    for (const [key, entry] of Object.entries(aiSpec.signals as Record<string, unknown>)) {
      if (!Array.isArray(entry)) continue
      const rewritten = replaceSignalIdInStringArray(entry, fromSignalId, toSignalId)
      nextSignals[key] = rewritten.next
      changed = changed || rewritten.changed
    }
    next.signals = nextSignals
  }

  return { next, changed }
}

function rewriteCultureDefinitionSignalId(
  value: unknown,
  fromSignalId: string,
  toSignalId: string
): { next: Record<string, unknown> | null; changed: boolean } {
  const definition = parseJsonObjectCell(value)
  if (!definition) return { next: definition, changed: false }
  let changed = false
  const next: Record<string, unknown> = { ...definition }

  if (Array.isArray(definition.positive_signals)) {
    const rewritten = replaceSignalIdInStringArray(definition.positive_signals, fromSignalId, toSignalId)
    next.positive_signals = rewritten.next
    changed = changed || rewritten.changed
  }
  if (Array.isArray(definition.disruption_signals)) {
    const rewritten = replaceSignalIdInStringArray(definition.disruption_signals, fromSignalId, toSignalId)
    next.disruption_signals = rewritten.next
    changed = changed || rewritten.changed
  }

  return { next, changed }
}

function titleizeSignalId(signalId: string): string {
  return String(signalId || '')
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

const EXTRA_BASELINE_SIGNALS: ModerationSignalSeed[] = [
  {
    signal_id: 'factual_assertion',
    label: 'Factual Assertion',
    short_description: 'A claim presented as a factual statement rather than opinion or speculation.',
    long_description:
      'Use when content makes a concrete factual claim that can reasonably require support, verification, or attribution.',
    status: 'active',
    metadata_json: { seed_sources: ['moderation_v2_contract'] },
  },
  {
    signal_id: 'qualified_language',
    label: 'Qualified Language',
    short_description: 'Language that clearly qualifies uncertainty, scope, or confidence.',
    long_description:
      'Use when the speaker signals uncertainty or caveat through phrasing such as may, seems, appears, or according to.',
    status: 'active',
    metadata_json: { seed_sources: ['moderation_v2_contract'] },
  },
  {
    signal_id: 'assertive_language',
    label: 'Assertive Language',
    short_description: 'Language that states a claim with strong certainty or authority.',
    long_description:
      'Use when content presents a claim in a firm or declarative way that increases its perceived certainty.',
    status: 'active',
    metadata_json: { seed_sources: ['moderation_v2_contract'] },
  },
  {
    signal_id: 'direct_identifiers',
    label: 'Direct Identifiers',
    short_description: 'Explicit identifying information such as address, phone number, or other direct contact details.',
    long_description:
      'Use when content includes information that can directly identify or locate a person, such as home address or personal phone number.',
    status: 'active',
    metadata_json: { seed_sources: ['moderation_v2_contract'] },
  },
  {
    signal_id: 'indirect_identifiers',
    label: 'Indirect Identifiers',
    short_description: 'Combinations of details that can help identify a person indirectly.',
    long_description:
      'Use when content combines breadcrumbs like schedule, location, or contextual identity hints that may enable identification.',
    status: 'active',
    metadata_json: { seed_sources: ['moderation_v2_contract'] },
  },
]

export function listBaselineSignalSeeds(): ModerationSignalSeed[] {
  const merged = new Map<string, ModerationSignalSeed>()

  const append = (seed: ModerationSignalSeed) => {
    const signalId = String(seed.signal_id || '').trim()
    if (!signalId) return
    const existing = merged.get(signalId)
    const nextSources = new Set<string>(
      Array.isArray((existing?.metadata_json as any)?.seed_sources)
        ? (((existing?.metadata_json as any)?.seed_sources || []) as string[])
        : []
    )
    const incomingSources = Array.isArray((seed.metadata_json as any)?.seed_sources)
      ? (((seed.metadata_json as any)?.seed_sources || []) as string[])
      : []
    for (const source of incomingSources) nextSources.add(String(source))
    merged.set(signalId, {
      signal_id: signalId,
      label: seed.label || existing?.label || titleizeSignalId(signalId),
      short_description: seed.short_description ?? existing?.short_description ?? null,
      long_description: seed.long_description ?? existing?.long_description ?? null,
      polarity: seed.polarity ?? existing?.polarity ?? getKnownSignalClassification(signalId)?.polarity ?? null,
      signal_family:
        seed.signal_family ??
        existing?.signal_family ??
        getKnownSignalClassification(signalId)?.signal_family ??
        null,
      status: seed.status || existing?.status || 'active',
      metadata_json: {
        seed_sources: Array.from(nextSources),
      },
    })
  }

  for (const signalId of CULTURE_POSITIVE_SIGNALS) {
    append({
      signal_id: signalId,
      label: titleizeSignalId(signalId),
      polarity: getKnownSignalClassification(signalId)?.polarity ?? 'positive',
      signal_family: getKnownSignalClassification(signalId)?.signal_family ?? 'tone_positive',
      short_description: null,
      long_description: null,
      status: 'active',
      metadata_json: { seed_sources: ['culture_positive'] },
    })
  }
  for (const signalId of CULTURE_DISRUPTION_SIGNALS) {
    append({
      signal_id: signalId,
      label: titleizeSignalId(signalId),
      polarity: getKnownSignalClassification(signalId)?.polarity ?? 'disruptive',
      signal_family: getKnownSignalClassification(signalId)?.signal_family ?? 'discourse_quality',
      short_description: null,
      long_description: null,
      status: 'active',
      metadata_json: { seed_sources: ['culture_disruption'] },
    })
  }
  for (const seed of EXTRA_BASELINE_SIGNALS) append(seed)

  return Array.from(merged.values()).sort((a, b) => a.label.localeCompare(b.label))
}

export async function ensureBaselineSignals(): Promise<{
  seeded: number
  total: number
}> {
  const seeds = listBaselineSignalSeeds()
  for (const seed of seeds) {
    await repo.upsertSignal(seed)
  }
  return {
    seeded: seeds.length,
    total: seeds.length,
  }
}

export async function getSignalRegistryOverview(): Promise<{
  counts: Awaited<ReturnType<typeof repo.getSignalRegistryCounts>>
  signals: ModerationSignalWithUsage[]
}> {
  const [counts, signals] = await Promise.all([
    repo.getSignalRegistryCounts(),
    repo.listSignals({ status: 'all', limit: 24 }),
  ])
  return { counts, signals }
}

export async function listSignalsForAdmin(params?: Parameters<typeof repo.listSignals>[0]) {
  return repo.listSignals(params)
}

export async function getSignalAdminDetail(signalId: string) {
  const [signal, usage] = await Promise.all([
    repo.getSignalById(signalId),
    repo.getSignalUsageDetail(signalId),
  ])
  return {
    signal,
    usage,
  }
}

export async function saveSignal(input: ModerationSignalUpsertInput) {
  return repo.upsertSignal(input)
}

export async function saveSignalWithPossibleRename(input: {
  existingSignalId: string
  next: ModerationSignalUpsertInput
}): Promise<{ signal: ModerationSignalWithUsage; renamed: boolean; previousSignalId: string }> {
  const db = getPool() as any
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    const existing = await repo.getSignalById(input.existingSignalId, conn)
    if (!existing) {
      const err = new Error('signal_not_found') as Error & { code?: string }
      err.code = 'signal_not_found'
      throw err
    }

    const targetSignalId = repo.normalizeSignalIdInput(String(input.next.signal_id || ''))
    if (!targetSignalId) throw new Error('invalid_signal_id')
    const renamed = targetSignalId !== existing.signal_id

    if (renamed) {
      const collision = await repo.getSignalById(targetSignalId, conn)
      if (collision && collision.signal_id !== existing.signal_id) {
        const err = new Error('duplicate_signal_id') as Error & { code?: string }
        err.code = 'duplicate_signal_id'
        throw err
      }
    }

    await repo.upsertSignal(
      {
        ...input.next,
        signal_id: targetSignalId,
      },
      conn
    )

    if (renamed) {
      await conn.query(`UPDATE rule_signals SET signal_id = ? WHERE signal_id = ?`, [
        targetSignalId,
        existing.signal_id,
      ])
      await conn.query(`UPDATE culture_positive_signals SET signal_id = ? WHERE signal_id = ?`, [
        targetSignalId,
        existing.signal_id,
      ])
      await conn.query(`UPDATE culture_disruption_signals SET signal_id = ? WHERE signal_id = ?`, [
        targetSignalId,
        existing.signal_id,
      ])

      const [versionRows] = await conn.query(
        `SELECT id, ai_spec_json FROM rule_versions WHERE ai_spec_json IS NOT NULL`
      )
      for (const row of versionRows as any[]) {
        const rewritten = rewriteRuleAiSpecSignalId(row.ai_spec_json, existing.signal_id, targetSignalId)
        if (!rewritten.changed || !rewritten.next) continue
        await conn.query(`UPDATE rule_versions SET ai_spec_json = ? WHERE id = ?`, [
          JSON.stringify(rewritten.next),
          Number(row.id),
        ])
      }

      const [draftRows] = await conn.query(
        `SELECT rule_id, ai_spec_json FROM rule_drafts WHERE ai_spec_json IS NOT NULL`
      )
      for (const row of draftRows as any[]) {
        const rewritten = rewriteRuleAiSpecSignalId(row.ai_spec_json, existing.signal_id, targetSignalId)
        if (!rewritten.changed || !rewritten.next) continue
        await conn.query(`UPDATE rule_drafts SET ai_spec_json = ? WHERE rule_id = ?`, [
          JSON.stringify(rewritten.next),
          Number(row.rule_id),
        ])
      }

      const [cultureRows] = await conn.query(
        `SELECT id, definition_json FROM cultures WHERE definition_json IS NOT NULL`
      )
      for (const row of cultureRows as any[]) {
        const rewritten = rewriteCultureDefinitionSignalId(
          row.definition_json,
          existing.signal_id,
          targetSignalId
        )
        if (!rewritten.changed || !rewritten.next) continue
        await conn.query(`UPDATE cultures SET definition_json = ? WHERE id = ?`, [
          JSON.stringify(rewritten.next),
          Number(row.id),
        ])
      }

      await conn.query(`DELETE FROM moderation_signals WHERE signal_id = ?`, [existing.signal_id])
    }

    const signal = await repo.getSignalById(targetSignalId, conn)
    if (!signal) throw new Error('failed_to_save_signal')
    await conn.commit()
    return {
      signal,
      renamed,
      previousSignalId: existing.signal_id,
    }
  } catch (err) {
    try {
      await conn.rollback()
    } catch {}
    throw err
  } finally {
    try {
      conn.release()
    } catch {}
  }
}

export async function verifySignalClassificationCoverage(): Promise<ModerationSignalClassificationCoverage> {
  const rows = await repo.listSignalClassificationSnapshots()
  const resolvedRows = rows.filter((row) =>
    Boolean(
      deriveSignalClassification({
        signalId: row.signal_id,
        metadataJson: row.metadata_json,
        polarity: row.polarity,
        signalFamily: row.signal_family,
      })
    )
  )
  const unresolved = rows
    .filter((row) => !resolvedRows.includes(row))
    .map((row) => ({
      signal_id: row.signal_id,
      label: row.label,
      reason: 'missing_classification' as const,
    }))

  const missingPolarity = rows.filter((row) => !String(row.polarity || '').trim()).length
  const missingSignalFamily = rows.filter((row) => !String(row.signal_family || '').trim()).length
  const missingAny = rows.filter(
    (row) =>
      !String(row.polarity || '').trim() || !String(row.signal_family || '').trim()
  ).length

  return {
    total: rows.length,
    classified: resolvedRows.length,
    missing_polarity: missingPolarity,
    missing_signal_family: missingSignalFamily,
    missing_any: missingAny,
    unresolved,
  }
}

export async function backfillSignalClassificationCoverage(): Promise<ModerationSignalClassificationBackfillResult> {
  const rows = await repo.listSignalClassificationSnapshots()
  let updated = 0
  let unchanged = 0

  for (const row of rows) {
    const classification = deriveSignalClassification({
      signalId: row.signal_id,
      metadataJson: row.metadata_json,
      polarity: row.polarity,
      signalFamily: row.signal_family,
    })
    if (!classification) continue
    if (row.polarity === classification.polarity && row.signal_family === classification.signal_family) {
      unchanged += 1
      continue
    }
    await repo.updateSignalClassification(row.signal_id, classification.polarity, classification.signal_family)
    updated += 1
  }

  const coverage = await verifySignalClassificationCoverage()

  return {
    total: rows.length,
    updated,
    unchanged,
    coverage,
    deferred_signal_id_aliases: listDeferredSignalIdAliases(rows.map((row) => row.signal_id)),
  }
}

export async function ensureSignalsExist(
  signalIds: Iterable<string>,
  source: string
): Promise<string[]> {
  const ensured = new Set<string>()
  for (const rawSignalId of signalIds) {
    const candidate = String(rawSignalId || '').trim()
    if (!candidate) continue
    const existing = await repo.getSignalById(candidate)
    if (existing) {
      ensured.add(existing.signal_id)
      continue
    }
    const saved = await repo.upsertSignal({
      signal_id: candidate,
      label: candidate
        .split(/[_-]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' '),
      polarity:
        getKnownSignalClassification(candidate)?.polarity ||
        (source.toLowerCase().includes('positive') ? 'positive' : 'disruptive'),
      signal_family:
        getKnownSignalClassification(candidate)?.signal_family ||
        (source.toLowerCase().includes('positive') ? 'tone_positive' : 'discourse_quality'),
      status: 'draft',
      metadata_json: { backfilled_from: source },
    })
    ensured.add(saved.signal_id)
  }
  return Array.from(ensured)
}
