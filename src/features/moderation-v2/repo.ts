import { getPool } from '../../db'
import type { ModerationContentType } from './types'

type DbLike = { query: (sql: string, params?: any[]) => Promise<any> }

type InsertEvaluationInput = {
  evaluationId: string
  reportId: number
  contentId: string
  contentType: ModerationContentType
  requestId: string | null
  status: 'created' | 'measured'
  measuredAt?: Date | null
  metadataJson?: unknown
}

type InsertMeasurementInput = {
  evaluationId: string
  stageSeq: number
  requestSnapshotJson: unknown
  normalizedAssessmentsJson: unknown
  measurementMetaJson: unknown
  modelName: string
  durationMs: number
}

type InsertJudgmentInput = {
  evaluationId: string
  stageSeq: number
  requestSnapshotJson: unknown
  resolvedPolicyJson: unknown
  resolvedCultureJson: unknown
  decisionReasoningJson: unknown
  aiJudgmentJson: unknown
  judgmentMetaJson: unknown
  modelName: string
  durationMs: number
  policyProfileId: string
  policyProfileVersion: string
  cultureId: string
}

type EvaluationRow = {
  evaluation_id: string
  report_id: number
  content_id: string
  content_type: ModerationContentType
  status: 'created' | 'measured' | 'judged' | 'reviewed' | 'failed'
}

type MeasurementRow = {
  id: number
  evaluation_id: string
  stage_seq: number
  request_snapshot_json: any
  normalized_assessments_json: any
  measurement_meta_json: any
  model_name: string | null
  duration_ms: number | null
  created_at: string
}

type JudgmentRow = {
  id: number
  evaluation_id: string
  stage_seq: number
  ai_judgment_json: any
  judgment_meta_json: any
  created_at: string
}

type ReviewRow = {
  id: number
  evaluation_id: string
  review_seq: number
  reviewer_user_id: number
  decision: 'accept_ai' | 'override_ai'
  rationale: string | null
  final_outcome: string
  final_action_type: string
  disposition_source: 'ai_accepted' | 'human_override'
  review_snapshot_json: any
  created_at: string
}

function parseJsonCell(value: unknown): unknown | null {
  if (value == null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    try {
      return JSON.parse(trimmed)
    } catch {
      return null
    }
  }
  return value
}

export async function reportExists(reportId: number, db?: DbLike): Promise<boolean> {
  const q = (db as any) || getPool()
  const [rows] = await q.query(
    `SELECT id
       FROM space_publication_reports
      WHERE id = ?
      LIMIT 1`,
    [reportId]
  )
  return Array.isArray(rows) && rows.length > 0
}

export async function insertEvaluation(input: InsertEvaluationInput, db?: DbLike): Promise<void> {
  const q = (db as any) || getPool()
  const measuredAtValue = input.measuredAt ? new Date(input.measuredAt) : null
  const metadata = input.metadataJson == null ? null : JSON.stringify(input.metadataJson)
  await q.query(
    `INSERT INTO moderation_evaluations
      (evaluation_id, report_id, content_id, content_type, status, request_id, measured_at, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.evaluationId,
      input.reportId,
      input.contentId,
      input.contentType,
      input.status,
      input.requestId,
      measuredAtValue,
      metadata,
    ]
  )
}

export async function updateEvaluationMeasured(input: {
  evaluationId: string
  measuredAt: Date
  metadataJson?: unknown
}, db?: DbLike): Promise<void> {
  const q = (db as any) || getPool()
  const metadata = input.metadataJson == null ? null : JSON.stringify(input.metadataJson)
  await q.query(
    `UPDATE moderation_evaluations
        SET status = 'measured',
            measured_at = ?,
            metadata_json = COALESCE(?, metadata_json),
            updated_at = CURRENT_TIMESTAMP
      WHERE evaluation_id = ?`,
    [input.measuredAt, metadata, input.evaluationId]
  )
}

export async function insertMeasurement(input: InsertMeasurementInput, db?: DbLike): Promise<void> {
  const q = (db as any) || getPool()
  await q.query(
    `INSERT INTO moderation_measurements
      (evaluation_id, stage_seq, request_snapshot_json, normalized_assessments_json, measurement_meta_json, model_name, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.evaluationId,
      input.stageSeq,
      JSON.stringify(input.requestSnapshotJson),
      JSON.stringify(input.normalizedAssessmentsJson),
      JSON.stringify(input.measurementMetaJson),
      input.modelName,
      input.durationMs,
    ]
  )
}

export async function getEvaluationByIdForUpdate(
  evaluationId: string,
  db?: DbLike
): Promise<EvaluationRow | null> {
  const q = (db as any) || getPool()
  const [rows] = await q.query(
    `SELECT evaluation_id, report_id, content_id, content_type, status
       FROM moderation_evaluations
      WHERE evaluation_id = ?
      LIMIT 1 FOR UPDATE`,
    [evaluationId]
  )
  const row = Array.isArray(rows) ? (rows as any[])[0] : null
  if (!row) return null
  return {
    evaluation_id: String(row.evaluation_id),
    report_id: Number(row.report_id),
    content_id: String(row.content_id),
    content_type: String(row.content_type) as ModerationContentType,
    status: String(row.status) as EvaluationRow['status'],
  }
}

export async function getLatestMeasurementByEvaluationId(
  evaluationId: string,
  db?: DbLike
): Promise<MeasurementRow | null> {
  const q = (db as any) || getPool()
  const [rows] = await q.query(
    `SELECT id,
            evaluation_id,
            stage_seq,
            request_snapshot_json,
            normalized_assessments_json,
            measurement_meta_json,
            model_name,
            duration_ms,
            created_at
       FROM moderation_measurements
      WHERE evaluation_id = ?
      ORDER BY stage_seq DESC, id DESC
      LIMIT 1`,
    [evaluationId]
  )
  const row = Array.isArray(rows) ? (rows as any[])[0] : null
  if (!row) return null
  return {
    id: Number(row.id),
    evaluation_id: String(row.evaluation_id),
    stage_seq: Number(row.stage_seq),
    request_snapshot_json: parseJsonCell(row.request_snapshot_json),
    normalized_assessments_json: parseJsonCell(row.normalized_assessments_json),
    measurement_meta_json: parseJsonCell(row.measurement_meta_json),
    model_name: row.model_name == null ? null : String(row.model_name),
    duration_ms: row.duration_ms == null ? null : Number(row.duration_ms),
    created_at: String(row.created_at),
  }
}

export async function insertJudgment(input: InsertJudgmentInput, db?: DbLike): Promise<void> {
  const q = (db as any) || getPool()
  await q.query(
    `INSERT INTO moderation_judgments
      (evaluation_id, stage_seq, request_snapshot_json, resolved_policy_json, resolved_culture_json, decision_reasoning_json, ai_judgment_json, judgment_meta_json, model_name, duration_ms, policy_profile_id, policy_profile_version, culture_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.evaluationId,
      input.stageSeq,
      JSON.stringify(input.requestSnapshotJson),
      JSON.stringify(input.resolvedPolicyJson),
      JSON.stringify(input.resolvedCultureJson),
      JSON.stringify(input.decisionReasoningJson),
      JSON.stringify(input.aiJudgmentJson),
      JSON.stringify(input.judgmentMetaJson),
      input.modelName,
      input.durationMs,
      input.policyProfileId,
      input.policyProfileVersion,
      input.cultureId,
    ]
  )
}

export async function getLatestJudgmentByEvaluationId(
  evaluationId: string,
  db?: DbLike
): Promise<JudgmentRow | null> {
  const q = (db as any) || getPool()
  const [rows] = await q.query(
    `SELECT id, evaluation_id, stage_seq, ai_judgment_json, judgment_meta_json, created_at
       FROM moderation_judgments
      WHERE evaluation_id = ?
      ORDER BY stage_seq DESC, id DESC
      LIMIT 1`,
    [evaluationId]
  )
  const row = Array.isArray(rows) ? (rows as any[])[0] : null
  if (!row) return null
  return {
    id: Number(row.id),
    evaluation_id: String(row.evaluation_id),
    stage_seq: Number(row.stage_seq),
    ai_judgment_json: parseJsonCell(row.ai_judgment_json),
    judgment_meta_json: parseJsonCell(row.judgment_meta_json),
    created_at: String(row.created_at),
  }
}

export async function updateEvaluationJudged(input: {
  evaluationId: string
  judgedAt: Date
  finalOutcome?: string | null
  finalActionType?: string | null
  metadataJson?: unknown
}, db?: DbLike): Promise<void> {
  const q = (db as any) || getPool()
  const metadata = input.metadataJson == null ? null : JSON.stringify(input.metadataJson)
  await q.query(
    `UPDATE moderation_evaluations
        SET status = 'judged',
            judged_at = ?,
            final_outcome = COALESCE(?, final_outcome),
            final_action_type = COALESCE(?, final_action_type),
            metadata_json = COALESCE(?, metadata_json),
            updated_at = CURRENT_TIMESTAMP
      WHERE evaluation_id = ?`,
    [
      input.judgedAt,
      input.finalOutcome ?? null,
      input.finalActionType ?? null,
      metadata,
      input.evaluationId,
    ]
  )
}

export async function getLatestReviewByEvaluationId(
  evaluationId: string,
  db?: DbLike
): Promise<ReviewRow | null> {
  const q = (db as any) || getPool()
  const [rows] = await q.query(
    `SELECT id,
            evaluation_id,
            review_seq,
            reviewer_user_id,
            decision,
            rationale,
            final_outcome,
            final_action_type,
            disposition_source,
            review_snapshot_json,
            created_at
       FROM moderation_reviews
      WHERE evaluation_id = ?
      ORDER BY review_seq DESC, id DESC
      LIMIT 1`,
    [evaluationId]
  )
  const row = Array.isArray(rows) ? (rows as any[])[0] : null
  if (!row) return null
  return {
    id: Number(row.id),
    evaluation_id: String(row.evaluation_id),
    review_seq: Number(row.review_seq),
    reviewer_user_id: Number(row.reviewer_user_id),
    decision: String(row.decision) as ReviewRow['decision'],
    rationale: row.rationale == null ? null : String(row.rationale),
    final_outcome: String(row.final_outcome),
    final_action_type: String(row.final_action_type),
    disposition_source: String(row.disposition_source) as ReviewRow['disposition_source'],
    review_snapshot_json: parseJsonCell(row.review_snapshot_json),
    created_at: String(row.created_at),
  }
}

export async function insertReview(input: {
  evaluationId: string
  reviewSeq: number
  reviewerUserId: number
  decision: 'accept_ai' | 'override_ai'
  rationale?: string | null
  finalOutcome: string
  finalActionType: string
  dispositionSource: 'ai_accepted' | 'human_override'
  reviewSnapshotJson?: unknown
}, db?: DbLike): Promise<void> {
  const q = (db as any) || getPool()
  await q.query(
    `INSERT INTO moderation_reviews
      (evaluation_id, review_seq, reviewer_user_id, decision, rationale, final_outcome, final_action_type, disposition_source, review_snapshot_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.evaluationId,
      input.reviewSeq,
      input.reviewerUserId,
      input.decision,
      input.rationale ?? null,
      input.finalOutcome,
      input.finalActionType,
      input.dispositionSource,
      input.reviewSnapshotJson == null ? null : JSON.stringify(input.reviewSnapshotJson),
    ]
  )
}

export async function updateEvaluationReviewed(input: {
  evaluationId: string
  reviewedAt: Date
  dispositionSource: 'ai_accepted' | 'human_override'
  finalOutcome: string
  finalActionType: string
  metadataJson?: unknown
}, db?: DbLike): Promise<void> {
  const q = (db as any) || getPool()
  const metadata = input.metadataJson == null ? null : JSON.stringify(input.metadataJson)
  await q.query(
    `UPDATE moderation_evaluations
        SET status = 'reviewed',
            reviewed_at = ?,
            final_disposition_source = ?,
            final_outcome = ?,
            final_action_type = ?,
            metadata_json = COALESCE(?, metadata_json),
            updated_at = CURRENT_TIMESTAMP
      WHERE evaluation_id = ?`,
    [
      input.reviewedAt,
      input.dispositionSource,
      input.finalOutcome,
      input.finalActionType,
      metadata,
      input.evaluationId,
    ]
  )
}
