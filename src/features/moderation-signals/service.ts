import {
  CULTURE_DISRUPTION_SIGNALS,
  CULTURE_POSITIVE_SIGNALS,
} from '../cultures/types'
import * as repo from './repo'
import type {
  ModerationSignalSeed,
  ModerationSignalUpsertInput,
  ModerationSignalWithUsage,
} from './types'

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
