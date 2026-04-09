export const MODERATION_SEVERITY_LEVELS = [
  'none',
  'mild',
  'moderate',
  'escalated',
] as const

export const MODERATION_CONFIDENCE_BANDS = [
  'low',
  'medium',
  'high',
] as const

export const MODERATION_OUTCOMES = [
  'dismiss',
  'soft_action',
  'review',
  'uphold',
] as const

export const MODERATION_ACTION_TYPES = [
  'none',
  'content_flag',
  'content_hide',
  'content_remove',
  'visibility_restrict',
  'warning_issue',
  'account_temp_suspend',
  'account_perm_suspend',
  'human_review',
  'escalate_trust_safety',
  'escalate_legal',
] as const

export const MODERATION_REVIEW_DECISIONS = [
  'accept_ai',
  'override_ai',
] as const

export type ModerationSeverity = (typeof MODERATION_SEVERITY_LEVELS)[number]
export type ModerationConfidenceBand = (typeof MODERATION_CONFIDENCE_BANDS)[number]
export type ModerationOutcome = (typeof MODERATION_OUTCOMES)[number]
export type ModerationActionType = (typeof MODERATION_ACTION_TYPES)[number]
export type ModerationReviewDecision = (typeof MODERATION_REVIEW_DECISIONS)[number]

