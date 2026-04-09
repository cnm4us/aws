import {
  buildJudgeIdempotencyKey,
  buildMeasureIdempotencyKey,
  buildReviewIdempotencyKey,
  moderationJudgeRequestSchema,
  moderationJudgeResponseSchema,
  moderationMeasureRequestSchema,
  moderationMeasureResponseSchema,
  moderationReviewRequestSchema,
  moderationReviewResponseSchema,
} from '../src/features/moderation-v2'
import type {
  ModerationJudgeRequestBody,
  ModerationMeasureRequestBody,
  ModerationReviewRequestBody,
} from '../src/features/moderation-v2'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const evaluationId = '01HZX3N2Q7N0B1YJQ4W5Z6K7M8'

const validMeasureRequest: ModerationMeasureRequestBody = {
  request_id: 'req_12345',
  content: {
    content_id: 'video_987',
    content_type: 'video',
    language: 'en',
    segment: {
      start_seconds: 0,
      end_seconds: 180,
      vtt_text:
        'WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nThis city has the highest crime rate in the country.\n',
    },
  },
  report: {
    report_id: 456,
    reporter_user_id: 111,
    reason_code: 'misinformation',
    free_text: 'This claim seems unsupported.',
  },
  rules: [
    {
      issue_id: 'unsupported_factual_assertion',
      issue_class: 'cultural',
      rule_version: 'v1',
      ai_spec: {
        signals: { claim_type: ['factual_assertion'] },
      },
    },
    {
      issue_id: 'doxxing',
      issue_class: 'global_safety',
      rule_version: 'v1',
      ai_spec: {
        signals: { direct_identifiers: ['home_address'] },
      },
    },
  ],
  options: {
    max_assessments: 20,
    include_non_matches: false,
  },
}

const validMeasure = moderationMeasureRequestSchema.safeParse(validMeasureRequest)
assert(validMeasure.success, `Expected valid measure request: ${JSON.stringify(validMeasure.error?.issues || [])}`)

const invalidMeasure = moderationMeasureRequestSchema.safeParse({
  ...validMeasureRequest,
  content: { ...validMeasureRequest.content, segment: { ...validMeasureRequest.content.segment, end_seconds: -1 } },
})
assert(!invalidMeasure.success, 'Expected invalid measure request to fail')

const validMeasureResponse = {
  request_id: 'req_12345',
  evaluation_id: evaluationId,
  report_id: 456,
  content_id: 'video_987',
  assessments: [
    {
      issue_id: 'unsupported_factual_assertion',
      issue_class: 'cultural',
      rule_version: 'v1',
      matched: true,
      severity: 'moderate',
      confidence: 0.76,
      confidence_band: 'medium',
      signals_detected: ['factual_assertion', 'absence_of_attribution', 'assertive_language'],
      signals_not_detected: ['source_attribution', 'qualified_language'],
      evidence: [
        {
          evidence_id: 'e1',
          start_seconds: 0,
          end_seconds: 4,
          text: 'This city has the highest crime rate in the country.',
        },
      ],
      notes: 'Claim presented as factual without supporting attribution.',
    },
  ],
  measurement_meta: {
    model_name: 'measurement-model-v1',
    measured_at: new Date().toISOString(),
    duration_ms: 842,
  },
}

const validMeasured = moderationMeasureResponseSchema.safeParse(validMeasureResponse)
assert(validMeasured.success, `Expected valid measure response: ${JSON.stringify(validMeasured.error?.issues || [])}`)

const invalidMeasureResponse = moderationMeasureResponseSchema.safeParse({
  ...validMeasureResponse,
  assessments: [{ ...validMeasureResponse.assessments[0], confidence: 0.95, confidence_band: 'medium' }],
})
assert(!invalidMeasureResponse.success, 'Expected invalid measure response to fail confidence band check')

const validJudgeRequest: ModerationJudgeRequestBody = {
  request_id: 'req_12345',
  evaluation_id: evaluationId,
  culture_id: 'news_journalism',
  policy_profile_id: 'moderation_default',
  options: {
    allow_global_safety_override_by_culture: false,
  },
}

const validJudge = moderationJudgeRequestSchema.safeParse(validJudgeRequest)
assert(validJudge.success, `Expected valid judge request: ${JSON.stringify(validJudge.error?.issues || [])}`)

const invalidJudge = moderationJudgeRequestSchema.safeParse({
  ...validJudgeRequest,
  canonical_maps: { severity_map: { mild: 1 } },
})
assert(!invalidJudge.success, 'Expected invalid judge request to reject canonical_maps')

const validJudgeResponse = {
  request_id: 'req_12345',
  evaluation_id: evaluationId,
  report_id: 456,
  content_id: 'video_987',
  decision_reasoning: {
    issue_summaries: [
      {
        issue_id: 'unsupported_factual_assertion',
        issue_class: 'cultural',
        matched: true,
        severity: 'moderate',
        severity_score: 2,
        confidence: 0.76,
        confidence_band: 'medium',
        evidence_refs: ['e1'],
      },
    ],
    dimension_impacts: [
      {
        issue_id: 'unsupported_factual_assertion',
        dimension_path: 'dimensions.credibility_expectation',
        culture_value: 'high',
        dimension_weight: 3,
        impact_score: 6,
        impact_level: 'high',
      },
    ],
    cultural_context: {
      culture_id: 'news_journalism',
      culture_name: 'News / Journalism',
      interaction_mode: 'broadcast',
      discourse_mode: 'structured',
    },
    confidence_analysis: {
      overall_confidence: 0.76,
      overall_confidence_band: 'medium',
      confidence_factors: ['clear factual assertion'],
    },
    reasoning_trace: ['Detected a factual assertion presented without attribution.'],
  },
  ai_judgment: {
    outcome: 'uphold',
    action_type: 'content_flag',
    primary_issue_id: 'unsupported_factual_assertion',
    primary_issue_class: 'cultural',
    severity_level: 'moderate',
    confidence: 0.76,
    confidence_band: 'medium',
    impact_score: 6,
    decision_basis: {
      severity_score: 2,
      dimension_weight: 3,
      threshold_applied: 'uphold',
    },
    alternative_outcomes_considered: [
      {
        outcome: 'dismiss',
        reason_rejected: 'impact score exceeds dismissal threshold',
      },
    ],
  },
  judgment_meta: {
    model_name: 'judgment-model-v1',
    judged_at: new Date().toISOString(),
    duration_ms: 311,
    policy_profile_id: 'moderation_default',
    policy_profile_version: 'v1',
    culture_id: 'news_journalism',
  },
}

const validJudged = moderationJudgeResponseSchema.safeParse(validJudgeResponse)
assert(validJudged.success, `Expected valid judge response: ${JSON.stringify(validJudged.error?.issues || [])}`)

const validReviewRequestAccept = {
  request_id: 'req_12345',
  evaluation_id: evaluationId,
  human_review: {
    decision: 'accept_ai',
  },
}
const validReviewAccept = moderationReviewRequestSchema.safeParse(validReviewRequestAccept)
assert(validReviewAccept.success, `Expected valid accept review request: ${JSON.stringify(validReviewAccept.error?.issues || [])}`)

const validReviewRequestOverride: ModerationReviewRequestBody = {
  request_id: 'req_12345',
  evaluation_id: evaluationId,
  human_review: {
    decision: 'override_ai',
    final_outcome: 'review',
    final_action_type: 'human_review',
    rationale:
      'The statement appears unsupported, but context suggests the speaker may be paraphrasing an external source.',
  },
}
const validReviewOverride = moderationReviewRequestSchema.safeParse(validReviewRequestOverride)
assert(validReviewOverride.success, `Expected valid override review request: ${JSON.stringify(validReviewOverride.error?.issues || [])}`)

const invalidReviewOverride = moderationReviewRequestSchema.safeParse({
  request_id: 'req_12345',
  evaluation_id: evaluationId,
  human_review: {
    decision: 'override_ai',
    final_outcome: 'review',
    final_action_type: 'human_review',
    rationale: '',
  },
})
assert(!invalidReviewOverride.success, 'Expected override review request without rationale to fail')

const validReviewResponse = moderationReviewResponseSchema.safeParse({
  request_id: 'req_12345',
  evaluation_id: evaluationId,
  review_status: 'completed',
  final_disposition: {
    source: 'human_override',
    outcome: 'review',
    action_type: 'human_review',
  },
  review_meta: {
    reviewed_at: new Date().toISOString(),
    reviewer_user_id: 222,
  },
})
assert(validReviewResponse.success, `Expected valid review response: ${JSON.stringify(validReviewResponse.error?.issues || [])}`)

const keyA = buildMeasureIdempotencyKey(validMeasureRequest)
const keyB = buildMeasureIdempotencyKey(validMeasureRequest)
assert(keyA === keyB, 'Measure idempotency key should be deterministic')
const keyC = buildJudgeIdempotencyKey(validJudgeRequest)
const keyD = buildReviewIdempotencyKey(validReviewRequestOverride)
assert(keyA !== keyC, 'Measure and judge idempotency keys should differ')
assert(keyC !== keyD, 'Judge and review idempotency keys should differ')

console.log('[moderation-v2-contract-smoke] ok')
