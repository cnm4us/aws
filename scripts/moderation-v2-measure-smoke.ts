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

async function main(): Promise<void> {
  const reportId = await getAnyReportId()
  if (!reportId) {
    throw new Error('moderation_v2_measure_smoke_missing_report: create at least one publication report first')
  }

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

  try {
    const invalidResp = await fetch(`${base}/api/moderation/measure`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    assert(invalidResp.status === 400, `expected invalid payload status=400, got=${invalidResp.status}`)
    const invalidBody = (await invalidResp.json()) as any
    assert(invalidBody?.error === 'invalid_measure_request', `expected invalid_measure_request, got=${invalidBody?.error}`)

    const validResp = await fetch(`${base}/api/moderation/measure`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: 'smoke_measure_endpoint_01',
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
            ai_spec: {
              signals: {
                claim_type: ['factual_assertion'],
              },
            },
          },
        ],
        options: {
          max_assessments: 20,
          include_non_matches: false,
        },
      }),
    })
    assert(validResp.status === 200, `expected valid payload status=200, got=${validResp.status}`)
    const validBody = (await validResp.json()) as any
    assert(typeof validBody?.evaluation_id === 'string' && validBody.evaluation_id.length === 26, 'expected evaluation_id')
    assert(Array.isArray(validBody?.assessments), 'expected assessments array')

    const db = getPool()
    const [rows] = await db.query(
      `SELECT evaluation_id, status
         FROM moderation_evaluations
        WHERE evaluation_id = ?
        LIMIT 1`,
      [validBody.evaluation_id]
    )
    const row = Array.isArray(rows) ? (rows as any[])[0] : null
    assert(Boolean(row), 'expected persisted moderation_evaluations row')
    assert(String(row.status) === 'measured', `expected measured status, got=${String(row.status)}`)

    console.log('[moderation-v2-measure-smoke] ok')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

main().catch((err) => {
  console.error('[moderation-v2-measure-smoke] failed', err)
  process.exit(1)
})

