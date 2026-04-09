import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { getPool } from '../src/db'
import { getModerationEvaluationDebugBundle } from '../src/features/moderation-v2/debug'

function arg(name: string): string | null {
  const idx = process.argv.findIndex((a) => a === name || a.startsWith(`${name}=`))
  if (idx === -1) return null
  const raw = process.argv[idx]
  if (raw.includes('=')) return raw.split('=').slice(1).join('=') || null
  return process.argv[idx + 1] || null
}

function usage(): void {
  console.log(
    'Usage: ts-node scripts/moderation-v2-evaluation-debug.ts --evaluation-id <ULID> [--json] [--out-dir <dir>]'
  )
}

async function main() {
  const evaluationId = String(arg('--evaluation-id') || '').trim()
  const printJson = process.argv.includes('--json')
  const outDirRaw = String(arg('--out-dir') || '').trim()
  if (!evaluationId) {
    usage()
    process.exit(2)
  }

  const db = getPool()
  try {
    const bundle = await getModerationEvaluationDebugBundle(evaluationId, db as any)
    if (outDirRaw) {
      const outDir = path.resolve(outDirRaw)
      fs.mkdirSync(outDir, { recursive: true })
      fs.writeFileSync(
        path.join(outDir, `moderation-evaluation-${evaluationId}.json`),
        JSON.stringify(bundle, null, 2) + '\n'
      )
      for (const row of bundle.replay.measure_requests) {
        fs.writeFileSync(
          path.join(outDir, `measure-stage-${row.stage_seq}.json`),
          JSON.stringify(row.request, null, 2) + '\n'
        )
      }
      for (const row of bundle.replay.judge_requests) {
        fs.writeFileSync(
          path.join(outDir, `judge-stage-${row.stage_seq}.json`),
          JSON.stringify(row.request, null, 2) + '\n'
        )
      }
      for (const row of bundle.replay.review_requests) {
        fs.writeFileSync(
          path.join(outDir, `review-stage-${row.review_seq}.json`),
          JSON.stringify(row.request, null, 2) + '\n'
        )
      }
      console.log(`wrote replay bundle to ${outDir}`)
    }

    if (printJson) {
      console.log(JSON.stringify(bundle, null, 2))
      return
    }

    console.log(`evaluation_id\t${bundle.summary.evaluation_id}`)
    console.log(`report_id\t${bundle.summary.report_id}`)
    console.log(`status\t${bundle.summary.status}`)
    console.log(
      `final_disposition\t${bundle.summary.final_disposition_source || '-'} / ${bundle.summary.final_outcome || '-'} / ${bundle.summary.final_action_type || '-'}`
    )
    console.log(
      `measurement\tcount=${bundle.summary.measurement_stage_count} latest_seq=${bundle.summary.latest_measurement_stage_seq || '-'} matched=${bundle.summary.latest_measurement_match_count}`
    )
    console.log(
      `judgment\tcount=${bundle.summary.judgment_stage_count} latest_seq=${bundle.summary.latest_judgment_stage_seq || '-'} outcome=${bundle.summary.latest_judgment_outcome || '-'} action=${bundle.summary.latest_judgment_action_type || '-'}`
    )
    console.log(
      `review\tcount=${bundle.summary.review_count} latest_seq=${bundle.summary.latest_review_seq || '-'} decision=${bundle.summary.latest_review_decision || '-'}`
    )
    if (bundle.report) {
      console.log(
        `report_status\t${String(bundle.report.status || '-')} resolution=${String(bundle.report.resolution_code || '-')}`
      )
    }
    console.log(`report_actions\t${bundle.reportActions.length}`)
    console.log(`replay_measure_requests\t${bundle.replay.measure_requests.length}`)
    console.log(`replay_judge_requests\t${bundle.replay.judge_requests.length}`)
    console.log(`replay_review_requests\t${bundle.replay.review_requests.length}`)
  } finally {
    await db.end().catch(() => undefined)
  }
}

main().catch((err) => {
  console.error('moderation:v2:evaluation:debug failed', err)
  process.exit(1)
})
