import { DomainError } from '../../core/errors'

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

const BY_ID = new Map<string, ModerationPolicyProfile>([[DEFAULT_PROFILE.id, DEFAULT_PROFILE]])

export function resolveModerationPolicyProfile(policyProfileId: string): ModerationPolicyProfile {
  const key = String(policyProfileId || '').trim().toLowerCase()
  const profile = BY_ID.get(key)
  if (!profile) throw new DomainError('policy_profile_not_found', 'policy_profile_not_found', 404)
  return profile
}

