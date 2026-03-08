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
import { runAssemblyAiUploadTranscriptV1Job } from '../../media/jobs/assemblyAiUploadTranscriptV1'
import { runUploadAudioEnvelopeV1Job } from '../../media/jobs/uploadAudioEnvelopeV1'
import { runUploadEditProxyV1Job } from '../../media/jobs/uploadEditProxyV1'
import { runUploadFreezeFrameV1Job } from '../../media/jobs/uploadFreezeFrameV1'
import { runUploadThumbV1Job } from '../../media/jobs/uploadThumbV1'
import { runVideoMasterV1Job } from '../../media/jobs/videoMasterV1'
import { runCreateVideoExportV1Job } from '../../media/jobs/createVideoExportV1'
import { startMediaConvertForExistingProduction } from '../productionRunner'
import { uploadFileToS3, uploadTextToS3 } from './s3Logs'
import { setFfmpegOpsCollector, setFfmpegS3OpsCollector } from '../ffmpeg/audioPipeline'
import { buildUploadEditProxyKey } from '../../utils/uploadEditProxy'
import { buildUploadAudioEnvelopeKey } from '../../utils/uploadAudioEnvelope'
import { buildUploadThumbKey } from '../../utils/uploadThumb'
import { getLogger, logError } from '../../lib/logger'
import {
  annotateMediaJobSpanOutcome,
  recordMediaJobMetrics,
  withMediaJobSpan,
  withMediaJobStage,
} from './observability'

let workerTimer: ReturnType<typeof setInterval> | undefined
let tickRunning = false
let stopping = false
let cachedHostMetrics: { instanceType: string | null; cpuCores: number; memGb: number; hostname: string } | null = null
const workerLogger = getLogger({ component: 'media_jobs_worker' })

async function fetchWithTimeout(url: string, opts: any, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...(opts || {}), signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function getInstanceType(): Promise<string | null> {
  const envVal = String(process.env.AWS_INSTANCE_TYPE || process.env.EC2_INSTANCE_TYPE || '').trim()
  if (envVal) return envVal
  const base = 'http://169.254.169.254/latest'
  try {
    const tokenResp = await fetchWithTimeout(
      `${base}/api/token`,
      { method: 'PUT', headers: { 'x-aws-ec2-metadata-token-ttl-seconds': '21600' } },
      800
    )
    if (tokenResp.ok) {
      const token = await tokenResp.text()
      const metaResp = await fetchWithTimeout(
        `${base}/meta-data/instance-type`,
        { headers: { 'x-aws-ec2-metadata-token': token } },
        800
      )
      if (metaResp.ok) {
        const txt = String(await metaResp.text()).trim()
        return txt || null
      }
    }
  } catch {}
  try {
    const resp = await fetchWithTimeout(`${base}/meta-data/instance-type`, { method: 'GET' }, 800)
    if (resp.ok) {
      const txt = String(await resp.text()).trim()
      return txt || null
    }
  } catch {}
  return null
}

async function getHostMetrics() {
  if (cachedHostMetrics) return cachedHostMetrics
  const instanceType = await getInstanceType()
  const cpuCores = Math.max(1, os.cpus().length)
  const memGb = Math.round((os.totalmem() / 1e9) * 10) / 10
  cachedHostMetrics = { instanceType, cpuCores, memGb, hostname: os.hostname() }
  return cachedHostMetrics
}

function getWorkerId() {
  const raw = process.env.MEDIA_JOBS_WORKER_ID
  if (raw && String(raw).trim()) return String(raw).trim()
  return `${os.hostname()}:${process.pid}`
}

export function startMediaJobsWorker() {
  if (!MEDIA_JOBS_WORKER_ENABLED) return
  if (workerTimer) return
  stopping = false
  const workerId = getWorkerId()

  const tick = async () => {
    if (stopping) return
    if (tickRunning) return
    tickRunning = true
    try {
      const claimed = await mediaJobs.claimNextJobWithAttempt({ workerId, type: null })
      if (!claimed) return
      await runOne(claimed.job, claimed.attempt, workerId)
    } catch (err) {
      const msg = String((err as any)?.message || err || '')
      // If the DB pool is closed during shutdown/restart, stop the worker to avoid log spam.
      if (msg.includes('Pool is closed')) {
        stopMediaJobsWorker()
        return
      }
      logError(workerLogger, err, 'media_jobs_worker_tick_failed')
    } finally {
      tickRunning = false
    }
  }

  tick().catch(() => {})
  workerTimer = setInterval(() => tick().catch(() => {}), MEDIA_JOBS_WORKER_POLL_MS)
  workerLogger.info({ worker_id: workerId, poll_ms: MEDIA_JOBS_WORKER_POLL_MS }, 'media_jobs_worker_started')
}

export function stopMediaJobsWorker() {
  stopping = true
  if (workerTimer) {
    try { clearInterval(workerTimer) } catch {}
    workerTimer = undefined
  }
}

export async function stopMediaJobsWorkerAndWait(opts?: { timeoutMs?: number }) {
  stopMediaJobsWorker()
  const timeoutMs = Math.max(0, Math.round(Number(opts?.timeoutMs ?? 1500)))
  const deadline = Date.now() + timeoutMs
  while (tickRunning && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return !tickRunning
}

async function runOne(job: any, attempt: any, workerId: string) {
  const jobId = Number(job.id)
  const attemptNo = Number(attempt.attempt_no)
  const jobType = String(job?.type || 'unknown')
  const jobInput = (job?.input_json || {}) as any
  const logPrefix = `${MEDIA_JOBS_LOGS_PREFIX}${jobId}/${attemptNo}/`
  const stdoutPath = path.join(os.tmpdir(), `media-job-${jobId}-${attemptNo}-stdout.log`)
  const stderrPath = path.join(os.tmpdir(), `media-job-${jobId}-${attemptNo}-stderr.log`)
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  const s3Ops: any[] = []
  const errors: Array<{ code?: string; message?: string }> = []
  const ffmpegOps: any[] = []
  let startedMs = Date.now()
  let startedAt = new Date().toISOString()
  let inputSummary: any = { keys: [] as string[] }
  let metricsInput: any = null
  let hostMetrics: any = null
  let finalStatus: 'completed' | 'failed' | 'dead' | 'unknown' = 'unknown'
  let finalErrorCode: string | null = null
  let finalErrorMessage: string | null = null
  const parseTimeMs = (v: unknown): number | null => {
    const t = new Date(String(v || '')).getTime()
    return Number.isFinite(t) ? t : null
  }
  const jobCreatedMs = parseTimeMs((job as any)?.created_at ?? (job as any)?.createdAt)
  const jobOperation = jobType === 'create_video_export_v1' ? 'create_video.export.process' : 'mediajobs.attempt.process'
  const stageAttrs = {
    'app.operation': jobOperation,
    'app.operation_family': 'mediajobs.attempt.process',
    mediajob_id: jobId,
    mediajob_attempt_no: attemptNo,
    mediajob_type: jobType,
    worker_id: workerId,
    project_id: Number.isFinite(Number(jobInput?.projectId)) ? Number(jobInput?.projectId) : undefined,
    upload_id: Number.isFinite(Number(jobInput?.uploadId)) ? Number(jobInput?.uploadId) : undefined,
  }
  const runStage = <T>(stage: string, fn: () => Promise<T>) => withMediaJobStage(stage, stageAttrs, fn)
  const uploadStdLogs = async () => {
    return runStage('upload_outputs', async () => {
      const stdoutPtr = fs.existsSync(stdoutPath)
        ? await uploadFileToS3(MEDIA_JOBS_LOGS_BUCKET, `${logPrefix}stdout.log`, stdoutPath)
        : null
      const stderrPtr = fs.existsSync(stderrPath)
        ? await uploadFileToS3(MEDIA_JOBS_LOGS_BUCKET, `${logPrefix}stderr.log`, stderrPath)
        : null
      return { stdoutPtr, stderrPtr }
    })
  }
  const persistSuccess = async (result: any, opts?: { ffmpegCommands?: string[] }) => {
    const { stdoutPtr, stderrPtr } = await uploadStdLogs()
    await runStage('persist_results', async () => {
      await mediaJobsRepo.finishAttempt(Number(attempt.id), {
        exitCode: 0,
        stdout: stdoutPtr || undefined,
        stderr: stderrPtr || undefined,
        scratchManifestJson: buildManifest({ ffmpegCommands: opts?.ffmpegCommands || undefined }),
      })
      await mediaJobsRepo.completeJob(jobId, result)
    })
    finalStatus = 'completed'
    finalErrorCode = null
    finalErrorMessage = null
  }
  const buildManifest = (extra?: { ffmpegCommands?: string[] }) => {
    const cmds = Array.isArray(extra?.ffmpegCommands) ? extra?.ffmpegCommands : undefined
    const trimmed = cmds && cmds.length > 20 ? cmds.slice(cmds.length - 20) : cmds
    const ffmpegMs = ffmpegOps.reduce((sum, f) => sum + (Number(f?.durationMs) || 0), 0)
    const s3BytesIn = s3Ops.reduce((sum, o) => sum + (o?.op === 'download' ? Number(o?.bytes) || 0 : 0), 0)
    const s3BytesOut = s3Ops.reduce((sum, o) => sum + (o?.op === 'upload' ? Number(o?.bytes) || 0 : 0), 0)
    const durationMs = Date.now() - startedMs
    const durationSec = durationMs > 0 ? durationMs / 1000 : 0
    const overheadMs = durationMs - ffmpegMs
    const ioInBytesPerSec = durationSec > 0 ? s3BytesIn / durationSec : undefined
    const ioOutBytesPerSec = durationSec > 0 ? s3BytesOut / durationSec : undefined
    const inputDurationSeconds = Number(metricsInput?.durationSeconds ?? inputSummary?.duration)
    const rtf =
      Number.isFinite(inputDurationSeconds) && inputDurationSeconds > 0 && durationMs > 0
        ? Number(((durationMs / 1000) / inputDurationSeconds).toFixed(3))
        : undefined
    const metricsInputMerged =
      metricsInput ??
      (Number.isFinite(inputDurationSeconds) ? { durationSeconds: inputDurationSeconds } : undefined)
    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs,
      inputSummary,
      ffmpegCommands: trimmed,
      metrics: {
        ffmpegMs,
        overheadMs: Number.isFinite(overheadMs) ? overheadMs : undefined,
        s3BytesIn,
        s3BytesOut,
        ioInBytesPerSec,
        ioOutBytesPerSec,
        rtf,
        input: metricsInputMerged,
        host: hostMetrics || undefined,
      },
      s3Ops: s3Ops.length ? s3Ops : undefined,
      ffmpegOps: ffmpegOps.length ? ffmpegOps : undefined,
      errors: errors.length ? errors : undefined,
    }
  }

  try {
    fs.writeFileSync(stdoutPath, '')
    fs.writeFileSync(stderrPath, '')
  } catch {}

  await withMediaJobSpan(
    {
      ...stageAttrs,
      mediajob_attempt_id: Number.isFinite(Number(attempt?.id)) ? Number(attempt.id) : undefined,
      mediajob_queue: String((job as any)?.queue_name || (job as any)?.queue || ''),
    },
    async (jobSpan) => {
      try {
        heartbeatTimer = setInterval(() => {
          mediaJobsRepo.updateJobProcessingHeartbeat(jobId, workerId).catch(() => {})
        }, Math.max(3000, MEDIA_JOBS_WORKER_HEARTBEAT_MS || 15000))

        startedAt = new Date().toISOString()
        startedMs = Date.now()
        hostMetrics = await runStage('fetch_inputs', async () => getHostMetrics())
        setFfmpegS3OpsCollector(s3Ops)
        setFfmpegOpsCollector(ffmpegOps)
        writeRequestLog(`media-job:${jobId}:${attemptNo}`, {
          jobId,
          attemptNo,
          workerId,
          type: jobType,
          input: job.input_json,
          startedAt,
        })

        const summarizeInput = (type: string, input: any) => {
          const t = String(type || '')
          if (t === 'create_video_export_v1') {
            const tl = input?.timeline || {}
            return {
              projectId: input?.projectId ?? null,
              userId: input?.userId ?? null,
              traceId: input?.traceId ?? null,
              clips: Array.isArray(tl.clips) ? tl.clips.length : 0,
              stills: Array.isArray(tl.stills) ? tl.stills.length : 0,
              overlays: Array.isArray(tl.videoOverlays) ? tl.videoOverlays.length : 0,
              graphics: Array.isArray(tl.graphics) ? tl.graphics.length : 0,
              duration: tl?.playheadSeconds ?? null,
            }
          }
          if (t === 'upload_thumb_v1') {
            return {
              uploadId: input?.uploadId ?? null,
              outputKey: input?.outputKey ?? null,
              longEdgePx: input?.longEdgePx ?? null,
              traceId: input?.traceId ?? null,
            }
          }
          if (t === 'upload_edit_proxy_v1' || t === 'upload_audio_envelope_v1' || t === 'upload_freeze_frame_v1') {
            return {
              uploadId: input?.uploadId ?? null,
              bucket: input?.video?.bucket ?? input?.proxy?.bucket ?? null,
              key: input?.video?.key ?? input?.proxy?.key ?? null,
              traceId: input?.traceId ?? null,
            }
          }
          return { keys: Object.keys(input || {}) }
        }
        inputSummary = summarizeInput(jobType, job.input_json)

    if (jobType === 'audio_master_v1') {
      const input = job.input_json as any
      const result = await runStage('execute', async () => runAudioMasterV1Job(input, { stdoutPath, stderrPath }))

      // Orchestrate: once we have a mastered MP4, start the MediaConvert packaging job for the existing production.
      const pool = getPool()
      const [prodRows] = await pool.query(`SELECT id, ulid, config FROM productions WHERE id = ? LIMIT 1`, [Number(input.productionId)])
      const prod = (prodRows as any[])[0]
      if (!prod) throw new Error('production_not_found')
      const cfg = typeof prod.config === 'string' ? JSON.parse(prod.config) : (prod.config || {})
      const cfgForMc = { ...cfg }
      const [upRows] = await pool.query(`SELECT * FROM uploads WHERE id = ? LIMIT 1`, [Number(input.uploadId)])
      const upload = (upRows as any[])[0]
      if (!upload) throw new Error('upload_not_found')

      const masteredUrl = result?.output?.s3Url
      if (!masteredUrl) throw new Error('missing_master_output')

      const mc = await runStage('execute', async () =>
        startMediaConvertForExistingProduction({
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
      )
      const finalResult = { ...result, mediaconvert: mc }
      await persistSuccess(finalResult)
      return
    }

    if (jobType === 'video_master_v1') {
      const input = job.input_json as any
      const result = await runStage('execute', async () => runVideoMasterV1Job(input, { stdoutPath, stderrPath }))

      const pool = getPool()
      const [prodRows] = await pool.query(`SELECT id, ulid, config FROM productions WHERE id = ? LIMIT 1`, [Number(input.productionId)])
      const prod = (prodRows as any[])[0]
      if (!prod) throw new Error('production_not_found')
      const cfg = typeof prod.config === 'string' ? JSON.parse(prod.config) : (prod.config || {})
      const cfgForMc = { ...cfg }
      const [upRows] = await pool.query(`SELECT * FROM uploads WHERE id = ? LIMIT 1`, [Number(input.uploadId)])
      const upload = (upRows as any[])[0]
      if (!upload) throw new Error('upload_not_found')

      const masteredUrl = result?.output?.s3Url
      if (!masteredUrl) throw new Error('missing_master_output')

      const mc = await runStage('execute', async () =>
        startMediaConvertForExistingProduction({
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
      )
      const finalResult = { ...result, mediaconvert: mc }
      await persistSuccess(finalResult)
      return
    }

    if (jobType === 'create_video_export_v1') {
      const input = job.input_json as any
      const result = await runStage('execute', async () => runCreateVideoExportV1Job(input, { stdoutPath, stderrPath }))
      metricsInput = (result as any)?.metricsInput || null
      const ffmpegCommands = Array.isArray((result as any)?.ffmpegCommands) ? (result as any).ffmpegCommands : null
      await persistSuccess(result, { ffmpegCommands: ffmpegCommands || undefined })

      // Best-effort: record the resulting upload id on the project for quick resume.
      try {
        const projectId = Number(input?.projectId)
        const resultUploadId = Number((result as any)?.resultUploadId)
        if (Number.isFinite(projectId) && projectId > 0 && Number.isFinite(resultUploadId) && resultUploadId > 0) {
          const db = getPool()
          await db.query(
            `UPDATE create_video_projects
                SET last_export_upload_id = ?
              WHERE id = ?
              LIMIT 1`,
            [resultUploadId, projectId]
          )
        }
      } catch {}

      // Best-effort: generate thumb + edit proxy for the newly created upload so /produce can preview immediately.
      try {
        const resultUploadId = Number((result as any)?.resultUploadId)
        const userId = Number(input?.userId)
        const outBucket = String((result as any)?.output?.bucket || '')
        const outKey = String((result as any)?.output?.key || '')
        const traceId = (input as any)?.traceId
        if (Number.isFinite(resultUploadId) && resultUploadId > 0 && Number.isFinite(userId) && userId > 0 && outBucket && outKey) {
          await runStage('persist_results', async () => {
            await mediaJobs.enqueueJob('upload_thumb_v1', {
              uploadId: resultUploadId,
              userId,
              video: { bucket: outBucket, key: outKey },
              outputBucket: String(UPLOAD_BUCKET),
              outputKey: buildUploadThumbKey(resultUploadId),
              longEdgePx: 640,
              traceId,
            })
            await mediaJobs.enqueueJob('upload_edit_proxy_v1', {
              uploadId: resultUploadId,
              userId,
              video: { bucket: outBucket, key: outKey },
              outputBucket: String(UPLOAD_BUCKET),
              outputKey: buildUploadEditProxyKey(resultUploadId),
              longEdgePx: 540,
              fps: 30,
              gop: 8,
              traceId,
            })
          })
        }
      } catch {}
      return
    }

    if (jobType === 'upload_freeze_frame_v1') {
      const input = job.input_json as any
      const result = await runStage('execute', async () => runUploadFreezeFrameV1Job(input, { stdoutPath, stderrPath }))
      await persistSuccess(result)
      return
    }

    if (jobType === 'upload_thumb_v1') {
      const input = job.input_json as any
      const result = await runStage('execute', async () => runUploadThumbV1Job(input, { stdoutPath, stderrPath }))
      metricsInput = (result as any)?.metricsInput || null
      const ffmpegCommands = Array.isArray((result as any)?.ffmpegCommands) ? (result as any).ffmpegCommands : null
      await persistSuccess(result, { ffmpegCommands: ffmpegCommands || undefined })
      return
    }

    if (jobType === 'upload_edit_proxy_v1') {
      const input = job.input_json as any
      const result = await runStage('execute', async () => runUploadEditProxyV1Job(input, { stdoutPath, stderrPath }))
      metricsInput = (result as any)?.metricsInput || null
      await persistSuccess(result)

      // Best-effort: enqueue audio envelope once the edit proxy exists.
      try {
        const uploadId = Number(input.uploadId)
        const userId = Number(input.userId)
        if (Number.isFinite(uploadId) && uploadId > 0 && Number.isFinite(userId) && userId > 0) {
          let alreadyQueuedEnv = false
          try {
            const db = getPool()
            const [rows] = await db.query(
              `SELECT id
                 FROM media_jobs
                WHERE type = 'upload_audio_envelope_v1'
                  AND status IN ('pending','processing')
                  AND JSON_UNQUOTE(JSON_EXTRACT(input_json, '$.uploadId')) = ?
                ORDER BY id DESC
                LIMIT 1`,
              [String(uploadId)]
            )
            alreadyQueuedEnv = (rows as any[]).length > 0
          } catch {}
          if (!alreadyQueuedEnv) {
            await runStage('persist_results', async () => {
              await mediaJobs.enqueueJob('upload_audio_envelope_v1', {
                uploadId,
                userId,
                proxy: { bucket: String(UPLOAD_BUCKET), key: buildUploadEditProxyKey(uploadId) },
                outputBucket: String(UPLOAD_BUCKET),
                outputKey: buildUploadAudioEnvelopeKey(uploadId),
                intervalSeconds: 0.1,
                traceId: (input as any)?.traceId,
              })
            })
          }
        }
      } catch {}
      return
    }

    if (jobType === 'upload_audio_envelope_v1') {
      const input = job.input_json as any
      const result = await runStage('execute', async () => runUploadAudioEnvelopeV1Job(input, { stdoutPath, stderrPath }))
      metricsInput = (result as any)?.metricsInput || null
      await persistSuccess(result)
      return
    }

    if (jobType === 'assemblyai_transcript_v1') {
      const input = job.input_json as any
      const result = await runStage('execute', async () =>
        runAssemblyAiTranscriptV1Job(input, { stdoutPath, stderrPath }, {
          attrs: {
            mediajob_id: jobId,
            mediajob_attempt_no: attemptNo,
            mediajob_type: jobType,
          },
        })
      )
      await persistSuccess(result)
      return
    }

    if (jobType === 'assemblyai_upload_transcript_v1') {
      const input = job.input_json as any
      const result = await runStage('execute', async () =>
        runAssemblyAiUploadTranscriptV1Job(input, { stdoutPath, stderrPath }, {
          attrs: {
            mediajob_id: jobId,
            mediajob_attempt_no: attemptNo,
            mediajob_type: jobType,
          },
        })
      )
      await persistSuccess(result)
      return
    }

    const msg = `unsupported_job_type:${jobType}`
    await runStage('upload_outputs', async () =>
      uploadTextToS3(MEDIA_JOBS_LOGS_BUCKET, `${logPrefix}stderr.log`, msg)
    )
    errors.push({ code: 'unsupported_type', message: msg })
    await runStage('persist_results', async () => {
      await mediaJobsRepo.finishAttempt(Number(attempt.id), {
        exitCode: 2,
        stderr: { bucket: MEDIA_JOBS_LOGS_BUCKET, key: `${logPrefix}stderr.log` },
        scratchManifestJson: buildManifest(),
      })
      await mediaJobsRepo.failJob(jobId, { status: 'dead', errorCode: 'unsupported_type', errorMessage: msg })
    })
    finalStatus = 'dead'
    finalErrorCode = 'unsupported_type'
    finalErrorMessage = msg
  } catch (err: any) {
    const message = err?.stack ? String(err.stack) : String(err || 'unknown_error')
    finalStatus = 'failed'
    finalErrorCode = 'failed'
    finalErrorMessage = message
    try {
      await runStage('upload_outputs', async () =>
        uploadTextToS3(MEDIA_JOBS_LOGS_BUCKET, `${logPrefix}stderr.log`, message)
      )
      errors.push({ code: 'failed', message })
      await runStage('persist_results', async () => {
        await mediaJobsRepo.finishAttempt(Number(attempt.id), {
          exitCode: 1,
          stderr: { bucket: MEDIA_JOBS_LOGS_BUCKET, key: `${logPrefix}stderr.log` },
          scratchManifestJson: buildManifest(),
        })
      })
    } catch {}
    await runStage('persist_results', async () =>
      mediaJobsRepo.failJob(jobId, { status: 'failed', errorCode: 'failed', errorMessage: message })
    )
  } finally {
    const durationMs = Date.now() - startedMs
    const queueWaitMs = jobCreatedMs != null ? Math.max(0, startedMs - jobCreatedMs) : undefined
    const s3BytesIn = s3Ops.reduce((sum, o) => sum + (o?.op === 'download' ? Number(o?.bytes) || 0 : 0), 0)
    const s3BytesOut = s3Ops.reduce((sum, o) => sum + (o?.op === 'upload' ? Number(o?.bytes) || 0 : 0), 0)
    annotateMediaJobSpanOutcome(jobSpan, {
      status: finalStatus,
      errorCode: finalErrorCode || undefined,
      errorMessage: finalErrorMessage || undefined,
      durationMs,
      queueWaitMs,
      inputBytes: s3BytesIn,
      outputBytes: s3BytesOut,
    })
    recordMediaJobMetrics({
      type: jobType,
      status: finalStatus,
      errorCode: finalErrorCode || undefined,
      durationMs,
      queueWaitMs,
      inputBytes: s3BytesIn,
      outputBytes: s3BytesOut,
    })
    try {
      await mediaJobsRepo.updateAttemptAnalytics(Number(attempt.id), {
        queueWaitMs,
        durationMs,
        inputBytes: s3BytesIn,
        outputBytes: s3BytesOut,
        errorClass:
          finalStatus === 'failed' || finalStatus === 'dead'
            ? (finalErrorCode || finalStatus)
            : null,
      })
    } catch {}
    setFfmpegS3OpsCollector(null)
    setFfmpegOpsCollector(null)
    if (heartbeatTimer) {
      try {
        clearInterval(heartbeatTimer)
      } catch {}
    }
    try {
      fs.rmSync(stdoutPath, { force: true })
    } catch {}
    try {
      fs.rmSync(stderrPath, { force: true })
    } catch {}
    try {
      await mediaJobsRepo.updateJobProcessingHeartbeat(jobId, workerId)
    } catch {}
  }
    }
  )
}
