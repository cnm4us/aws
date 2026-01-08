import fs from 'fs'
import os from 'os'
import path from 'path'
import { MEDIA_JOBS_LOGS_BUCKET, MEDIA_JOBS_LOGS_PREFIX, MEDIA_JOBS_WORKER_ENABLED, MEDIA_JOBS_WORKER_HEARTBEAT_MS, MEDIA_JOBS_WORKER_POLL_MS, UPLOAD_BUCKET } from '../../config'
import { writeRequestLog } from '../../utils/requestLog'
import { getPool } from '../../db'
import * as mediaJobs from '../../features/media-jobs/service'
import * as mediaJobsRepo from '../../features/media-jobs/repo'
import { runAudioMasterV1Job } from '../../media/jobs/audioMasterV1'
import { runAssemblyAiTranscriptV1Job } from '../../media/jobs/assemblyAiTranscriptV1'
import { runUploadThumbV1Job } from '../../media/jobs/uploadThumbV1'
import { runVideoMasterV1Job } from '../../media/jobs/videoMasterV1'
import { startMediaConvertForExistingProduction } from '../productionRunner'
import { uploadFileToS3, uploadTextToS3 } from './s3Logs'

let workerTimer: ReturnType<typeof setInterval> | undefined
let tickRunning = false

function getWorkerId() {
  const raw = process.env.MEDIA_JOBS_WORKER_ID
  if (raw && String(raw).trim()) return String(raw).trim()
  return `${os.hostname()}:${process.pid}`
}

export function startMediaJobsWorker() {
  if (!MEDIA_JOBS_WORKER_ENABLED) return
  if (workerTimer) return
  const workerId = getWorkerId()

  const tick = async () => {
    if (tickRunning) return
    tickRunning = true
    try {
      const claimed = await mediaJobs.claimNextJobWithAttempt({ workerId, type: null })
      if (!claimed) return
      await runOne(claimed.job, claimed.attempt, workerId)
    } catch (err) {
      console.error('media_jobs_worker_tick_failed', err)
    } finally {
      tickRunning = false
    }
  }

  tick().catch(() => {})
  workerTimer = setInterval(() => tick().catch(() => {}), MEDIA_JOBS_WORKER_POLL_MS)
  console.log(`Media jobs worker started (${workerId}) poll=${MEDIA_JOBS_WORKER_POLL_MS}ms`)
}

async function runOne(job: any, attempt: any, workerId: string) {
  const jobId = Number(job.id)
  const attemptNo = Number(attempt.attempt_no)
  const logPrefix = `${MEDIA_JOBS_LOGS_PREFIX}${jobId}/${attemptNo}/`
  const stdoutPath = path.join(os.tmpdir(), `media-job-${jobId}-${attemptNo}-stdout.log`)
  const stderrPath = path.join(os.tmpdir(), `media-job-${jobId}-${attemptNo}-stderr.log`)
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined

  try {
    fs.writeFileSync(stdoutPath, '')
    fs.writeFileSync(stderrPath, '')
  } catch {}

  try {
    heartbeatTimer = setInterval(() => {
      mediaJobsRepo.updateJobProcessingHeartbeat(jobId, workerId).catch(() => {})
    }, Math.max(3000, MEDIA_JOBS_WORKER_HEARTBEAT_MS || 15000))

    const startedAt = new Date().toISOString()
    writeRequestLog(`media-job:${jobId}:${attemptNo}`, { jobId, attemptNo, workerId, type: job.type, input: job.input_json, startedAt })

    if (String(job.type) === 'audio_master_v1') {
      const input = job.input_json as any
      const result = await runAudioMasterV1Job(input, { stdoutPath, stderrPath })

      // Orchestrate: once we have a mastered MP4, start the MediaConvert packaging job for the existing production.
      const pool = getPool()
      const [prodRows] = await pool.query(`SELECT id, ulid, config FROM productions WHERE id = ? LIMIT 1`, [Number(input.productionId)])
      const prod = (prodRows as any[])[0]
      if (!prod) throw new Error('production_not_found')
      const cfg = typeof prod.config === 'string' ? JSON.parse(prod.config) : (prod.config || {})
      const cfgForMc = { ...cfg }
      if (result && (result as any).screenTitleOverlays) {
        ;(cfgForMc as any).screenTitleOverlays = (result as any).screenTitleOverlays
      }
      const [upRows] = await pool.query(`SELECT * FROM uploads WHERE id = ? LIMIT 1`, [Number(input.uploadId)])
      const upload = (upRows as any[])[0]
      if (!upload) throw new Error('upload_not_found')

      const masteredUrl = result?.output?.s3Url
      if (!masteredUrl) throw new Error('missing_master_output')

      const mc = await startMediaConvertForExistingProduction({
        upload,
        productionId: Number(input.productionId),
        productionUlid: String(prod.ulid || input.productionUlid || ''),
        profile: cfgForMc.profile ?? null,
        quality: cfgForMc.quality ?? null,
        sound: cfgForMc.sound ?? null,
        configPayload: cfgForMc,
        inputUrlOverride: String(masteredUrl),
        skipInlineAudioMux: true,
        skipAudioNormalization: true,
      })
      const finalResult = { ...result, mediaconvert: mc }

      const stdoutPtr = fs.existsSync(stdoutPath) ? await uploadFileToS3(MEDIA_JOBS_LOGS_BUCKET, `${logPrefix}stdout.log`, stdoutPath) : null
      const stderrPtr = fs.existsSync(stderrPath) ? await uploadFileToS3(MEDIA_JOBS_LOGS_BUCKET, `${logPrefix}stderr.log`, stderrPath) : null

      await mediaJobsRepo.finishAttempt(Number(attempt.id), {
        exitCode: 0,
        stdout: stdoutPtr || undefined,
        stderr: stderrPtr || undefined,
      })
      await mediaJobsRepo.completeJob(jobId, finalResult)
      return
    }

    if (String(job.type) === 'video_master_v1') {
      const input = job.input_json as any
      const result = await runVideoMasterV1Job(input, { stdoutPath, stderrPath })

      const pool = getPool()
      const [prodRows] = await pool.query(`SELECT id, ulid, config FROM productions WHERE id = ? LIMIT 1`, [Number(input.productionId)])
      const prod = (prodRows as any[])[0]
      if (!prod) throw new Error('production_not_found')
      const cfg = typeof prod.config === 'string' ? JSON.parse(prod.config) : (prod.config || {})
      const cfgForMc = { ...cfg }
      if (result && (result as any).screenTitleOverlays) {
        ;(cfgForMc as any).screenTitleOverlays = (result as any).screenTitleOverlays
      }
      const [upRows] = await pool.query(`SELECT * FROM uploads WHERE id = ? LIMIT 1`, [Number(input.uploadId)])
      const upload = (upRows as any[])[0]
      if (!upload) throw new Error('upload_not_found')

      const masteredUrl = result?.output?.s3Url
      if (!masteredUrl) throw new Error('missing_master_output')

      const mc = await startMediaConvertForExistingProduction({
        upload,
        productionId: Number(input.productionId),
        productionUlid: String(prod.ulid || input.productionUlid || ''),
        profile: cfgForMc.profile ?? null,
        quality: cfgForMc.quality ?? null,
        sound: cfgForMc.sound ?? null,
        configPayload: cfgForMc,
        inputUrlOverride: String(masteredUrl),
        skipInlineAudioMux: false,
        skipAudioNormalization: false,
      })
      const finalResult = { ...result, mediaconvert: mc }

      const stdoutPtr = fs.existsSync(stdoutPath) ? await uploadFileToS3(MEDIA_JOBS_LOGS_BUCKET, `${logPrefix}stdout.log`, stdoutPath) : null
      const stderrPtr = fs.existsSync(stderrPath) ? await uploadFileToS3(MEDIA_JOBS_LOGS_BUCKET, `${logPrefix}stderr.log`, stderrPath) : null

      await mediaJobsRepo.finishAttempt(Number(attempt.id), {
        exitCode: 0,
        stdout: stdoutPtr || undefined,
        stderr: stderrPtr || undefined,
      })
      await mediaJobsRepo.completeJob(jobId, finalResult)
      return
    }

    if (String(job.type) === 'upload_thumb_v1') {
      const input = job.input_json as any
      const result = await runUploadThumbV1Job(input, { stdoutPath, stderrPath })
      const stdoutPtr = fs.existsSync(stdoutPath) ? await uploadFileToS3(MEDIA_JOBS_LOGS_BUCKET, `${logPrefix}stdout.log`, stdoutPath) : null
      const stderrPtr = fs.existsSync(stderrPath) ? await uploadFileToS3(MEDIA_JOBS_LOGS_BUCKET, `${logPrefix}stderr.log`, stderrPath) : null

      await mediaJobsRepo.finishAttempt(Number(attempt.id), {
        exitCode: 0,
        stdout: stdoutPtr || undefined,
        stderr: stderrPtr || undefined,
      })
      await mediaJobsRepo.completeJob(jobId, result)
      return
    }

    if (String(job.type) === 'assemblyai_transcript_v1') {
      const input = job.input_json as any
      const result = await runAssemblyAiTranscriptV1Job(input, { stdoutPath, stderrPath })
      const stdoutPtr = fs.existsSync(stdoutPath) ? await uploadFileToS3(MEDIA_JOBS_LOGS_BUCKET, `${logPrefix}stdout.log`, stdoutPath) : null
      const stderrPtr = fs.existsSync(stderrPath) ? await uploadFileToS3(MEDIA_JOBS_LOGS_BUCKET, `${logPrefix}stderr.log`, stderrPath) : null

      await mediaJobsRepo.finishAttempt(Number(attempt.id), {
        exitCode: 0,
        stdout: stdoutPtr || undefined,
        stderr: stderrPtr || undefined,
      })
      await mediaJobsRepo.completeJob(jobId, result)
      return
    }

    const msg = `unsupported_job_type:${String(job.type)}`
    await uploadTextToS3(MEDIA_JOBS_LOGS_BUCKET, `${logPrefix}stderr.log`, msg)
    await mediaJobsRepo.finishAttempt(Number(attempt.id), { exitCode: 2, stderr: { bucket: MEDIA_JOBS_LOGS_BUCKET, key: `${logPrefix}stderr.log` } })
    await mediaJobsRepo.failJob(jobId, { status: 'dead', errorCode: 'unsupported_type', errorMessage: msg })
  } catch (err: any) {
    const message = err?.stack ? String(err.stack) : String(err || 'unknown_error')
    try {
      await uploadTextToS3(MEDIA_JOBS_LOGS_BUCKET, `${logPrefix}stderr.log`, message)
      await mediaJobsRepo.finishAttempt(Number(attempt.id), { exitCode: 1, stderr: { bucket: MEDIA_JOBS_LOGS_BUCKET, key: `${logPrefix}stderr.log` } })
    } catch {}
    await mediaJobsRepo.failJob(jobId, { status: 'failed', errorCode: 'failed', errorMessage: message })
  } finally {
    if (heartbeatTimer) {
      try { clearInterval(heartbeatTimer) } catch {}
    }
    try { fs.rmSync(stdoutPath, { force: true }) } catch {}
    try { fs.rmSync(stderrPath, { force: true }) } catch {}
    try { await mediaJobsRepo.updateJobProcessingHeartbeat(jobId, workerId) } catch {}
  }
}
