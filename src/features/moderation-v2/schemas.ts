import { z } from 'zod'
import {
  MODERATION_ACTION_TYPES,
  MODERATION_CONFIDENCE_BANDS,
  MODERATION_OUTCOMES,
  MODERATION_REVIEW_DECISIONS,
  MODERATION_SEVERITY_LEVELS,
} from './enums'

const REQUEST_ID_RE = /^[a-zA-Z0-9:_-]{6,120}$/
const REF_RE = /^[a-zA-Z0-9:_-]{1,128}$/
const CULTURE_KEY_RE = /^[a-z][a-z0-9_-]{1,63}$/
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/

const confidenceBandThresholds: Record<(typeof MODERATION_CONFIDENCE_BANDS)[number], { min: number; max: number }> = {
  low: { min: 0, max: 0.59 },
  medium: { min: 0.6, max: 0.79 },
  high: { min: 0.8, max: 1.0 },
}

function matchesConfidenceBand(
  confidence: number,
  band: (typeof MODERATION_CONFIDENCE_BANDS)[number]
): boolean {
  const range = confidenceBandThresholds[band]
  return confidence >= range.min && confidence <= range.max
}

export const moderationRequestIdSchema = z.string().regex(REQUEST_ID_RE, 'invalid_request_id')
export const moderationRefSchema = z.union([
  z.number().int().positive(),
  z.string().regex(REF_RE, 'invalid_reference'),
])
export const moderationEvaluationIdSchema = z.string().regex(ULID_RE, 'invalid_evaluation_id')
export const moderationCultureIdSchema = z.string().regex(CULTURE_KEY_RE, 'invalid_culture_id')
export const moderationPolicyProfileIdSchema = z.string().regex(CULTURE_KEY_RE, 'invalid_policy_profile_id')
export const moderationSeveritySchema = z.enum(MODERATION_SEVERITY_LEVELS)
export const moderationConfidenceBandSchema = z.enum(MODERATION_CONFIDENCE_BANDS)
export const moderationOutcomeSchema = z.enum(MODERATION_OUTCOMES)
export const moderationActionTypeSchema = z.enum(MODERATION_ACTION_TYPES)
export const moderationReviewDecisionSchema = z.enum(MODERATION_REVIEW_DECISIONS)
export const moderationIssueClassSchema = z.enum(['global_safety', 'cultural', 'unknown'])
export const moderationContentTypeSchema = z.enum(['video', 'comment', 'account'])

const moderationEvidenceSchema = z
  .object({
    evidence_id: z.string().regex(REF_RE, 'invalid_evidence_id'),
    start_seconds: z.number().min(0),
    end_seconds: z.number().min(0),
    text: z.string().trim().min(1).max(2000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.end_seconds < value.start_seconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end_seconds'],
        message: 'end_seconds_before_start_seconds',
      })
    }
  })

const moderationMeasureRuleSchema = z
  .object({
    issue_id: z.string().regex(REF_RE, 'invalid_issue_id'),
    issue_class: moderationIssueClassSchema,
    rule_version: z.string().trim().min(1).max(32),
    ai_spec: z.record(z.any()),
  })
  .strict()

export const moderationMeasureRequestSchema = z
  .object({
    request_id: moderationRequestIdSchema.optional(),
    content: z
      .object({
        content_id: moderationRefSchema,
        content_type: moderationContentTypeSchema,
        language: z.string().trim().min(2).max(16).optional(),
        segment: z
          .object({
            start_seconds: z.number().min(0),
            end_seconds: z.number().min(0),
            vtt_text: z.string().trim().min(1).max(50000),
          })
          .strict()
          .superRefine((value, ctx) => {
            if (value.end_seconds < value.start_seconds) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['end_seconds'],
                message: 'end_seconds_before_start_seconds',
              })
            }
          }),
      })
      .strict(),
    report: z
      .object({
        report_id: moderationRefSchema,
        reporter_user_id: moderationRefSchema.nullable().optional(),
        reason_code: z.string().trim().max(64).nullable().optional(),
        free_text: z.string().trim().max(2000).nullable().optional(),
      })
      .strict(),
    rules: z.array(moderationMeasureRuleSchema).min(1).max(100),
    options: z
      .object({
        max_assessments: z.number().int().min(1).max(200).optional(),
        include_non_matches: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

const moderationAssessmentSchema = z
  .object({
    issue_id: z.string().regex(REF_RE, 'invalid_issue_id'),
    issue_class: moderationIssueClassSchema,
    rule_version: z.string().trim().min(1).max(32),
    matched: z.boolean(),
    severity: moderationSeveritySchema,
    confidence: z.number().min(0).max(1),
    confidence_band: moderationConfidenceBandSchema,
    signals_detected: z.array(z.string().trim().min(1).max(128)).max(100),
    signals_not_detected: z.array(z.string().trim().min(1).max(128)).max(100),
    evidence: z.array(moderationEvidenceSchema).max(20),
    notes: z.string().trim().max(4000).nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!matchesConfidenceBand(value.confidence, value.confidence_band)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confidence_band'],
        message: 'confidence_band_mismatch',
      })
    }
  })

export const moderationMeasureResponseSchema = z
  .object({
    request_id: moderationRequestIdSchema.nullable(),
    evaluation_id: moderationEvaluationIdSchema,
    report_id: moderationRefSchema,
    content_id: moderationRefSchema,
    assessments: z.array(moderationAssessmentSchema).max(200),
    measurement_meta: z
      .object({
        model_name: z.string().trim().min(1).max(128),
        measured_at: z.string().datetime({ offset: true }),
        duration_ms: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()

export const moderationJudgeRequestSchema = z
  .object({
    request_id: moderationRequestIdSchema.optional(),
    evaluation_id: moderationEvaluationIdSchema,
    culture_id: moderationCultureIdSchema,
    policy_profile_id: moderationPolicyProfileIdSchema,
    options: z
      .object({
        allow_global_safety_override_by_culture: z.literal(false).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

const moderationDecisionReasoningSchema = z
  .object({
    issue_summaries: z
      .array(
        z
          .object({
            issue_id: z.string().regex(REF_RE, 'invalid_issue_id'),
            issue_class: moderationIssueClassSchema,
            matched: z.boolean(),
            severity: moderationSeveritySchema,
            severity_score: z.number().min(0).max(100),
            confidence: z.number().min(0).max(1),
            confidence_band: moderationConfidenceBandSchema,
            evidence_refs: z.array(z.string().regex(REF_RE, 'invalid_evidence_ref')).max(50),
          })
          .strict()
          .superRefine((value, ctx) => {
            if (!matchesConfidenceBand(value.confidence, value.confidence_band)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['confidence_band'],
                message: 'confidence_band_mismatch',
              })
            }
          })
      )
      .max(200),
    dimension_impacts: z
      .array(
        z
          .object({
            issue_id: z.string().regex(REF_RE, 'invalid_issue_id'),
            dimension_path: z.string().trim().min(1).max(200),
            culture_value: z.string().trim().min(1).max(120),
            dimension_weight: z.number().min(0).max(100),
            impact_score: z.number().min(0).max(1000),
            impact_level: moderationConfidenceBandSchema,
          })
          .strict()
      )
      .max(400),
    cultural_context: z
      .object({
        culture_id: moderationCultureIdSchema,
        culture_name: z.string().trim().max(128).nullable().optional(),
        interaction_mode: z.string().trim().max(64).nullable().optional(),
        discourse_mode: z.string().trim().max(64).nullable().optional(),
      })
      .strict(),
    confidence_analysis: z
      .object({
        overall_confidence: z.number().min(0).max(1),
        overall_confidence_band: moderationConfidenceBandSchema,
        confidence_factors: z.array(z.string().trim().min(1).max(200)).max(50),
      })
      .strict()
      .superRefine((value, ctx) => {
        if (!matchesConfidenceBand(value.overall_confidence, value.overall_confidence_band)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['overall_confidence_band'],
            message: 'confidence_band_mismatch',
          })
        }
      }),
    reasoning_trace: z.array(z.string().trim().min(1).max(1000)).min(1).max(100),
  })
  .strict()

const moderationAiJudgmentSchema = z
  .object({
    outcome: moderationOutcomeSchema,
    action_type: moderationActionTypeSchema,
    primary_issue_id: z.string().regex(REF_RE, 'invalid_issue_id').nullable(),
    primary_issue_class: moderationIssueClassSchema,
    severity_level: moderationSeveritySchema,
    confidence: z.number().min(0).max(1),
    confidence_band: moderationConfidenceBandSchema,
    impact_score: z.number().min(0).max(1000),
    decision_basis: z.record(z.any()),
    alternative_outcomes_considered: z
      .array(
        z
          .object({
            outcome: moderationOutcomeSchema,
            reason_rejected: z.string().trim().min(1).max(1000),
          })
          .strict()
      )
      .max(20),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!matchesConfidenceBand(value.confidence, value.confidence_band)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confidence_band'],
        message: 'confidence_band_mismatch',
      })
    }
  })

export const moderationJudgeResponseSchema = z
  .object({
    request_id: moderationRequestIdSchema.nullable(),
    evaluation_id: moderationEvaluationIdSchema,
    report_id: moderationRefSchema,
    content_id: moderationRefSchema,
    decision_reasoning: moderationDecisionReasoningSchema,
    ai_judgment: moderationAiJudgmentSchema,
    judgment_meta: z
      .object({
        model_name: z.string().trim().min(1).max(128),
        judged_at: z.string().datetime({ offset: true }),
        duration_ms: z.number().int().nonnegative(),
        policy_profile_id: moderationPolicyProfileIdSchema,
        policy_profile_version: z.string().trim().min(1).max(32),
        culture_id: moderationCultureIdSchema,
      })
      .strict(),
  })
  .strict()

const moderationReviewAcceptSchema = z
  .object({
    decision: z.literal('accept_ai'),
    final_outcome: moderationOutcomeSchema.optional(),
    final_action_type: moderationActionTypeSchema.optional(),
    rationale: z.string().trim().max(4000).nullable().optional(),
  })
  .strict()

const moderationReviewOverrideSchema = z
  .object({
    decision: z.literal('override_ai'),
    final_outcome: moderationOutcomeSchema,
    final_action_type: moderationActionTypeSchema,
    rationale: z.string().trim().min(1).max(4000),
  })
  .strict()

export const moderationReviewRequestSchema = z
  .object({
    request_id: moderationRequestIdSchema.optional(),
    evaluation_id: moderationEvaluationIdSchema,
    human_review: z.discriminatedUnion('decision', [
      moderationReviewAcceptSchema,
      moderationReviewOverrideSchema,
    ]),
  })
  .strict()

export const moderationReviewResponseSchema = z
  .object({
    request_id: moderationRequestIdSchema.nullable(),
    evaluation_id: moderationEvaluationIdSchema,
    review_status: z.literal('completed'),
    final_disposition: z
      .object({
        source: z.enum(['ai_accepted', 'human_override']),
        outcome: moderationOutcomeSchema,
        action_type: moderationActionTypeSchema,
      })
      .strict(),
    review_meta: z
      .object({
        reviewed_at: z.string().datetime({ offset: true }),
        reviewer_user_id: z.number().int().positive(),
      })
      .strict(),
  })
  .strict()

export type ModerationMeasureRequestInput = z.input<typeof moderationMeasureRequestSchema>
export type ModerationMeasureRequest = z.infer<typeof moderationMeasureRequestSchema>
export type ModerationMeasureResponse = z.infer<typeof moderationMeasureResponseSchema>

export type ModerationJudgeRequestInput = z.input<typeof moderationJudgeRequestSchema>
export type ModerationJudgeRequest = z.infer<typeof moderationJudgeRequestSchema>
export type ModerationJudgeResponse = z.infer<typeof moderationJudgeResponseSchema>

export type ModerationReviewRequestInput = z.input<typeof moderationReviewRequestSchema>
export type ModerationReviewRequest = z.infer<typeof moderationReviewRequestSchema>
export type ModerationReviewResponse = z.infer<typeof moderationReviewResponseSchema>

