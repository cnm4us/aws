import crypto from 'crypto'
import { buildServer } from '../src/app'
import { getPool } from '../src/db'
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
  if (!report) throw new Error('moderation_v2_review_smoke_missing_report')
  const cultureId = await getAnyCultureDefinitionId()
  if (!cultureId) throw new Error('moderation_v2_review_smoke_missing_culture_definition')
  const moderatorUserId = await findModeratorUserId(report.space_id)
  if (!moderatorUserId) throw new Error('moderation_v2_review_smoke_missing_moderator_user')

  const csrfToken = crypto.randomBytes(16).toString('hex')
  const session = await createSession({
    userId: moderatorUserId,
    ip: '127.0.0.1',
    ua: 'moderation-v2-review-smoke',
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
        request_id: 'smoke_review_measure_01',
        content: {
          content_id: 'video_321',
          content_type: 'video',
          language: 'en',
          segment: {
            start_seconds: 0,
            end_seconds: 8,
            vtt_text: 'WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nI like sandwiches and sunshine.',
          },
        },
        report: {
          report_id: report.id,
          reason_code: 'other',
          free_text: 'smoke review',
        },
        rules: [
          {
            issue_id: 'doxxing',
            issue_class: 'global_safety',
            rule_version: 'v1',
            ai_spec: { signals: { direct_identifiers: ['home_address', 'personal_phone'] } },
          },
        ],
        options: {
          max_assessments: 20,
          include_non_matches: false,
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
        request_id: 'smoke_review_judge_01',
        evaluation_id: evaluationId,
        culture_id: cultureId,
        policy_profile_id: 'moderation_default',
      }),
    })
    assert(judgeResp.status === 200, `expected judge status=200, got=${judgeResp.status}`)
    const judged = (await judgeResp.json()) as any
    assert(judged?.ai_judgment?.outcome === 'dismiss', `expected dismiss ai_judgment outcome, got=${judged?.ai_judgment?.outcome}`)

    const unauthorizedReviewResp = await fetch(`${base}/api/moderation/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: 'smoke_review_unauth_01',
        evaluation_id: evaluationId,
        human_review: {
          decision: 'accept_ai',
        },
      }),
    })
    assert(unauthorizedReviewResp.status === 401, `expected unauthorized review status=401, got=${unauthorizedReviewResp.status}`)

    const acceptResp = await fetch(`${base}/api/moderation/review`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        request_id: 'smoke_review_accept_01',
        evaluation_id: evaluationId,
        human_review: {
          decision: 'accept_ai',
        },
      }),
    })
    assert(acceptResp.status === 200, `expected accept review status=200, got=${acceptResp.status}`)
    const accepted = (await acceptResp.json()) as any
    assert(accepted?.final_disposition?.source === 'ai_accepted', `expected ai_accepted source, got=${accepted?.final_disposition?.source}`)
    assert(accepted?.final_disposition?.outcome === 'dismiss', `expected dismiss final outcome, got=${accepted?.final_disposition?.outcome}`)

    const overrideNoRationaleResp = await fetch(`${base}/api/moderation/review`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        request_id: 'smoke_review_override_bad_01',
        evaluation_id: evaluationId,
        human_review: {
          decision: 'override_ai',
          final_outcome: 'review',
          final_action_type: 'human_review',
        },
      }),
    })
    assert(overrideNoRationaleResp.status === 400, `expected bad override review status=400, got=${overrideNoRationaleResp.status}`)
    const overrideNoRationaleBody = (await overrideNoRationaleResp.json()) as any
    assert(overrideNoRationaleBody?.error === 'invalid_review_request', `expected invalid_review_request, got=${overrideNoRationaleBody?.error}`)

    const overrideResp = await fetch(`${base}/api/moderation/review`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        request_id: 'smoke_review_override_01',
        evaluation_id: evaluationId,
        human_review: {
          decision: 'override_ai',
          final_outcome: 'review',
          final_action_type: 'human_review',
          rationale: 'Moderator wants a live follow-up review despite the AI dismissal.',
        },
      }),
    })
    assert(overrideResp.status === 200, `expected override review status=200, got=${overrideResp.status}`)
    const overridden = (await overrideResp.json()) as any
    assert(overridden?.final_disposition?.source === 'human_override', `expected human_override source, got=${overridden?.final_disposition?.source}`)
    assert(overridden?.final_disposition?.outcome === 'review', `expected review override outcome, got=${overridden?.final_disposition?.outcome}`)
    assert(overridden?.final_disposition?.action_type === 'human_review', `expected human_review override action, got=${overridden?.final_disposition?.action_type}`)

    const db = getPool()
    const [evalRows] = await db.query(
      `SELECT status, reviewed_at, final_disposition_source, final_outcome, final_action_type
         FROM moderation_evaluations
        WHERE evaluation_id = ?
        LIMIT 1`,
      [evaluationId]
    )
    const evalRow = Array.isArray(evalRows) ? (evalRows as any[])[0] : null
    assert(Boolean(evalRow), 'expected moderation_evaluations row')
    assert(String(evalRow.status) === 'reviewed', `expected reviewed evaluation status, got=${String(evalRow?.status)}`)
    assert(String(evalRow.final_disposition_source) === 'human_override', `expected human_override final disposition source, got=${String(evalRow?.final_disposition_source)}`)
    assert(String(evalRow.final_outcome) === 'review', `expected review final outcome, got=${String(evalRow?.final_outcome)}`)
    assert(String(evalRow.final_action_type) === 'human_review', `expected human_review final action, got=${String(evalRow?.final_action_type)}`)
    assert(Boolean(evalRow.reviewed_at), 'expected reviewed_at to be set')

    const [reviewRows] = await db.query(
      `SELECT review_seq, reviewer_user_id, decision, disposition_source, final_outcome, final_action_type
         FROM moderation_reviews
        WHERE evaluation_id = ?
        ORDER BY review_seq ASC, id ASC`,
      [evaluationId]
    )
    const reviews = Array.isArray(reviewRows) ? (reviewRows as any[]) : []
    assert(reviews.length === 2, `expected 2 moderation_reviews rows, got=${reviews.length}`)
    assert(Number(reviews[0].review_seq) === 1, `expected first review_seq=1, got=${reviews[0]?.review_seq}`)
    assert(String(reviews[0].decision) === 'accept_ai', `expected first decision accept_ai, got=${reviews[0]?.decision}`)
    assert(String(reviews[1].decision) === 'override_ai', `expected second decision override_ai, got=${reviews[1]?.decision}`)
    assert(String(reviews[1].disposition_source) === 'human_override', `expected second disposition_source human_override, got=${reviews[1]?.disposition_source}`)
    assert(Number(reviews[1].reviewer_user_id) === moderatorUserId, `expected reviewer_user_id=${moderatorUserId}, got=${reviews[1]?.reviewer_user_id}`)

    const [reportRows] = await db.query(
      `SELECT status, resolved_by_user_id, resolution_code
         FROM space_publication_reports
        WHERE id = ?
        LIMIT 1`,
      [report.id]
    )
    const reportRow = Array.isArray(reportRows) ? (reportRows as any[])[0] : null
    assert(Boolean(reportRow), 'expected report row')
    assert(String(reportRow.status) === 'in_review', `expected report status in_review after override, got=${String(reportRow?.status)}`)
    assert(reportRow.resolution_code == null, `expected cleared resolution_code for in_review report, got=${String(reportRow?.resolution_code)}`)
    assert(reportRow.resolved_by_user_id == null, `expected cleared resolved_by_user_id for in_review report, got=${String(reportRow?.resolved_by_user_id)}`)

    console.log('[moderation-v2-review-smoke] ok')
  } finally {
    await closeServer()
    try {
      await revokeSession(session.token)
    } catch {}
  }
}

main().catch((err) => {
  console.error('[moderation-v2-review-smoke] failed', err)
  process.exit(1)
})
