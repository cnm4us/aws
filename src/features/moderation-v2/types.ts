import type {
  ModerationActionType,
  ModerationConfidenceBand,
  ModerationOutcome,
  ModerationReviewDecision,
  ModerationSeverity,
} from './enums'

export type ModerationIssueClass = 'global_safety' | 'cultural' | 'unknown'
export type ModerationContentType = 'video' | 'comment' | 'account'

export type ModerationEvidence = {
  evidence_id: string
  start_seconds: number
  end_seconds: number
  text: string
}

export type ModerationMeasureRequestBody = {
  request_id?: string
  content: {
    content_id: string | number
    content_type: ModerationContentType
    language?: string
    segment: {
      start_seconds: number
      end_seconds: number
      vtt_text: string
    }
  }
  report: {
    report_id: string | number
    reporter_user_id?: string | number | null
    reason_code?: string | null
    free_text?: string | null
  }
  rules: Array<{
    issue_id: string
    issue_class: ModerationIssueClass
    rule_version: string
    ai_spec: Record<string, unknown>
  }>
  options?: {
    max_assessments?: number
    include_non_matches?: boolean
  }
}

export type ModerationMeasureResponseBody = {
  request_id: string | null
  evaluation_id: string
  report_id: string | number
  content_id: string | number
  assessments: Array<{
    issue_id: string
    issue_class: ModerationIssueClass
    rule_version: string
    matched: boolean
    severity: ModerationSeverity
    confidence: number
    confidence_band: ModerationConfidenceBand
    signals_detected: string[]
    signals_not_detected: string[]
    evidence: ModerationEvidence[]
    notes?: string | null
  }>
  measurement_meta: {
    model_name: string
    measured_at: string
    duration_ms: number
  }
}

export type ModerationJudgeRequestBody = {
  request_id?: string
  evaluation_id: string
  culture_id: string
  policy_profile_id: string
  options?: {
    allow_global_safety_override_by_culture?: boolean
  }
}

export type ModerationJudgeResponseBody = {
  request_id: string | null
  evaluation_id: string
  report_id: string | number
  content_id: string | number
  decision_reasoning: {
    issue_summaries: Array<{
      issue_id: string
      issue_class: ModerationIssueClass
      matched: boolean
      severity: ModerationSeverity
      severity_score: number
      confidence: number
      confidence_band: ModerationConfidenceBand
      evidence_refs: string[]
    }>
    dimension_impacts: Array<{
      issue_id: string
      dimension_path: string
      culture_value: string
      dimension_weight: number
      impact_score: number
      impact_level: ModerationConfidenceBand
    }>
    cultural_context: {
      culture_id: string
      culture_name?: string | null
      interaction_mode?: string | null
      discourse_mode?: string | null
    }
    confidence_analysis: {
      overall_confidence: number
      overall_confidence_band: ModerationConfidenceBand
      confidence_factors: string[]
    }
    reasoning_trace: string[]
  }
  ai_judgment: {
    outcome: ModerationOutcome
    action_type: ModerationActionType
    primary_issue_id: string | null
    primary_issue_class: ModerationIssueClass
    severity_level: ModerationSeverity
    confidence: number
    confidence_band: ModerationConfidenceBand
    impact_score: number
    decision_basis: Record<string, unknown>
    alternative_outcomes_considered: Array<{
      outcome: ModerationOutcome
      reason_rejected: string
    }>
  }
  judgment_meta: {
    model_name: string
    judged_at: string
    duration_ms: number
    policy_profile_id: string
    policy_profile_version: string
    culture_id: string
  }
}

export type ModerationReviewRequestBody = {
  request_id?: string
  evaluation_id: string
  human_review: {
    decision: ModerationReviewDecision
    final_outcome?: ModerationOutcome
    final_action_type?: ModerationActionType
    rationale?: string | null
  }
}

export type ModerationReviewResponseBody = {
  request_id: string | null
  evaluation_id: string
  review_status: 'completed'
  final_disposition: {
    source: 'ai_accepted' | 'human_override'
    outcome: ModerationOutcome
    action_type: ModerationActionType
  }
  review_meta: {
    reviewed_at: string
    reviewer_user_id: number
  }
}

