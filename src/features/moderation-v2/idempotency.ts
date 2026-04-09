import crypto from 'crypto'
import type {
  ModerationJudgeRequestBody,
  ModerationMeasureRequestBody,
  ModerationReviewRequestBody,
} from './types'

export type ModerationV2Stage = 'measure' | 'judge' | 'review'

function stableStringify(input: unknown): string {
  if (input === null || input === undefined) return 'null'
  if (typeof input === 'number' || typeof input === 'boolean') return JSON.stringify(input)
  if (typeof input === 'string') return JSON.stringify(input)
  if (Array.isArray(input)) {
    return `[${input.map((item) => stableStringify(item)).join(',')}]`
  }
  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',')}}`
  }
  return JSON.stringify(String(input))
}

function hashStablePayload(payload: unknown): string {
  const canon = stableStringify(payload)
  return crypto.createHash('sha256').update(canon).digest('hex')
}

export function buildModerationV2IdempotencyKey(stage: ModerationV2Stage, payload: unknown): string {
  return `modv2:${stage}:${hashStablePayload(payload)}`
}

export function buildMeasureIdempotencyKey(input: ModerationMeasureRequestBody): string {
  const payload = {
    request_id: input.request_id || null,
    content: {
      content_id: input.content.content_id,
      content_type: input.content.content_type,
      segment: {
        start_seconds: input.content.segment.start_seconds,
        end_seconds: input.content.segment.end_seconds,
        vtt_text: input.content.segment.vtt_text,
      },
    },
    report: {
      report_id: input.report.report_id,
      reason_code: input.report.reason_code || null,
      free_text: input.report.free_text || null,
    },
    rules: input.rules.map((rule) => ({
      issue_id: rule.issue_id,
      issue_class: rule.issue_class,
      rule_version: rule.rule_version,
      ai_spec: rule.ai_spec,
    })),
    options: input.options || null,
  }
  return buildModerationV2IdempotencyKey('measure', payload)
}

export function buildJudgeIdempotencyKey(input: ModerationJudgeRequestBody): string {
  const payload = {
    request_id: input.request_id || null,
    evaluation_id: input.evaluation_id,
    culture_id: input.culture_id,
    policy_profile_id: input.policy_profile_id,
    options: input.options || null,
  }
  return buildModerationV2IdempotencyKey('judge', payload)
}

export function buildReviewIdempotencyKey(input: ModerationReviewRequestBody): string {
  const payload = {
    request_id: input.request_id || null,
    evaluation_id: input.evaluation_id,
    human_review: {
      decision: input.human_review.decision,
      final_outcome: input.human_review.final_outcome || null,
      final_action_type: input.human_review.final_action_type || null,
      rationale: input.human_review.rationale || null,
    },
  }
  return buildModerationV2IdempotencyKey('review', payload)
}

