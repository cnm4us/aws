import { buildServer } from '../src/app'
import { getPool } from '../src/db'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

async function getAnyReportId(): Promise<number | null> {
  const db = getPool()
  const [rows] = await db.query(`SELECT id FROM space_publication_reports ORDER BY id DESC LIMIT 1`)
  const row = Array.isArray(rows) ? (rows as any[])[0] : null
  if (!row) return null
  const n = Number(row.id)
  return Number.isFinite(n) && n > 0 ? n : null
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

async function main(): Promise<void> {
  const reportId = await getAnyReportId()
  if (!reportId) throw new Error('moderation_v2_judge_smoke_missing_report')
  const cultureId = await getAnyCultureDefinitionId()
  if (!cultureId) throw new Error('moderation_v2_judge_smoke_missing_culture_definition')

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
    const badEvalResp = await fetch(`${base}/api/moderation/judge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: 'smoke_judge_bad_eval',
        evaluation_id: '01HZX3N2Q7N0B1YJQ4W5Z6K7M8',
        culture_id: cultureId,
        policy_profile_id: 'moderation_default',
      }),
    })
    assert(badEvalResp.status === 404, `expected bad eval status=404, got=${badEvalResp.status}`)
    const badEvalBody = (await badEvalResp.json()) as any
    assert(badEvalBody?.error === 'evaluation_not_found', `expected evaluation_not_found, got=${badEvalBody?.error}`)

    const measureResp = await fetch(`${base}/api/moderation/measure`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: 'smoke_judge_measure_01',
        content: {
          content_id: 'video_987',
          content_type: 'video',
          language: 'en',
          segment: {
            start_seconds: 0,
            end_seconds: 12,
            vtt_text:
              'WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nThis city has the highest crime rate in the country.',
          },
        },
        report: {
          report_id: reportId,
          reason_code: 'misinformation',
          free_text: 'smoke',
        },
        rules: [
          {
            issue_id: 'unsupported_factual_assertion',
            issue_class: 'cultural',
            rule_version: 'v1',
            ai_spec: { signals: { claim_type: ['factual_assertion'] } },
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

    const badPolicyResp = await fetch(`${base}/api/moderation/judge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: 'smoke_judge_bad_policy',
        evaluation_id: evaluationId,
        culture_id: cultureId,
        policy_profile_id: 'missing_profile',
      }),
    })
    assert(badPolicyResp.status === 404, `expected missing profile status=404, got=${badPolicyResp.status}`)
    const badPolicyBody = (await badPolicyResp.json()) as any
    assert(badPolicyBody?.error === 'policy_profile_not_found', `expected policy_profile_not_found, got=${badPolicyBody?.error}`)

    const badCultureResp = await fetch(`${base}/api/moderation/judge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: 'smoke_judge_bad_culture',
        evaluation_id: evaluationId,
        culture_id: 'missing_culture',
        policy_profile_id: 'moderation_default',
      }),
    })
    assert(badCultureResp.status === 404, `expected missing culture status=404, got=${badCultureResp.status}`)
    const badCultureBody = (await badCultureResp.json()) as any
    assert(badCultureBody?.error === 'culture_not_found', `expected culture_not_found, got=${badCultureBody?.error}`)

    const judgeResp = await fetch(`${base}/api/moderation/judge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: 'smoke_judge_01',
        evaluation_id: evaluationId,
        culture_id: cultureId,
        policy_profile_id: 'moderation_default',
      }),
    })
    assert(judgeResp.status === 200, `expected judge status=200, got=${judgeResp.status}`)
    const judged = (await judgeResp.json()) as any
    assert(judged?.evaluation_id === evaluationId, 'expected matching evaluation_id in judge response')
    assert(judged?.judgment_meta?.policy_profile_id === 'moderation_default', 'expected policy profile in judgment meta')
    assert(judged?.ai_judgment?.decision_basis?.judgment_stage_seq === 1, 'expected first judgment stage seq')

    const judgeResp2 = await fetch(`${base}/api/moderation/judge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: 'smoke_judge_02',
        evaluation_id: evaluationId,
        culture_id: cultureId,
        policy_profile_id: 'moderation_default',
      }),
    })
    assert(judgeResp2.status === 200, `expected second judge status=200, got=${judgeResp2.status}`)
    const judged2 = (await judgeResp2.json()) as any
    assert(judged2?.ai_judgment?.decision_basis?.judgment_stage_seq === 2, 'expected second judgment stage seq')

    const noMatchMeasureResp = await fetch(`${base}/api/moderation/measure`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: 'smoke_judge_measure_nomatch_01',
        content: {
          content_id: 'video_654',
          content_type: 'video',
          language: 'en',
          segment: {
            start_seconds: 0,
            end_seconds: 8,
            vtt_text: 'WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nI like sandwiches and sunshine.',
          },
        },
        report: {
          report_id: reportId,
          reason_code: 'other',
          free_text: 'smoke no match',
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
    assert(noMatchMeasureResp.status === 200, `expected no-match measure status=200, got=${noMatchMeasureResp.status}`)
    const noMatchMeasured = (await noMatchMeasureResp.json()) as any
    const noMatchEvaluationId = String(noMatchMeasured?.evaluation_id || '')
    assert(noMatchEvaluationId.length === 26, 'expected no-match evaluation_id from measure')
    assert(Array.isArray(noMatchMeasured?.assessments) && noMatchMeasured.assessments.length === 0, 'expected empty assessments for no-match measure')

    const noMatchJudgeResp = await fetch(`${base}/api/moderation/judge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: 'smoke_judge_nomatch_01',
        evaluation_id: noMatchEvaluationId,
        culture_id: cultureId,
        policy_profile_id: 'moderation_default',
      }),
    })
    assert(noMatchJudgeResp.status === 200, `expected no-match judge status=200, got=${noMatchJudgeResp.status}`)
    const noMatchJudged = (await noMatchJudgeResp.json()) as any
    assert(noMatchJudged?.ai_judgment?.outcome === 'dismiss', `expected dismiss outcome for no-match judgment, got=${noMatchJudged?.ai_judgment?.outcome}`)
    assert(noMatchJudged?.ai_judgment?.action_type === 'none', `expected none action_type for no-match judgment, got=${noMatchJudged?.ai_judgment?.action_type}`)
    assert(noMatchJudged?.ai_judgment?.primary_issue_id == null, 'expected null primary_issue_id for no-match judgment')

    const db = getPool()
    const [rows] = await db.query(
      `SELECT status, judged_at
         FROM moderation_evaluations
        WHERE evaluation_id = ?
        LIMIT 1`,
      [evaluationId]
    )
    const row = Array.isArray(rows) ? (rows as any[])[0] : null
    assert(Boolean(row), 'expected moderation_evaluations row')
    assert(String(row.status) === 'judged', `expected judged status, got=${String(row.status)}`)
    assert(Boolean(row.judged_at), 'expected judged_at to be set')

    const [judgmentRows] = await db.query(
      `SELECT evaluation_id, stage_seq, policy_profile_id, culture_id
         FROM moderation_judgments
        WHERE evaluation_id = ?
        ORDER BY stage_seq ASC, id ASC`,
      [evaluationId]
    )
    const judgments = Array.isArray(judgmentRows) ? (judgmentRows as any[]) : []
    assert(judgments.length >= 2, `expected at least 2 moderation_judgments rows, got=${judgments.length}`)
    assert(String(judgments[0].policy_profile_id) === 'moderation_default', 'expected persisted policy profile on first judgment')
    assert(String(judgments[0].culture_id) === cultureId, 'expected persisted culture id on first judgment')
    assert(Number(judgments[0].stage_seq) === 1, `expected first judgment stage_seq=1, got=${judgments[0].stage_seq}`)
    assert(Number(judgments[1].stage_seq) === 2, `expected second judgment stage_seq=2, got=${judgments[1].stage_seq}`)

    console.log('[moderation-v2-judge-smoke] ok')
  } finally {
    await closeServer()
  }
}

main().catch((err) => {
  console.error('[moderation-v2-judge-smoke] failed', err)
  process.exit(1)
})
