import crypto from 'crypto'
import { buildServer } from '../src/app'
import { getPool } from '../src/db'
import { getModerationEvaluationDebugBundle } from '../src/features/moderation-v2/debug'
import { can } from '../src/security/permissions'
import { PERM } from '../src/security/perm'
import { createSession, revokeSession } from '../src/security/sessionStore'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

async function getAnyReport(): Promise<{ id: number; space_id: number } | null> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT id, space_id
       FROM space_publication_reports
      ORDER BY id DESC
      LIMIT 1`
  )
  const row = Array.isArray(rows) ? (rows as any[])[0] : null
  if (!row) return null
  return {
    id: Number(row.id),
    space_id: Number(row.space_id),
  }
}

async function getAnyCultureDefinitionId(): Promise<string | null> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT JSON_UNQUOTE(JSON_EXTRACT(definition_json, '$.id')) AS definition_id
       FROM cultures
      WHERE definition_json IS NOT NULL
      ORDER BY id DESC
      LIMIT 1`
  )
  const row = Array.isArray(rows) ? (rows as any[])[0] : null
  const id = row?.definition_id == null ? '' : String(row.definition_id).trim()
  return id || null
}

async function findModeratorUserId(spaceId: number): Promise<number | null> {
  const db = getPool()
  const [rows] = await db.query(`SELECT id FROM users ORDER BY id ASC LIMIT 500`)
  for (const row of rows as any[]) {
    const userId = Number(row.id)
    if (!Number.isFinite(userId) || userId <= 0) continue
    if (await can(userId, PERM.VIDEO_DELETE_ANY)) return userId
    if (await can(userId, PERM.FEED_MODERATE_GLOBAL)) return userId
    if (await can(userId, PERM.FEED_PUBLISH_GLOBAL)) return userId
    if (await can(userId, PERM.VIDEO_APPROVE_SPACE, { spaceId })) return userId
    if (await can(userId, PERM.VIDEO_PUBLISH_SPACE, { spaceId })) return userId
  }
  return null
}

async function main(): Promise<void> {
  const report = await getAnyReport()
  if (!report) throw new Error('moderation_v2_pipeline_smoke_missing_report')
  const cultureId = await getAnyCultureDefinitionId()
  if (!cultureId) throw new Error('moderation_v2_pipeline_smoke_missing_culture_definition')
  const moderatorUserId = await findModeratorUserId(report.space_id)
  if (!moderatorUserId) throw new Error('moderation_v2_pipeline_smoke_missing_moderator_user')

  const csrfToken = crypto.randomBytes(16).toString('hex')
  const session = await createSession({
    userId: moderatorUserId,
    ip: '127.0.0.1',
    ua: 'moderation-v2-pipeline-smoke',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  })

  const app = buildServer()
  const server = await new Promise<import('http').Server>((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const addr = server.address()
  if (!addr || typeof addr === 'string') {
    server.close()
    throw new Error('failed_to_bind_smoke_server')
  }

  const base = `http://127.0.0.1:${addr.port}`
  const authCookie = `sid=${encodeURIComponent(session.token)}; csrf=${encodeURIComponent(csrfToken)}`
  const authHeaders = {
    'content-type': 'application/json',
    cookie: authCookie,
    'x-csrf-token': csrfToken,
  }

  async function closeServer(): Promise<void> {
    try {
      ;(server as any).closeIdleConnections?.()
      ;(server as any).closeAllConnections?.()
    } catch {}
    await Promise.race([
      new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 1500)),
    ])
  }

  try {
    const measureResp = await fetch(`${base}/api/moderation/measure`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: 'smoke_pipeline_measure_01',
        content: {
          content_id: 'video_777',
          content_type: 'video',
          language: 'en',
          segment: {
            start_seconds: 0,
            end_seconds: 9,
            vtt_text:
              'WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nPost their address and phone number so everyone can find them.',
          },
        },
        report: {
          report_id: report.id,
          reason_code: 'other',
          free_text: 'pipeline happy path',
        },
        rules: [
          {
            issue_id: 'privacy_identity_doxxing',
            issue_class: 'global_safety',
            rule_version: 'v1',
            ai_spec: { signals: { direct_identifiers: ['address', 'phone number'] } },
          },
        ],
        options: {
          max_assessments: 20,
          include_non_matches: true,
        },
      }),
    })
    assert(measureResp.status === 200, `expected measure status=200, got=${measureResp.status}`)
    const measured = (await measureResp.json()) as any
    const evaluationId = String(measured?.evaluation_id || '')
    assert(evaluationId.length === 26, 'expected evaluation_id from measure')

    const judgeResp = await fetch(`${base}/api/moderation/judge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: 'smoke_pipeline_judge_01',
        evaluation_id: evaluationId,
        culture_id: cultureId,
        policy_profile_id: 'moderation_default',
      }),
    })
    assert(judgeResp.status === 200, `expected judge status=200, got=${judgeResp.status}`)
    const judged = (await judgeResp.json()) as any
    assert(judged?.evaluation_id === evaluationId, 'expected matching evaluation_id from judge')

    const reviewResp = await fetch(`${base}/api/moderation/review`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        request_id: 'smoke_pipeline_review_01',
        evaluation_id: evaluationId,
        human_review: {
          decision: 'accept_ai',
        },
      }),
    })
    assert(reviewResp.status === 200, `expected review status=200, got=${reviewResp.status}`)
    const reviewed = (await reviewResp.json()) as any
    assert(reviewed?.evaluation_id === evaluationId, 'expected matching evaluation_id from review')

    const bundle = await getModerationEvaluationDebugBundle(evaluationId)
    assert(bundle.summary.measurement_stage_count === 1, 'expected one measurement stage')
    assert(bundle.summary.judgment_stage_count === 1, 'expected one judgment stage')
    assert(bundle.summary.review_count === 1, 'expected one review event')
    assert(bundle.summary.latest_review_decision === 'accept_ai', 'expected accept_ai review decision')
    assert(bundle.replay.measure_requests.length === 1, 'expected replayable measure request snapshot')
    assert(bundle.replay.judge_requests.length === 1, 'expected replayable judge request snapshot')
    assert(bundle.replay.review_requests.length === 1, 'expected replayable review request snapshot')

    console.log('[moderation-v2-pipeline-smoke] ok', evaluationId)
  } finally {
    try {
      await closeServer()
    } catch {}
    try {
      await revokeSession(session.token)
    } catch {}
  }
}

void main()
  .then(() => {
    process.exit(0)
  })
  .catch((err) => {
    console.error('[moderation-v2-pipeline-smoke] failed', err)
    process.exit(1)
  })
