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

