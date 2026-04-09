import { DomainError } from '../../core/errors'
import { getPool } from '../../db'
import { ulidMonotonic } from '../../utils/ulid'
import {
  moderationMeasureResponseSchema,
  type ModerationMeasureRequest,
  type ModerationMeasureResponse,
} from './schemas'
import { buildMeasureIdempotencyKey } from './idempotency'
import * as repo from './repo'
import type { ModerationConfidenceBand, ModerationSeverity } from './enums'
import type { ModerationMeasureRequestBody } from './types'

const MEASUREMENT_MODEL_NAME = 'measurement-heuristic-v1'
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
