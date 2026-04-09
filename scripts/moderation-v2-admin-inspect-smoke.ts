import crypto from 'crypto'
import { getPool } from '../src/db'
import { can } from '../src/security/permissions'
import { PERM } from '../src/security/perm'
import { createSession, revokeSession } from '../src/security/sessionStore'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

async function getAnyReport(): Promise<{ id: number } | null> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT id
       FROM space_publication_reports
      ORDER BY id DESC
      LIMIT 1`
  )
  const row = Array.isArray(rows) ? (rows as any[])[0] : null
  if (!row) return null
  return { id: Number(row.id) }
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

async function findGlobalModeratorUserId(): Promise<number | null> {
  const db = getPool()
  const [rows] = await db.query(`SELECT id FROM users ORDER BY id ASC LIMIT 500`)
  for (const row of rows as any[]) {
    const userId = Number(row.id)
    if (!Number.isFinite(userId) || userId <= 0) continue
    if (await can(userId, PERM.VIDEO_DELETE_ANY)) return userId
    if (await can(userId, PERM.FEED_MODERATE_GLOBAL)) return userId
    if (await can(userId, PERM.FEED_PUBLISH_GLOBAL)) return userId
  }
  return null
}

async function main(): Promise<void> {
  const report = await getAnyReport()
  if (!report) throw new Error('moderation_v2_admin_inspect_smoke_missing_report')
  const cultureId = await getAnyCultureDefinitionId()
  if (!cultureId) throw new Error('moderation_v2_admin_inspect_smoke_missing_culture_definition')
  const moderatorUserId = await findGlobalModeratorUserId()
  if (!moderatorUserId) throw new Error('moderation_v2_admin_inspect_smoke_missing_global_moderator_user')

  const csrfToken = crypto.randomBytes(16).toString('hex')
  const session = await createSession({
    userId: moderatorUserId,
    ip: '127.0.0.1',
    ua: 'moderation-v2-admin-inspect-smoke',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  })

  const { initObservability, shutdownObservability } = await import('../src/lib/observability')
  await initObservability()
  const { buildServer } = await import('../src/app')
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
        request_id: 'smoke_admin_inspect_measure_01',
        content: {
          content_id: 'video_654',
          content_type: 'video',
          language: 'en',
          segment: {
            start_seconds: 2,
            end_seconds: 11,
            vtt_text: 'WEBVTT\n\n00:00:02.000 --> 00:00:07.000\nYou should post their phone number and address.',
          },
        },
        report: {
          report_id: report.id,
          reason_code: 'other',
          free_text: 'smoke admin inspect',
        },
        rules: [
          {
            issue_id: 'privacy_identity_doxxing',
            issue_class: 'global_safety',
            rule_version: 'v1',
            ai_spec: { signals: { direct_identifiers: ['phone number', 'address'] } },
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
        request_id: 'smoke_admin_inspect_judge_01',
        evaluation_id: evaluationId,
        culture_id: cultureId,
        policy_profile_id: 'moderation_default',
      }),
    })
    assert(judgeResp.status === 200, `expected judge status=200, got=${judgeResp.status}`)
    const judged = (await judgeResp.json()) as any
    assert(judged?.judgment_meta?.policy_profile_id === 'moderation_default', 'expected stored policy profile id')

    const reviewResp = await fetch(`${base}/api/moderation/review`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        request_id: 'smoke_admin_inspect_review_01',
        evaluation_id: evaluationId,
        human_review: {
          decision: 'accept_ai',
        },
      }),
    })
    assert(reviewResp.status === 200, `expected review status=200, got=${reviewResp.status}`)

    const inspectResp = await fetch(
      `${base}/admin/reports?report_id=${encodeURIComponent(String(report.id))}&view=inspect`,
      {
        headers: {
          cookie: authCookie,
        },
      }
    )
    assert(inspectResp.status === 200, `expected inspect status=200, got=${inspectResp.status}`)
    const html = await inspectResp.text()
    assert(html.includes('Moderation V2'), 'expected moderation v2 section in inspect modal')
    assert(html.includes(evaluationId), 'expected evaluation_id in inspect modal')
    assert(html.includes('Latest Judgment'), 'expected latest judgment section in inspect modal')
    assert(html.includes('Review Timeline'), 'expected review timeline section in inspect modal')
  } finally {
    try {
      await new Promise((resolve) => setTimeout(resolve, 750))
    } catch {}
    try {
      await shutdownObservability()
    } catch {}
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
    console.error(err)
    process.exit(1)
  })
