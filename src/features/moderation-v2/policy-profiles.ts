import { DomainError } from '../../core/errors'
import { getPool } from '../../db'

type DbLike = { query: (sql: string, params?: any[]) => Promise<any> }

export type ModerationPolicyProfile = {
  id: string
  version: string
  severity_map: Record<'none' | 'mild' | 'moderate' | 'escalated', number>
  confidence_bands: Record<'low' | 'medium' | 'high', { min: number; max: number }>
  tolerance_weight_map: Record<'very_low' | 'low' | 'medium' | 'high', number>
  outcome_thresholds: {
    dismiss: { max_score: number }
    soft_action: { min_score: number; max_score: number }
    review: { min_score: number; max_score: number }
    uphold: { min_score: number }
  }
  confidence_rules: {
    low: 'review'
    medium: 'allow_threshold'
    high: 'allow_threshold'
  }
}

const DEFAULT_PROFILE: ModerationPolicyProfile = {
  id: 'moderation_default',
  version: 'v1',
  severity_map: {
    none: 0,
    mild: 1,
    moderate: 2,
    escalated: 3,
  },
  confidence_bands: {
    low: { min: 0.0, max: 0.59 },
    medium: { min: 0.6, max: 0.79 },
    high: { min: 0.8, max: 1.0 },
  },
  tolerance_weight_map: {
    very_low: 3.0,
    low: 2.0,
    medium: 1.0,
    high: 0.5,
  },
  outcome_thresholds: {
    dismiss: { max_score: 1 },
    soft_action: { min_score: 2, max_score: 3 },
    review: { min_score: 4, max_score: 5 },
    uphold: { min_score: 6 },
  },
  confidence_rules: {
    low: 'review',
    medium: 'allow_threshold',
    high: 'allow_threshold',
  },
}

export type ModerationPolicyProfileSeed = {
  policy_profile_id: string
  version: string
  display_name: string
  description: string
  status: 'active' | 'inactive'
  is_default: boolean
  profile: ModerationPolicyProfile
}

export const DEFAULT_MODERATION_POLICY_PROFILE_SEEDS: ModerationPolicyProfileSeed[] = [
  {
    policy_profile_id: DEFAULT_PROFILE.id,
    version: DEFAULT_PROFILE.version,
    display_name: 'Moderation Default',
    description: 'Baseline moderation judgment profile for dev and initial rollout.',
    status: 'active',
    is_default: true,
    profile: DEFAULT_PROFILE,
  },
]

const STATIC_BY_ID = new Map<string, ModerationPolicyProfile>(
  DEFAULT_MODERATION_POLICY_PROFILE_SEEDS.map((row) => [row.policy_profile_id, row.profile])
)

function cloneProfile(profile: ModerationPolicyProfile): ModerationPolicyProfile {
  return JSON.parse(JSON.stringify(profile)) as ModerationPolicyProfile
}

function parseProfileJson(value: unknown): ModerationPolicyProfile | null {
  if (!value) return null
  const parsed =
    typeof value === 'string'
      ? (() => {
          try {
            return JSON.parse(value)
          } catch {
            return null
          }
        })()
      : value
  if (!parsed || typeof parsed !== 'object') return null
  const profile = parsed as ModerationPolicyProfile
  if (!profile.id || !profile.version) return null
  return profile
}

function isMissingPolicyProfileTableError(err: unknown): boolean {
  const code = String((err as any)?.code || '').trim()
  const message = String((err as any)?.message || '').toLowerCase()
  return code === 'ER_NO_SUCH_TABLE' || message.includes('moderation_policy_profiles')
}

export async function listModerationPolicyProfiles(
  db?: DbLike
): Promise<
  Array<{
    policy_profile_id: string
    version: string
    display_name: string | null
    description: string | null
    status: 'active' | 'inactive'
    is_default: boolean
    updated_at: string
  }>
> {
  const q = (db as any) || getPool()
  try {
    const [rows] = await q.query(
      `SELECT policy_profile_id, version, display_name, description, status, is_default, updated_at
         FROM moderation_policy_profiles
        ORDER BY is_default DESC,
                 policy_profile_id ASC,
                 CAST(SUBSTRING(version, 2) AS UNSIGNED) DESC,
                 id DESC`
    )
    return Array.isArray(rows)
      ? (rows as any[]).map((row) => ({
          policy_profile_id: String(row.policy_profile_id),
          version: String(row.version),
          display_name: row.display_name == null ? null : String(row.display_name),
          description: row.description == null ? null : String(row.description),
          status: String(row.status) as 'active' | 'inactive',
          is_default: Number(row.is_default || 0) === 1,
          updated_at: String(row.updated_at),
        }))
      : []
  } catch (err) {
    if (isMissingPolicyProfileTableError(err)) {
      return DEFAULT_MODERATION_POLICY_PROFILE_SEEDS.map((row) => ({
        policy_profile_id: row.policy_profile_id,
        version: row.version,
        display_name: row.display_name,
        description: row.description,
        status: row.status,
        is_default: row.is_default,
        updated_at: '',
      }))
    }
    throw err
  }
}

export async function seedDefaultModerationPolicyProfiles(
  db?: DbLike
): Promise<{ insertedOrUpdated: number; seeds: ModerationPolicyProfileSeed[] }> {
  const q = (db as any) || getPool()
  let insertedOrUpdated = 0
  for (const seed of DEFAULT_MODERATION_POLICY_PROFILE_SEEDS) {
    const [result] = await q.query(
      `INSERT INTO moderation_policy_profiles
        (policy_profile_id, version, display_name, description, status, is_default, profile_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         display_name = VALUES(display_name),
         description = VALUES(description),
         status = VALUES(status),
         is_default = VALUES(is_default),
         profile_json = VALUES(profile_json),
         updated_at = CURRENT_TIMESTAMP`,
      [
        seed.policy_profile_id,
        seed.version,
        seed.display_name,
        seed.description,
        seed.status,
        seed.is_default ? 1 : 0,
        JSON.stringify(seed.profile),
      ]
    )
    insertedOrUpdated += Number((result as any)?.affectedRows || 0) > 0 ? 1 : 0
  }
  return {
    insertedOrUpdated,
    seeds: DEFAULT_MODERATION_POLICY_PROFILE_SEEDS.map((row) => ({
      ...row,
      profile: cloneProfile(row.profile),
    })),
  }
}

export async function resolveModerationPolicyProfile(policyProfileId: string, db?: DbLike): Promise<ModerationPolicyProfile> {
  const key = String(policyProfileId || '').trim().toLowerCase()
  if (!key) throw new DomainError('policy_profile_not_found', 'policy_profile_not_found', 404)

  const q = (db as any) || getPool()
  try {
    const [rows] = await q.query(
      `SELECT profile_json
         FROM moderation_policy_profiles
        WHERE policy_profile_id = ?
          AND status = 'active'
        ORDER BY is_default DESC,
                 CAST(SUBSTRING(version, 2) AS UNSIGNED) DESC,
                 id DESC
        LIMIT 1`,
      [key]
    )
    const row = Array.isArray(rows) ? (rows as any[])[0] : null
    const storedProfile = parseProfileJson(row?.profile_json)
    if (storedProfile) return cloneProfile(storedProfile)
  } catch (err) {
    if (!isMissingPolicyProfileTableError(err)) throw err
  }

  const fallback = STATIC_BY_ID.get(key)
  if (!fallback) throw new DomainError('policy_profile_not_found', 'policy_profile_not_found', 404)
  return cloneProfile(fallback)
}
