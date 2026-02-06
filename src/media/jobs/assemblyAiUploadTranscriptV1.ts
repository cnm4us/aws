import fs from 'fs'
import path from 'path'
import { getPool } from '../../db'
import type { AssemblyAiUploadTranscriptV1Input, S3Pointer } from '../../features/media-jobs/types'
import { ASSEMBLYAI_POLL_INTERVAL_MS, ASSEMBLYAI_POLL_TIMEOUT_SECONDS, ASSEMBLYAI_PRESIGN_TTL_SECONDS, UPLOAD_BUCKET, MEDIA_JOBS_LOGS_BUCKET } from '../../config'
import { presignGetObjectUrl } from '../../services/s3Presign'
import { createTranscript, fetchVtt, waitForTranscript } from '../../services/assemblyai'
import { uploadTextToS3 } from '../../services/mediaJobs/s3Logs'
import * as captionsRepo from '../../features/captions/repo'

function appendLog(filePath: string | undefined, line: string) {
  if (!filePath) return
  try {
    fs.appendFileSync(filePath, `${line}\n`, 'utf8')
  } catch {}
}

async function resolveUploadSource(uploadId: number): Promise<S3Pointer> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT s3_bucket, s3_key
       FROM uploads
      WHERE id = ?
      LIMIT 1`,
    [uploadId]
  )
  const row = (rows as any[])[0]
  if (!row) throw new Error('upload_not_found')
  const bucket = String(row.s3_bucket || '').trim()
  const key = String(row.s3_key || '').trim()
  if (!bucket || !key) throw new Error('missing_upload_pointer')
  return { bucket, key }
}

export async function runAssemblyAiUploadTranscriptV1Job(
  input: AssemblyAiUploadTranscriptV1Input,
  logPaths?: { stdoutPath?: string; stderrPath?: string }
): Promise<{ uploadId: number; transcriptId: string; source: S3Pointer; vtt: { localPath: string; s3?: { bucket: string; key: string } | null } }> {
  const uploadId = Number(input.uploadId)
  if (!Number.isFinite(uploadId) || uploadId <= 0) throw new Error('bad_upload_id')

  appendLog(logPaths?.stdoutPath, `assemblyai_upload_transcript_v1 start uploadId=${uploadId}`)

  const source = await resolveUploadSource(uploadId)
  appendLog(logPaths?.stdoutPath, `source s3://${source.bucket}/${source.key}`)

  const audioUrl = await presignGetObjectUrl({
    bucket: source.bucket,
    key: source.key,
    expiresInSeconds: ASSEMBLYAI_PRESIGN_TTL_SECONDS,
  })

  const { id: transcriptId } = await createTranscript(audioUrl)
  appendLog(logPaths?.stdoutPath, `transcriptId=${transcriptId}`)

  const done = await waitForTranscript(transcriptId, {
    pollIntervalMs: ASSEMBLYAI_POLL_INTERVAL_MS,
    timeoutSeconds: ASSEMBLYAI_POLL_TIMEOUT_SECONDS,
  })
  if (done.status !== 'completed') {
    appendLog(logPaths?.stderrPath, `assemblyai_failed status=${done.status} error=${done.error || ''}`)
    throw new Error(`assemblyai_failed:${done.error || 'error'}`)
  }

  const vtt = await fetchVtt(transcriptId)

  const outDir = path.join(process.cwd(), 'logs', 'assemblyai')
  fs.mkdirSync(outDir, { recursive: true })
  const localPath = path.join(outDir, `upload_${uploadId}.vtt`)
  fs.writeFileSync(localPath, vtt, 'utf8')
  appendLog(logPaths?.stdoutPath, `wrote_vtt ${localPath}`)

  const stableBucket = String(UPLOAD_BUCKET || source.bucket || '').trim()
  const stableKey = `captions/vtt/upload_${uploadId}.vtt`
  let stableS3: { bucket: string; key: string } | null = null
  try {
    stableS3 = await uploadTextToS3(stableBucket, stableKey, vtt, 'text/vtt; charset=utf-8')
    await captionsRepo.upsertUploadCaptions({
      uploadId,
      provider: 'assemblyai',
      transcriptId,
      format: 'vtt',
      language: 'en',
      bucket: stableS3.bucket,
      key: stableS3.key,
      status: 'ready',
    })
  } catch (e: any) {
    appendLog(logPaths?.stderrPath, `captions_persist_failed ${(e?.message || e)}`)
    try {
      await captionsRepo.upsertUploadCaptions({
        uploadId,
        provider: 'assemblyai',
        transcriptId,
        format: 'vtt',
        language: 'en',
        bucket: stableBucket || source.bucket,
        key: stableKey,
        status: 'failed',
      })
    } catch {}
  }

  let s3Ptr: { bucket: string; key: string } | null = null
  try {
    s3Ptr = await uploadTextToS3(MEDIA_JOBS_LOGS_BUCKET, `assemblyai/upload_${uploadId}.vtt`, vtt, 'text/vtt; charset=utf-8')
  } catch {}

  return {
    uploadId,
    transcriptId,
    source,
    vtt: { localPath, s3: stableS3 || s3Ptr },
  }
}
