import { DomainError } from '../../core/errors'
import * as reportsRepo from '../reports/repo'
import * as repo from './repo'

type DbLike = { query: (sql: string, params?: any[]) => Promise<any> }

function latestOf<T>(rows: T[]): T | null {
  return rows.length ? rows[rows.length - 1] : null
}

export async function getModerationEvaluationDebugBundle(
  evaluationId: string,
  db?: DbLike
): Promise<{
  evaluation: any
  report: any | null
  reportActions: any[]
  measurements: any[]
  judgments: any[]
  reviews: any[]
  summary: {
    evaluation_id: string
    report_id: number
    status: string
    measurement_stage_count: number
    latest_measurement_stage_seq: number | null
    latest_measurement_match_count: number
    judgment_stage_count: number
    latest_judgment_stage_seq: number | null
    latest_judgment_outcome: string | null
    latest_judgment_action_type: string | null
    review_count: number
    latest_review_seq: number | null
    latest_review_decision: string | null
    final_disposition_source: string | null
    final_outcome: string | null
    final_action_type: string | null
  }
  replay: {
    measure_requests: Array<{ stage_seq: number; request: any }>
    judge_requests: Array<{ stage_seq: number; request: any }>
    review_requests: Array<{ review_seq: number; request: any }>
  }
}> {
  const evaluation = await repo.getEvaluationById(evaluationId, db)
  if (!evaluation) throw new DomainError('evaluation_not_found', 'evaluation_not_found', 404)

  const [measurements, judgments, reviews, report] = await Promise.all([
    repo.listMeasurementsByEvaluationId(evaluationId, db),
    repo.listJudgmentsByEvaluationId(evaluationId, db),
    repo.listReviewsByEvaluationId(evaluationId, db),
    reportsRepo.getReportById(evaluation.report_id, db as any),
  ])
  const reportActions = report ? await reportsRepo.listReportActions(evaluation.report_id, db as any) : []
  const latestMeasurement = latestOf(measurements)
  const latestJudgment = latestOf(judgments)
  const latestReview = latestOf(reviews)
  const latestAssessments = Array.isArray(latestMeasurement?.normalized_assessments_json)
    ? latestMeasurement.normalized_assessments_json
    : []
  const latestMatchCount = latestAssessments.filter((item: any) => Boolean(item?.matched)).length

  return {
    evaluation,
    report,
    reportActions,
    measurements,
    judgments,
    reviews,
    summary: {
      evaluation_id: evaluation.evaluation_id,
      report_id: evaluation.report_id,
      status: evaluation.status,
      measurement_stage_count: measurements.length,
      latest_measurement_stage_seq: latestMeasurement?.stage_seq ?? null,
      latest_measurement_match_count: latestMatchCount,
      judgment_stage_count: judgments.length,
      latest_judgment_stage_seq: latestJudgment?.stage_seq ?? null,
      latest_judgment_outcome: latestJudgment?.ai_judgment_json?.outcome ?? null,
      latest_judgment_action_type: latestJudgment?.ai_judgment_json?.action_type ?? null,
      review_count: reviews.length,
      latest_review_seq: latestReview?.review_seq ?? null,
      latest_review_decision: latestReview?.decision ?? null,
      final_disposition_source: evaluation.final_disposition_source ?? null,
      final_outcome: evaluation.final_outcome ?? null,
      final_action_type: evaluation.final_action_type ?? null,
    },
    replay: {
      measure_requests: measurements.map((row) => ({
        stage_seq: row.stage_seq,
        request: row.request_snapshot_json,
      })),
      judge_requests: judgments.map((row) => ({
        stage_seq: row.stage_seq,
        request: row.request_snapshot_json,
      })),
      review_requests: reviews.map((row) => ({
        review_seq: row.review_seq,
        request: {
          request_id: row.review_snapshot_json?.request_id ?? null,
          evaluation_id: evaluationId,
          human_review: row.review_snapshot_json?.review_decision ?? null,
        },
      })),
    },
  }
}
