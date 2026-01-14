import fs from 'fs'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import { getPool } from '../../db'
import { UPLOAD_BUCKET, UPLOAD_PREFIX } from '../../config'
import { buildUploadKey, nowDateYmd } from '../../utils/naming'
import { downloadS3ObjectToFile, runFfmpeg, uploadFileToS3 } from '../../services/ffmpeg/audioPipeline'
import { probeVideoDisplayDimensions } from '../../services/ffmpeg/visualPipeline'

type Clip = { id: string; uploadId: number; sourceStartSeconds: number; sourceEndSeconds: number }

export type CreateVideoExportV1Input = {
  projectId: number
  userId: number
  timeline: { version: 'create_video_v1'; clips: Clip[] }
}

function roundToTenth(n: number): number {
  return Math.round(n * 10) / 10
}

async function hasAudioStream(filePath: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const p = spawn(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=index', '-of', 'csv=p=0', filePath],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    )
    let out = ''
    p.stdout.on('data', (d) => { out += String(d) })
    p.on('close', (code) => {
      if (code !== 0) return resolve(false)
      resolve(Boolean(String(out || '').trim()))
    })
    p.on('error', () => resolve(false))
  })
}

async function probeDurationSeconds(filePath: string): Promise<number | null> {
  return await new Promise<number | null>((resolve) => {
    const p = spawn(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    )
    let out = ''
    p.stdout.on('data', (d) => { out += String(d) })
    p.on('close', (code) => {
      if (code !== 0) return resolve(null)
      const v = Number(String(out || '').trim())
      if (!Number.isFinite(v) || v <= 0) return resolve(null)
      resolve(v)
    })
    p.on('error', () => resolve(null))
  })
}

function even(n: number): number {
  const v = Math.max(2, Math.round(n))
  return v % 2 === 0 ? v : v - 1
}

function computeTargetDims(firstW: number, firstH: number): { w: number; h: number } {
  const maxLongEdge = 1080
  const longEdge = Math.max(firstW, firstH)
  const scale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1
  return { w: even(firstW * scale), h: even(firstH * scale) }
}

async function renderSegmentMp4(opts: {
  inPath: string
  outPath: string
  startSeconds: number
  endSeconds: number
  targetW: number
  targetH: number
  fps: number
  logPaths?: { stdoutPath?: string; stderrPath?: string }
}) {
  const start = roundToTenth(Math.max(0, Number(opts.startSeconds)))
  const end = roundToTenth(Math.max(0, Number(opts.endSeconds)))
  if (!(end > start)) throw new Error('invalid_segment_range')
  const dur = roundToTenth(end - start)
  const fps = Math.max(15, Math.min(60, Math.round(Number(opts.fps || 30))))
  const hasAudio = await hasAudioStream(opts.inPath)

  const scalePad = `scale=${opts.targetW}:${opts.targetH}:force_original_aspect_ratio=decrease,pad=${opts.targetW}:${opts.targetH}:(ow-iw)/2:(oh-ih)/2`
  const v = `trim=start=${start}:end=${end},setpts=PTS-STARTPTS,${scalePad},fps=${fps},format=yuv420p`
  const a = hasAudio
    ? `atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS`
    : `anullsrc=r=48000:cl=stereo,atrim=0:${dur},asetpts=PTS-STARTPTS`

  await runFfmpeg(
    [
      '-i',
      opts.inPath,
      '-filter_complex',
      `[0:v]${v}[v];${a}[a]`,
      '-map',
      '[v]',
      '-map',
      '[a]',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-movflags',
      '+faststart',
      opts.outPath,
    ],
    opts.logPaths
  )
}

async function insertGeneratedUpload(input: {
  userId: number
  bucket: string
  key: string
  sizeBytes: number
  width: number
  height: number
  durationSeconds: number | null
  assetUuid: string
  dateYmd: string
}): Promise<number> {
  const db = getPool()
  // This environment has kind/user_id columns; keep the insert simple.
  const [result] = await db.query(
    `INSERT INTO uploads (s3_bucket, s3_key, original_filename, modified_filename, description, content_type, size_bytes, width, height, duration_seconds, asset_uuid, date_ymd, status, kind, user_id)
     VALUES (?, ?, 'video.mp4', NULL, NULL, 'video/mp4', ?, ?, ?, ?, ?, ?, 'uploaded', 'video', ?)`,
    [input.bucket, input.key, input.sizeBytes, input.width, input.height, input.durationSeconds, input.assetUuid, input.dateYmd, input.userId]
  )
  return Number((result as any).insertId)
}

export async function runCreateVideoExportV1Job(
  input: CreateVideoExportV1Input,
  logPaths?: { stdoutPath?: string; stderrPath?: string }
): Promise<{ resultUploadId: number; output: { bucket: string; key: string; s3Url: string } }> {
  const userId = Number(input.userId)
  const clips = Array.isArray(input.timeline?.clips) ? input.timeline.clips : []
  if (!clips.length) throw new Error('empty_timeline')

  const db = getPool()
  const ids = Array.from(new Set(clips.map((c) => Number(c.uploadId)).filter((n) => Number.isFinite(n) && n > 0)))
  const [rows] = await db.query(`SELECT id, user_id, kind, status, s3_bucket, s3_key FROM uploads WHERE id IN (?)`, [ids])
  const byId = new Map<number, any>()
  for (const r of rows as any[]) byId.set(Number(r.id), r)

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacs-create-video-export-'))
  try {
    // Prepare first clip to choose output dimensions.
    const first = clips[0]
    const firstRow = byId.get(Number(first.uploadId))
    if (!firstRow) throw new Error('upload_not_found')
    if (String(firstRow.kind || 'video').toLowerCase() !== 'video') throw new Error('invalid_upload_kind')
    const ownerId = firstRow.user_id != null ? Number(firstRow.user_id) : null
    if (!(ownerId === userId || ownerId == null)) throw new Error('forbidden')

    const firstIn = path.join(tmpDir, `src_${Number(first.uploadId)}.mp4`)
    await downloadS3ObjectToFile(String(firstRow.s3_bucket), String(firstRow.s3_key), firstIn)
    const dims = await probeVideoDisplayDimensions(firstIn)
    const target = computeTargetDims(dims.width, dims.height)

    const fps = 30
    const segPaths: string[] = []
    const seenDownloads = new Map<number, string>()
    seenDownloads.set(Number(first.uploadId), firstIn)

    for (let i = 0; i < clips.length; i++) {
      const c = clips[i]
      const uploadId = Number(c.uploadId)
      const row = byId.get(uploadId)
      if (!row) throw new Error('upload_not_found')
      if (String(row.kind || 'video').toLowerCase() !== 'video') throw new Error('invalid_upload_kind')
      const oid = row.user_id != null ? Number(row.user_id) : null
      if (!(oid === userId || oid == null)) throw new Error('forbidden')

      const inPath = seenDownloads.get(uploadId) || path.join(tmpDir, `src_${uploadId}.mp4`)
      if (!seenDownloads.has(uploadId)) {
        await downloadS3ObjectToFile(String(row.s3_bucket), String(row.s3_key), inPath)
        seenDownloads.set(uploadId, inPath)
      }

      const outPath = path.join(tmpDir, `seg_${String(i).padStart(3, '0')}.mp4`)
      await renderSegmentMp4({
        inPath,
        outPath,
        startSeconds: Number(c.sourceStartSeconds || 0),
        endSeconds: Number(c.sourceEndSeconds || 0),
        targetW: target.w,
        targetH: target.h,
        fps,
        logPaths,
      })
      segPaths.push(outPath)
    }

    // Concat segments.
    const listPath = path.join(tmpDir, 'list.txt')
    fs.writeFileSync(listPath, segPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n')
    const concatOut = path.join(tmpDir, 'out.mp4')
    try {
      await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', concatOut], logPaths)
    } catch {
      await runFfmpeg(
        [
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          listPath,
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '20',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-ar',
          '48000',
          '-ac',
          '2',
          '-movflags',
          '+faststart',
          concatOut,
        ],
        logPaths
      )
    }

    const stat = fs.statSync(concatOut)
    const durationSeconds = await probeDurationSeconds(concatOut)
    const { ymd, folder } = nowDateYmd()
    const assetUuid = randomUUID()
    const key = buildUploadKey(String(UPLOAD_PREFIX || ''), folder, assetUuid, '.mp4', 'video')
    const bucket = String(UPLOAD_BUCKET || '')
    if (!bucket) throw new Error('missing_upload_bucket')
    await uploadFileToS3(bucket, key, concatOut, 'video/mp4')

    const uploadId = await insertGeneratedUpload({
      userId,
      bucket,
      key,
      sizeBytes: Number(stat.size || 0),
      width: target.w,
      height: target.h,
      durationSeconds: durationSeconds != null ? Math.round(durationSeconds) : null,
      assetUuid,
      dateYmd: ymd,
    })

    return { resultUploadId: uploadId, output: { bucket, key, s3Url: `s3://${bucket}/${key}` } }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}

