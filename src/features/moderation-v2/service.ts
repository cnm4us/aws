import { DomainError } from '../../core/errors'
import { getPool } from '../../db'
import { ulidMonotonic } from '../../utils/ulid'
import { buildAiCulturePayload } from '../cultures/payload'
import { getCultureWithDefinitionByDefinitionId } from '../cultures/repo'
import {
  moderationJudgeResponseSchema,
  moderationMeasureResponseSchema,
  type ModerationJudgeRequest,
  type ModerationJudgeResponse,
  type ModerationMeasureRequest,
  type ModerationMeasureResponse,
} from './schemas'
import { buildJudgeIdempotencyKey, buildMeasureIdempotencyKey } from './idempotency'
import { resolveModerationPolicyProfile } from './policy-profiles'
import * as repo from './repo'
import type { ModerationActionType, ModerationConfidenceBand, ModerationOutcome, ModerationSeverity } from './enums'
import type { ModerationJudgeRequestBody, ModerationMeasureRequestBody } from './types'

const MEASUREMENT_MODEL_NAME = 'measurement-heuristic-v1'
const JUDGMENT_MODEL_NAME = 'judgment-heuristic-v1'
const MAX_EVIDENCE_TEXT_LENGTH = 280

function normalizeText(value: string): string {
  return String(value || '').toLowerCase()
}

function normalizeSignalToken(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function confidenceBandFromScore(confidence: number): ModerationConfidenceBand {
  if (confidence >= 0.8) return 'high'
  if (confidence >= 0.6) return 'medium'
  return 'low'
}

function severityFromSignalCount(count: number): ModerationSeverity {
  if (count >= 3) return 'escalated'
  if (count >= 2) return 'moderate'
  if (count >= 1) return 'mild'
  return 'none'
}

function coerceReportId(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.round(raw)
  if (typeof raw === 'string' && /^[0-9]+$/.test(raw)) {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) return Math.round(n)
  }
  throw new DomainError('invalid_report_id', 'invalid_report_id', 400)
}

function coerceContentId(raw: unknown): string {
  const value = String(raw ?? '').trim()
  if (!value || value.length > 128) throw new DomainError('invalid_content_id', 'invalid_content_id', 400)
  return value
}

function collectSignalCandidates(aiSpec: Record<string, unknown>): string[] {
  const out: string[] = []
  const signals = aiSpec && typeof aiSpec === 'object' ? (aiSpec as any).signals : null
  if (!signals || typeof signals !== 'object') return out
  for (const value of Object.values(signals as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue
    for (const token of value) {
      const normalized = normalizeSignalToken(String(token || ''))
      if (normalized) out.push(normalized)
    }
  }
  return Array.from(new Set(out))
}

function firstSnippet(text: string, token: string | null): string {
  const body = String(text || '').replace(/\s+/g, ' ').trim()
  if (!body) return ''
  if (!token) return body.slice(0, MAX_EVIDENCE_TEXT_LENGTH)
  const idx = body.toLowerCase().indexOf(token.toLowerCase())
  if (idx < 0) return body.slice(0, MAX_EVIDENCE_TEXT_LENGTH)
  const start = Math.max(0, idx - 80)
  const end = Math.min(body.length, idx + token.length + 180)
  return body.slice(start, end)
}

function inferAssessments(input: ModerationMeasureRequest): ModerationMeasureResponse['assessments'] {
  const transcript = normalizeText(input.content.segment.vtt_text)
  const includeNonMatches = Boolean(input.options?.include_non_matches)
  const maxAssessments = clamp(Number(input.options?.max_assessments || 20), 1, 200)
  const results: ModerationMeasureResponse['assessments'] = []

  for (const rule of input.rules) {
    const candidates = collectSignalCandidates(rule.ai_spec || {})
    const detected: string[] = []
    const notDetected: string[] = []

    for (const token of candidates) {
      if (transcript.includes(token)) detected.push(token)
      else notDetected.push(token)
    }

    const issueTokens = rule.issue_id
      .split(/[_:-]+/)
      .map((part) => normalizeSignalToken(part))
      .filter((part) => part.length >= 4)
    const issueTokenMatches = issueTokens.filter((part) => transcript.includes(part)).length
    let heuristicMatches = 0
    const issueId = normalizeSignalToken(rule.issue_id)
    if (
      (issueId.includes('factual assertion') ||
        issueId.includes('misinformation') ||
        issueId.includes('unsupported')) &&
      /\b(is|are|was|were|has|have|highest|lowest|rate|percent|always|never)\b/.test(transcript)
    ) {
      heuristicMatches += 1
      if (!detected.includes('assertive claim syntax')) detected.push('assertive claim syntax')
    }
    if (
      (issueId.includes('dox') ||
        issueId.includes('identity') ||
        issueId.includes('privacy')) &&
      /\b(address|phone|email|located at|lives at)\b/.test(transcript)
    ) {
      heuristicMatches += 1
      if (!detected.includes('identifier disclosure pattern')) detected.push('identifier disclosure pattern')
    }
    const hasTokenMatch = detected.length > 0 || issueTokenMatches >= 1 || heuristicMatches > 0
    const matched = Boolean(hasTokenMatch)
    if (!matched && !includeNonMatches) continue

    const severity = matched
      ? severityFromSignalCount(Math.max(detected.length, issueTokenMatches, heuristicMatches))
      : 'none'
    const expectedCount = Math.max(1, candidates.length)
    const rawConfidence = matched
      ? 0.55 + Math.min(1, Math.max(detected.length, issueTokenMatches, heuristicMatches) / expectedCount) * 0.4
      : 0.2
    const confidence = Number(clamp(rawConfidence, 0, 1).toFixed(2))
    const band = confidenceBandFromScore(confidence)
    const evidenceToken = detected[0] || issueTokens[0] || null
    const evidenceText = matched ? firstSnippet(input.content.segment.vtt_text, evidenceToken) : ''

    results.push({
      issue_id: rule.issue_id,
      issue_class: rule.issue_class,
      rule_version: rule.rule_version,
      matched,
      severity,
      confidence,
      confidence_band: band,
      signals_detected: detected,
      signals_not_detected: notDetected,
      evidence: matched
        ? [
            {
              evidence_id: `${rule.issue_id}:1`,
              start_seconds: input.content.segment.start_seconds,
              end_seconds: input.content.segment.end_seconds,
              text: evidenceText,
            },
          ]
        : [],
      notes: matched
        ? `Matched ${rule.issue_id} via transcript signal analysis.`
        : `No match for ${rule.issue_id}.`,
    })

    if (results.length >= maxAssessments) break
  }

  return results
}

export async function measureModeration(
  input: ModerationMeasureRequestBody
): Promise<ModerationMeasureResponse> {
  const startedAt = Date.now()
  const normalizedInput = input as ModerationMeasureRequest
  const reportId = coerceReportId(normalizedInput.report.report_id)
  const contentId = coerceContentId(normalizedInput.content.content_id)
  const evaluationId = ulidMonotonic()
  const measuredAt = new Date()
  const idempotencyKey = buildMeasureIdempotencyKey(normalizedInput)
  const assessments = inferAssessments(normalizedInput)
  const durationMs = Math.max(0, Date.now() - startedAt)

  const response: ModerationMeasureResponse = {
    request_id: normalizedInput.request_id ?? null,
    evaluation_id: evaluationId,
    report_id: normalizedInput.report.report_id,
    content_id: normalizedInput.content.content_id,
    assessments,
    measurement_meta: {
      model_name: MEASUREMENT_MODEL_NAME,
      measured_at: measuredAt.toISOString(),
      duration_ms: durationMs,
    },
  }

  const parsed = moderationMeasureResponseSchema.safeParse(response)
  if (!parsed.success) {
    throw new DomainError('invalid_measurement_output', 'invalid_measurement_output', 500)
  }

  const pool = getPool()
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    const exists = await repo.reportExists(reportId, conn as any)
    if (!exists) throw new DomainError('report_not_found', 'report_not_found', 404)

    await repo.insertEvaluation(
      {
        evaluationId,
        reportId,
        contentId,
        contentType: normalizedInput.content.content_type,
        requestId: normalizedInput.request_id ?? null,
        status: 'created',
        metadataJson: {
          source: 'api.moderation.measure',
          idempotency_key: idempotencyKey,
        },
      },
      conn as any
    )

    await repo.insertMeasurement(
      {
        evaluationId,
        stageSeq: 1,
        requestSnapshotJson: normalizedInput,
        normalizedAssessmentsJson: parsed.data.assessments,
        measurementMetaJson: parsed.data.measurement_meta,
        modelName: MEASUREMENT_MODEL_NAME,
        durationMs,
      },
      conn as any
    )

    await repo.updateEvaluationMeasured(
      {
        evaluationId,
        measuredAt,
        metadataJson: {
          source: 'api.moderation.measure',
          idempotency_key: idempotencyKey,
        },
      },
      conn as any
    )

    await conn.commit()
  } catch (err) {
    try { await conn.rollback() } catch {}
    throw err
  } finally {
    try { conn.release() } catch {}
  }

  return parsed.data
}

type StoredAssessment = {
  issue_id: string
  issue_class: 'global_safety' | 'cultural' | 'unknown'
  matched: boolean
  severity: ModerationSeverity
  confidence: number
  confidence_band: ModerationConfidenceBand
  evidence: Array<{ evidence_id: string }>
}

function asStoredAssessments(raw: unknown): StoredAssessment[] {
  if (!Array.isArray(raw)) return []
  const out: StoredAssessment[] = []
  for (const item of raw as any[]) {
    if (!item || typeof item !== 'object') continue
    const issueId = String(item.issue_id || '').trim()
    if (!issueId) continue
    const issueClassRaw = String(item.issue_class || '').trim()
    const issueClass = issueClassRaw === 'global_safety' || issueClassRaw === 'cultural' ? issueClassRaw : 'unknown'
    const severityRaw = String(item.severity || '').trim() as ModerationSeverity
    const severity =
      severityRaw === 'none' || severityRaw === 'mild' || severityRaw === 'moderate' || severityRaw === 'escalated'
        ? severityRaw
        : 'none'
    const confidence = clamp(Number(item.confidence || 0), 0, 1)
    const confidenceBand = confidenceBandFromScore(confidence)
    const evidence = Array.isArray(item.evidence)
      ? item.evidence
          .map((ev: any) => ({ evidence_id: String(ev?.evidence_id || '').trim() }))
          .filter((ev: any) => Boolean(ev.evidence_id))
      : []
    out.push({
      issue_id: issueId,
      issue_class: issueClass,
      matched: Boolean(item.matched),
      severity,
      confidence,
      confidence_band: confidenceBand,
      evidence,
    })
  }
  return out
}

function inferToleranceKey(issueId: string): keyof ReturnType<typeof buildAiCulturePayload>['culture']['tolerance'] | null {
  const id = normalizeSignalToken(issueId)
  if (id.includes('hostil')) return 'hostility'
  if (id.includes('confront')) return 'confrontation'
  if (id.includes('profan')) return 'person_directed_profanity'
  if (id.includes('mock')) return 'mockery'
  if (id.includes('attack') || id.includes('insult')) return 'personal_attacks'
  return null
}

function outcomeFromImpact(score: number, policy: ReturnType<typeof resolveModerationPolicyProfile>): ModerationOutcome {
  if (score <= policy.outcome_thresholds.dismiss.max_score) return 'dismiss'
  if (score >= policy.outcome_thresholds.uphold.min_score) return 'uphold'
  if (score >= policy.outcome_thresholds.review.min_score && score <= policy.outcome_thresholds.review.max_score) return 'review'
  return 'soft_action'
}

function actionTypeFromOutcome(outcome: ModerationOutcome, primarySeverity: ModerationSeverity, hasGlobalSafety: boolean): ModerationActionType {
  if (outcome === 'dismiss') return 'none'
  if (outcome === 'soft_action') return 'content_flag'
  if (outcome === 'review') return 'human_review'
  if (hasGlobalSafety && primarySeverity === 'escalated') return 'content_remove'
  return 'content_flag'
}

function countMeasuredRules(raw: unknown): number {
  if (!raw || typeof raw !== 'object') return 0
  const rules = (raw as any).rules
  return Array.isArray(rules) ? rules.length : 0
}

export async function judgeModeration(
  input: ModerationJudgeRequestBody
): Promise<ModerationJudgeResponse> {
  const startedAt = Date.now()
  const normalizedInput = input as ModerationJudgeRequest
  const judgedAt = new Date()
  const idempotencyKey = buildJudgeIdempotencyKey(normalizedInput)
  const policy = resolveModerationPolicyProfile(normalizedInput.policy_profile_id)
  const pool = getPool()
  const conn = await pool.getConnection()

  try {
    await conn.beginTransaction()

    const evaluation = await repo.getEvaluationByIdForUpdate(normalizedInput.evaluation_id, conn as any)
    if (!evaluation) throw new DomainError('evaluation_not_found', 'evaluation_not_found', 404)
    if (evaluation.status === 'reviewed') {
      throw new DomainError('evaluation_already_reviewed', 'evaluation_already_reviewed', 409)
    }
    if (evaluation.status === 'failed') {
      throw new DomainError('evaluation_failed', 'evaluation_failed', 409)
    }

    const measurement = await repo.getLatestMeasurementByEvaluationId(normalizedInput.evaluation_id, conn as any)
    if (!measurement) throw new DomainError('measurement_not_found', 'measurement_not_found', 404)

    const culture = await getCultureWithDefinitionByDefinitionId(normalizedInput.culture_id, conn as any)
    if (!culture) throw new DomainError('culture_not_found', 'culture_not_found', 404)
    const aiCulture = buildAiCulturePayload(culture.definition)

    const assessments = asStoredAssessments(measurement.normalized_assessments_json).filter((it) => it.matched)
    const previousJudgment = await repo.getLatestJudgmentByEvaluationId(normalizedInput.evaluation_id, conn as any)
    const nextJudgmentStageSeq = (previousJudgment?.stage_seq || 0) + 1

    const issueSummaries: ModerationJudgeResponse['decision_reasoning']['issue_summaries'] = []
    const dimensionImpacts: ModerationJudgeResponse['decision_reasoning']['dimension_impacts'] = []
    const reasoningTrace: string[] = []

    let maxImpact = 0
    let maxConfidence = 0
    let primary: StoredAssessment | null = null
    let hasGlobalSafety = false

    for (const a of assessments) {
      if (a.issue_class === 'global_safety') hasGlobalSafety = true
      const severityScore = policy.severity_map[a.severity] ?? 0
      const toleranceKey = inferToleranceKey(a.issue_id)
      const toleranceValue = toleranceKey ? aiCulture.culture.tolerance[toleranceKey] : null
      const dimensionWeight = toleranceValue
        ? policy.tolerance_weight_map[toleranceValue]
        : aiCulture.culture.interaction_style === 'professional'
          ? 2.0
          : 1.5
      const impactScore = Number((severityScore * dimensionWeight).toFixed(2))
      if (impactScore >= maxImpact) {
        maxImpact = impactScore
        primary = a
      }
      maxConfidence = Math.max(maxConfidence, a.confidence)

      issueSummaries.push({
        issue_id: a.issue_id,
        issue_class: a.issue_class,
        matched: a.matched,
        severity: a.severity,
        severity_score: severityScore,
        confidence: Number(a.confidence.toFixed(2)),
        confidence_band: confidenceBandFromScore(a.confidence),
        evidence_refs: a.evidence.map((ev) => ev.evidence_id),
      })
      dimensionImpacts.push({
        issue_id: a.issue_id,
        dimension_path: toleranceKey ? `culture.tolerance.${toleranceKey}` : 'culture.interaction_style',
        culture_value: toleranceValue || aiCulture.culture.interaction_style,
        dimension_weight: Number(dimensionWeight.toFixed(2)),
        impact_score: impactScore,
        impact_level: confidenceBandFromScore(clamp(impactScore / 6, 0, 1)),
      })
      reasoningTrace.push(
        `Issue ${a.issue_id} severity=${a.severity} score=${severityScore} weight=${Number(dimensionWeight.toFixed(2))} impact=${impactScore}.`
      )
    }

    if (!assessments.length) {
      const evaluatedRuleCount = countMeasuredRules(measurement.request_snapshot_json)
      maxConfidence = clamp(0.65 + Math.min(evaluatedRuleCount, 6) * 0.05, 0, 0.95)
      reasoningTrace.push('No matched issues were present in the stored stage-1 measurement artifact.')
      reasoningTrace.push(
        `Dismiss outcome retained because ${evaluatedRuleCount || 0} rules were evaluated without any matched issue crossing the judgment threshold.`
      )
    }

    const overallConfidence = Number(clamp(maxConfidence, 0, 1).toFixed(2))
    const overallConfidenceBand = confidenceBandFromScore(overallConfidence)
    let outcome: ModerationOutcome = assessments.length ? outcomeFromImpact(maxImpact, policy) : 'dismiss'
    if (assessments.length && policy.confidence_rules.low === 'review' && overallConfidenceBand === 'low') {
      outcome = 'review'
      reasoningTrace.push('Low confidence forced review outcome.')
    }
    if (hasGlobalSafety && (outcome === 'dismiss' || outcome === 'soft_action')) {
      outcome = 'review'
      reasoningTrace.push('Global safety match prevented dismiss/soft_action; raised to review.')
    }

    const primaryIssue = primary || assessments[0] || null
    const primarySeverity = primaryIssue?.severity || 'none'
    const actionType = actionTypeFromOutcome(outcome, primarySeverity, hasGlobalSafety)
    const durationMs = Math.max(0, Date.now() - startedAt)

    const response: ModerationJudgeResponse = {
      request_id: normalizedInput.request_id ?? null,
      evaluation_id: evaluation.evaluation_id,
      report_id: evaluation.report_id,
      content_id: evaluation.content_id,
      decision_reasoning: {
        issue_summaries: issueSummaries,
        dimension_impacts: dimensionImpacts,
        cultural_context: {
          culture_id: aiCulture.culture.id,
          culture_name: aiCulture.culture.name,
          interaction_mode: aiCulture.culture.interaction_style,
          discourse_mode: null,
        },
        confidence_analysis: {
          overall_confidence: overallConfidence,
          overall_confidence_band: overallConfidenceBand,
          confidence_factors: [
            `matched_issues:${assessments.length}`,
            `evaluated_rules:${countMeasuredRules(measurement.request_snapshot_json)}`,
            `max_impact:${Number(maxImpact.toFixed(2))}`,
            `has_global_safety:${hasGlobalSafety ? 'yes' : 'no'}`,
          ],
        },
        reasoning_trace: reasoningTrace,
      },
      ai_judgment: {
        outcome,
        action_type: actionType,
        primary_issue_id: primaryIssue?.issue_id || null,
        primary_issue_class: primaryIssue?.issue_class || 'unknown',
        severity_level: primarySeverity,
        confidence: overallConfidence,
        confidence_band: overallConfidenceBand,
        impact_score: Number(maxImpact.toFixed(2)),
        decision_basis: {
          policy_profile_id: policy.id,
          policy_profile_version: policy.version,
          culture_version: aiCulture.culture.version,
          low_confidence_forced_review: assessments.length > 0 && overallConfidenceBand === 'low',
          global_safety_lock: hasGlobalSafety,
          judgment_stage_seq: nextJudgmentStageSeq,
          no_matched_issues: assessments.length === 0,
        },
        alternative_outcomes_considered: [
          { outcome: 'dismiss', reason_rejected: 'impact score exceeded dismissal or global safety lock applied' },
          { outcome: 'review', reason_rejected: outcome === 'review' ? 'selected' : 'threshold produced stronger outcome' },
        ],
      },
      judgment_meta: {
        model_name: JUDGMENT_MODEL_NAME,
        judged_at: judgedAt.toISOString(),
        duration_ms: durationMs,
        policy_profile_id: policy.id,
        policy_profile_version: policy.version,
        culture_id: aiCulture.culture.id,
      },
    }

    const parsed = moderationJudgeResponseSchema.safeParse(response)
    if (!parsed.success) {
      throw new DomainError('invalid_judgment_output', 'invalid_judgment_output', 500)
    }

    await repo.insertJudgment(
      {
        evaluationId: evaluation.evaluation_id,
        stageSeq: nextJudgmentStageSeq,
        requestSnapshotJson: normalizedInput,
        resolvedPolicyJson: policy,
        resolvedCultureJson: aiCulture,
        decisionReasoningJson: parsed.data.decision_reasoning,
        aiJudgmentJson: parsed.data.ai_judgment,
        judgmentMetaJson: parsed.data.judgment_meta,
        modelName: JUDGMENT_MODEL_NAME,
        durationMs,
        policyProfileId: policy.id,
        policyProfileVersion: policy.version,
        cultureId: aiCulture.culture.id,
      },
      conn as any
    )

    await repo.updateEvaluationJudged(
      {
        evaluationId: evaluation.evaluation_id,
        judgedAt,
        finalOutcome: parsed.data.ai_judgment.outcome,
        finalActionType: parsed.data.ai_judgment.action_type,
        metadataJson: {
          source: 'api.moderation.judge',
          idempotency_key: idempotencyKey,
          judgment_stage_seq: nextJudgmentStageSeq,
          policy_profile_id: policy.id,
          policy_profile_version: policy.version,
          culture_id: aiCulture.culture.id,
        },
      },
      conn as any
    )

    await conn.commit()
    return parsed.data
  } catch (err) {
    try { await conn.rollback() } catch {}
    throw err
  } finally {
    try { conn.release() } catch {}
  }
}
