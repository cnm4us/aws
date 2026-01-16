import fs from 'fs'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import { getPool } from '../../db'
import { MEDIA_CONVERT_NORMALIZE_AUDIO, UPLOAD_BUCKET, UPLOAD_PREFIX } from '../../config'
import { buildUploadKey, nowDateYmd } from '../../utils/naming'
import { downloadS3ObjectToFile, runFfmpeg, uploadFileToS3 } from '../../services/ffmpeg/audioPipeline'
import { probeVideoDisplayDimensions } from '../../services/ffmpeg/visualPipeline'
import * as audioConfigsSvc from '../../features/audio-configs/service'

type Clip = { id: string; uploadId: number; startSeconds?: number; sourceStartSeconds: number; sourceEndSeconds: number }
type Graphic = { id: string; uploadId: number; startSeconds: number; endSeconds: number }
type AudioTrack = { uploadId: number; audioConfigId: number; startSeconds: number; endSeconds: number }

export type CreateVideoExportV1Input = {
  projectId: number
  userId: number
  timeline: { version: 'create_video_v1'; clips: Clip[]; graphics?: Graphic[]; audioTrack?: AudioTrack | null }
}

function roundToTenth(n: number): number {
  return Math.round(n * 10) / 10
}

function clamp(n: number, min: number, max: number): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return min
  return Math.max(min, Math.min(max, v))
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

async function detectInitialNonSilenceSeconds(
  filePath: string,
  gate: 'sensitive' | 'normal' | 'strict',
  opts?: { maxAnalyzeSeconds?: number }
): Promise<number | null> {
  if (!(await hasAudioStream(filePath))) return null

  const noiseDb = gate === 'sensitive' ? '-50dB' : (gate === 'strict' ? '-38dB' : '-44dB')
  const minNonSilenceSeconds = 0.12
  const maxAnalyzeSecondsRaw = opts?.maxAnalyzeSeconds != null ? Number(opts.maxAnalyzeSeconds) : null
  const maxAnalyzeSeconds =
    maxAnalyzeSecondsRaw != null && Number.isFinite(maxAnalyzeSecondsRaw)
      ? Math.max(3, Math.min(180, maxAnalyzeSecondsRaw))
      : 30

  return await new Promise<number | null>((resolve) => {
    const args = [
      '-hide_banner',
      '-t',
      String(maxAnalyzeSeconds),
      '-i',
      filePath,
      '-vn',
      '-af',
      `silencedetect=n=${noiseDb}:d=${minNonSilenceSeconds.toFixed(2)}`,
      '-f',
      'null',
      '-',
    ]
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    p.stderr.on('data', (d) => { stderr += String(d) })
    p.on('close', (code) => {
      if (code !== 0) return resolve(0)
      const hasSilenceStart = /silence_start:\s*([0-9.]+)/.test(stderr)
      const m = stderr.match(/silence_end:\s*([0-9.]+)/)
      if (!m) return resolve(hasSilenceStart ? null : 0)
      const v = Number(m[1])
      if (!Number.isFinite(v) || v < 0) return resolve(0)
      resolve(v)
    })
    p.on('error', () => resolve(0))
  })
}

function thresholdForGate(gate: string): number {
  if (gate === 'sensitive') return 0.06
  if (gate === 'strict') return 0.10
  return 0.08 // normal
}

async function applyAudioTrackToMp4(opts: {
  inMp4Path: string
  outMp4Path: string
  audioPath: string
  audioConfig: any
  trackStartSeconds: number
  trackEndSeconds: number
  logPaths?: { stdoutPath?: string; stderrPath?: string }
}) {
  const cfg = opts.audioConfig || {}
  const mode = String(cfg.mode || 'mix').toLowerCase() === 'replace' ? 'replace' : 'mix'
  const vDb = Math.round(Number.isFinite(Number(cfg.videoGainDb)) ? Number(cfg.videoGainDb) : 0)
  const mDb = Math.round(Number.isFinite(Number(cfg.musicGainDb)) ? Number(cfg.musicGainDb) : -18)
  const vVol = `${vDb}dB`
  const mVol = `${mDb}dB`
  const duckingMode = String(cfg.duckingMode || 'none').toLowerCase()
  const duckingGate = String(cfg.duckingGate || 'normal').toLowerCase()
  const duckingEnabled = Boolean(cfg.duckingEnabled) && mode === 'mix' && duckingMode !== 'none'
  const duckingAmountDb = Math.max(0, Math.min(24, Math.round(Number.isFinite(Number(cfg.duckingAmountDb)) ? Number(cfg.duckingAmountDb) : 12)))

  const videoDurRaw = await probeDurationSeconds(opts.inMp4Path)
  const videoDur = videoDurRaw != null && Number.isFinite(videoDurRaw) && videoDurRaw > 0 ? videoDurRaw : null
  const startSeconds = roundToTenth(Math.max(0, Number(opts.trackStartSeconds || 0)))
  const endSeconds = roundToTenth(Math.max(0, Number(opts.trackEndSeconds || 0)))
  if (!(endSeconds > startSeconds)) throw new Error('invalid_audio_track_range')
  const spanLen = Math.max(0, endSeconds - startSeconds)

  const durCapRaw = cfg.audioDurationSeconds != null ? Number(cfg.audioDurationSeconds) : null
  const durCap = durCapRaw != null && Number.isFinite(durCapRaw) && durCapRaw > 0 ? durCapRaw : null
  const clipLen = roundToTenth(durCap != null ? Math.min(spanLen, durCap) : spanLen)
  if (!(clipLen > 0.05)) throw new Error('invalid_audio_track_duration')

  const fadeEnabled = cfg.audioFadeEnabled !== false
  const fadeBase = 0.35
  const fadeDur = fadeEnabled ? Math.max(0.05, Math.min(fadeBase, clipLen / 2)) : 0
  const fadeOutStart = Math.max(0, clipLen - fadeDur)
  const fadeFilters = fadeDur > 0
    ? `,afade=t=in:st=0:d=${fadeDur.toFixed(2)},afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${fadeDur.toFixed(2)}`
    : ''

  const delayMs = Math.max(0, Math.round(startSeconds * 1000))
  const delayFilter = delayMs > 0 ? `,adelay=${delayMs}:all=1` : ''

  const normalizeEnabled = Boolean(MEDIA_CONVERT_NORMALIZE_AUDIO)
  const targetLkfs = -16
  const useDurTrim = normalizeEnabled && videoDur != null
  const durTrim = useDurTrim ? `,atrim=0:${videoDur!.toFixed(6)},asetpts=N/SR/TB` : ''
  const normSuffix = normalizeEnabled ? `,loudnorm=I=${targetLkfs}:TP=-1.5:LRA=11` : ''

  const args: string[] = ['-i', opts.inMp4Path, '-stream_loop', '-1', '-i', opts.audioPath]

  const musicChain = `[1:a]volume=${mVol},atrim=0:${clipLen.toFixed(3)},asetpts=N/SR/TB${fadeFilters}${delayFilter},apad[musicfull]`

  let outLabel = '[out]'

  if (mode === 'replace') {
    const filter = `${musicChain};[musicfull]alimiter=limit=0.98${normSuffix}${durTrim}${outLabel}`
    args.push('-filter_complex', filter, '-map', '0:v:0', '-map', outLabel)
  } else {
    const origChain = `[0:a]volume=${vVol},apad[orig]`
    let musicProcessed = '[music]'

    let musicProcessChain = ''
    if (duckingEnabled && duckingMode === 'rolling') {
      const threshold = thresholdForGate(duckingGate)
      const ratio = Math.max(2, Math.min(20, 1 + Math.round(duckingAmountDb / 2)))
      const attack = 20
      const release = 250
      musicProcessChain = `${musicChain};[musicfull][0:a]sidechaincompress=threshold=${threshold}:ratio=${ratio}:attack=${attack}:release=${release}:makeup=1[mduck];[mduck]volume=${mVol}[music]`
    } else if (duckingEnabled && duckingMode === 'abrupt') {
      const analyzeWindow = durCap != null ? Math.max(5, Math.min(60, durCap + 10)) : 30
      const cutAt = await detectInitialNonSilenceSeconds(opts.inMp4Path, (duckingGate as any) || 'normal', { maxAnalyzeSeconds: analyzeWindow })
      const beforeRaw = cfg.openerCutFadeBeforeSeconds != null ? Number(cfg.openerCutFadeBeforeSeconds) : null
      const afterRaw = cfg.openerCutFadeAfterSeconds != null ? Number(cfg.openerCutFadeAfterSeconds) : null
      const before = beforeRaw != null && Number.isFinite(beforeRaw) ? Math.max(0, Math.min(3, beforeRaw)) : null
      const after = afterRaw != null && Number.isFinite(afterRaw) ? Math.max(0, Math.min(3, afterRaw)) : null
      const beforeSec = before == null && after == null ? 0.5 : (before ?? 0)
      const afterSec = after ?? 0

      const relativeCutRaw = cutAt == null ? null : cutAt - startSeconds
      const relativeCut = relativeCutRaw != null ? Math.max(0, relativeCutRaw) : null

      if (relativeCut != null && relativeCut <= 0.05) {
        musicProcessChain = `${musicChain};[musicfull]volume=0[music]`
      } else if (relativeCut != null) {
        const endRaw = relativeCut + afterSec
        const endCut = Math.min(clipLen, Math.max(0, endRaw))
        const fadeStart = Math.max(0, relativeCut - beforeSec)
        const fadeEnd = Math.min(endCut, relativeCut + afterSec)
        const fadeDuration = Math.max(0, Math.min(beforeSec + afterSec, Math.max(0, fadeEnd - fadeStart)))
        const cutFade = fadeDuration > 0 ? `,afade=t=out:st=${fadeStart.toFixed(2)}:d=${fadeDuration.toFixed(2)}` : ''
        const clippedDelayMs = delayMs
        const clippedDelay = clippedDelayMs > 0 ? `,adelay=${clippedDelayMs}:all=1` : ''

        // Rebuild music stream with truncation around cutoff, then pad to full length.
        const m = `[1:a]volume=${mVol},atrim=0:${endCut.toFixed(3)},asetpts=N/SR/TB${cutFade}${clippedDelay},apad[music]`
        musicProcessChain = m
        musicProcessed = '[music]'
      } else {
        musicProcessChain = `${musicChain};[musicfull]volume=${mVol}[music]`
      }
    } else {
      musicProcessChain = `${musicChain};[musicfull]volume=${mVol}[music]`
    }

    const mix = `${origChain};${musicProcessChain};[orig]${musicProcessed}amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.98${normSuffix}${durTrim}${outLabel}`
    args.push('-filter_complex', mix, '-map', '0:v:0', '-map', outLabel)
  }

  args.push(
    '-c:v',
    'copy',
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
    opts.outMp4Path
  )
  if (!useDurTrim) args.splice(args.length - 1, 0, '-shortest')
  await runFfmpeg(args, opts.logPaths)
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

async function renderBlackBaseMp4(opts: {
  outPath: string
  durationSeconds: number
  targetW: number
  targetH: number
  fps: number
  logPaths?: { stdoutPath?: string; stderrPath?: string }
}) {
  const dur = roundToTenth(Math.max(0, Number(opts.durationSeconds)))
  if (!(dur > 0)) throw new Error('invalid_duration')
  const fps = Math.max(15, Math.min(60, Math.round(Number(opts.fps || 30))))
  await runFfmpeg(
    [
      '-f',
      'lavfi',
      '-i',
      `color=c=black:s=${opts.targetW}x${opts.targetH}:d=${dur}:r=${fps}`,
      '-f',
      'lavfi',
      '-i',
      `anullsrc=r=48000:cl=stereo`,
      '-shortest',
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

async function overlayFullFrameGraphics(opts: {
  baseMp4Path: string
  outPath: string
  graphics: Array<{ startSeconds: number; endSeconds: number; imagePath: string }>
  targetW: number
  targetH: number
  durationSeconds: number
  logPaths?: { stdoutPath?: string; stderrPath?: string }
}) {
  const baseDur = roundToTenth(Math.max(0, Number(opts.durationSeconds)))
  if (!opts.graphics.length) throw new Error('no_graphics')

  const args: string[] = ['-i', opts.baseMp4Path]
  for (const g of opts.graphics) {
    args.push('-loop', '1', '-t', String(baseDur), '-i', g.imagePath)
  }

  const filters: string[] = []
  for (let i = 0; i < opts.graphics.length; i++) {
    const inIdx = i + 1
    filters.push(
      `[${inIdx}:v]scale=${opts.targetW}:${opts.targetH}:force_original_aspect_ratio=increase,crop=${opts.targetW}:${opts.targetH},format=rgba[img${i}]`
    )
  }

  let current = '[0:v]'
  for (let i = 0; i < opts.graphics.length; i++) {
    const g = opts.graphics[i]
    const s = roundToTenth(Number(g.startSeconds))
    const e = roundToTenth(Number(g.endSeconds))
    const next = `[v${i + 1}]`
    filters.push(`${current}[img${i}]overlay=0:0:enable='between(t,${s},${e})'${next}`)
    current = next
  }

  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    current,
    '-map',
    '0:a',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    opts.outPath
  )

  await runFfmpeg(args, opts.logPaths)
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
  const graphics = Array.isArray((input.timeline as any)?.graphics) ? ((input.timeline as any).graphics as Graphic[]) : []
  const audioTrackRaw = (input.timeline as any)?.audioTrack
  const audioTrack: AudioTrack | null =
    audioTrackRaw && typeof audioTrackRaw === 'object'
      ? {
          uploadId: Number((audioTrackRaw as any).uploadId),
          audioConfigId: Number((audioTrackRaw as any).audioConfigId),
          startSeconds: Number((audioTrackRaw as any).startSeconds),
          endSeconds: Number((audioTrackRaw as any).endSeconds),
        }
      : null
  if (!clips.length && !graphics.length) throw new Error('empty_timeline')

  const db = getPool()
  const ids = Array.from(
    new Set(
      [
        ...clips.map((c) => Number(c.uploadId)),
        ...graphics.map((g) => Number(g.uploadId)),
        ...(audioTrack ? [Number(audioTrack.uploadId)] : []),
      ].filter((n) => Number.isFinite(n) && n > 0)
    )
  )
  const [rows] = await db.query(
    `SELECT id, user_id, kind, status, s3_bucket, s3_key, is_system, source_deleted_at FROM uploads WHERE id IN (?)`,
    [ids]
  )
  const byId = new Map<number, any>()
  for (const r of rows as any[]) byId.set(Number(r.id), r)

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacs-create-video-export-'))
  try {
    const fps = 30
    const segPaths: string[] = []
    const seenDownloads = new Map<number, string>()

    let target = { w: 1080, h: 1920 }
    let baseDurationSeconds = 0
    let baseOut = path.join(tmpDir, 'out.mp4')

    if (clips.length) {
      // Prepare first clip to choose output dimensions.
      const sortedClips: Clip[] = clips
        .map((c) => {
          const startRaw = (c as any).startSeconds
          const startSeconds = startRaw != null && Number.isFinite(Number(startRaw)) ? roundToTenth(Math.max(0, Number(startRaw))) : undefined
          return { ...c, startSeconds }
        })
        .sort((a, b) => Number(a.startSeconds || 0) - Number(b.startSeconds || 0) || String(a.id).localeCompare(String(b.id)))

      const first = sortedClips[0]
      const firstRow = byId.get(Number(first.uploadId))
      if (!firstRow) throw new Error('upload_not_found')
      if (String(firstRow.kind || 'video').toLowerCase() !== 'video') throw new Error('invalid_upload_kind')
      const ownerId = firstRow.user_id != null ? Number(firstRow.user_id) : null
      if (!(ownerId === userId || ownerId == null)) throw new Error('forbidden')

      const firstIn = path.join(tmpDir, `src_${Number(first.uploadId)}.mp4`)
      await downloadS3ObjectToFile(String(firstRow.s3_bucket), String(firstRow.s3_key), firstIn)
      const dims = await probeVideoDisplayDimensions(firstIn)
      const computed = computeTargetDims(dims.width, dims.height)
      target = { w: computed.w, h: computed.h }
      seenDownloads.set(Number(first.uploadId), firstIn)

      // Render segments (including black gaps) then concat.
      let cursorSeconds = 0
      for (let i = 0; i < sortedClips.length; i++) {
        const c = sortedClips[i]
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

        const startSeconds = c.startSeconds != null ? roundToTenth(Math.max(0, Number(c.startSeconds))) : roundToTenth(Math.max(0, cursorSeconds))
        if (startSeconds > cursorSeconds + 0.05) {
          const gapDur = roundToTenth(startSeconds - cursorSeconds)
          const gapPath = path.join(tmpDir, `gap_${String(i).padStart(3, '0')}.mp4`)
          await renderBlackBaseMp4({
            outPath: gapPath,
            durationSeconds: gapDur,
            targetW: target.w,
            targetH: target.h,
            fps,
            logPaths,
          })
          segPaths.push(gapPath)
          cursorSeconds = startSeconds
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
        const segLen = Math.max(0, roundToTenth(Number(c.sourceEndSeconds) - Number(c.sourceStartSeconds)))
        cursorSeconds = roundToTenth(startSeconds + segLen)
      }

      const graphicsEnd = graphics.length ? Number(graphics.slice().sort((a, b) => Number(a.endSeconds) - Number(b.endSeconds))[graphics.length - 1].endSeconds) : 0
      const audioEnd = audioTrack ? Number(audioTrack.endSeconds || 0) : 0
      const targetEnd = roundToTenth(Math.max(cursorSeconds, graphicsEnd, audioEnd))
      if (targetEnd > cursorSeconds + 0.05) {
        const gapDur = roundToTenth(targetEnd - cursorSeconds)
        const gapPath = path.join(tmpDir, `tail_gap.mp4`)
        await renderBlackBaseMp4({
          outPath: gapPath,
          durationSeconds: gapDur,
          targetW: target.w,
          targetH: target.h,
          fps,
          logPaths,
        })
        segPaths.push(gapPath)
        cursorSeconds = targetEnd
      }
      baseDurationSeconds = roundToTenth(Math.max(0, cursorSeconds))

      // Concat segments.
      const listPath = path.join(tmpDir, 'list.txt')
      fs.writeFileSync(listPath, segPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n')
      try {
        await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', baseOut], logPaths)
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
            baseOut,
          ],
          logPaths
        )
      }
    } else {
      const sorted = graphics.slice().sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds))
      baseDurationSeconds = roundToTenth(Number(sorted[sorted.length - 1]?.endSeconds || 0))
      if (!(baseDurationSeconds > 0)) throw new Error('invalid_duration')
      await renderBlackBaseMp4({
        outPath: baseOut,
        durationSeconds: baseDurationSeconds,
        targetW: target.w,
        targetH: target.h,
        fps,
        logPaths,
      })
    }

    let finalOut = baseOut
    if (graphics.length) {
      const imageDownloads = new Map<number, string>()
      const sorted = graphics.slice().sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds))
      const overlays: Array<{ startSeconds: number; endSeconds: number; imagePath: string }> = []
      for (let i = 0; i < sorted.length; i++) {
        const g = sorted[i]
        const uploadId = Number(g.uploadId)
        const row = byId.get(uploadId)
        if (!row) throw new Error('upload_not_found')
        if (String(row.kind || '').toLowerCase() !== 'image') throw new Error('invalid_upload_kind')
        const oid = row.user_id != null ? Number(row.user_id) : null
        if (!(oid === userId || oid == null)) throw new Error('forbidden')
        const inPath = imageDownloads.get(uploadId) || path.join(tmpDir, `img_${uploadId}_${String(i).padStart(3, '0')}`)
        if (!imageDownloads.has(uploadId)) {
          await downloadS3ObjectToFile(String(row.s3_bucket), String(row.s3_key), inPath)
          imageDownloads.set(uploadId, inPath)
        }
        overlays.push({ startSeconds: Number(g.startSeconds), endSeconds: Number(g.endSeconds), imagePath: inPath })
      }
      const overlayOut = path.join(tmpDir, 'out_overlay.mp4')
      await overlayFullFrameGraphics({
        baseMp4Path: baseOut,
        outPath: overlayOut,
        graphics: overlays,
        targetW: target.w,
        targetH: target.h,
        durationSeconds: baseDurationSeconds,
        logPaths,
      })
      finalOut = overlayOut
    }

    if (audioTrack && Number.isFinite(audioTrack.uploadId) && audioTrack.uploadId > 0) {
      const row = byId.get(Number(audioTrack.uploadId))
      if (!row) throw new Error('upload_not_found')
      if (String(row.kind || '').toLowerCase() !== 'audio') throw new Error('invalid_upload_kind')
      if (!Number(row.is_system || 0)) throw new Error('forbidden')
      if (row.source_deleted_at) throw new Error('source_deleted')
      const st = String(row.status || '').toLowerCase()
      if (!(st === 'uploaded' || st === 'completed')) throw new Error('invalid_upload_status')

      const cfg = await audioConfigsSvc.getActiveForUser(Number(audioTrack.audioConfigId), userId)
      const audioPath = path.join(tmpDir, `audio_${Number(audioTrack.uploadId)}`)
      await downloadS3ObjectToFile(String(row.s3_bucket), String(row.s3_key), audioPath)

      const videoDur = (await probeDurationSeconds(finalOut)) ?? baseDurationSeconds
      const start = clamp(roundToTenth(Number(audioTrack.startSeconds || 0)), 0, Math.max(0, videoDur))
      const end = clamp(roundToTenth(Number(audioTrack.endSeconds || 0)), 0, Math.max(0, videoDur))
      if (end > start + 0.05) {
        const outWithAudio = path.join(tmpDir, 'out_audio.mp4')
        await applyAudioTrackToMp4({
          inMp4Path: finalOut,
          outMp4Path: outWithAudio,
          audioPath,
          audioConfig: cfg,
          trackStartSeconds: start,
          trackEndSeconds: end,
          logPaths,
        })
        finalOut = outWithAudio
      }
    }

    const stat = fs.statSync(finalOut)
    const durationSeconds = await probeDurationSeconds(finalOut)
    const { ymd, folder } = nowDateYmd()
    const assetUuid = randomUUID()
    const key = buildUploadKey(String(UPLOAD_PREFIX || ''), folder, assetUuid, '.mp4', 'video')
    const bucket = String(UPLOAD_BUCKET || '')
    if (!bucket) throw new Error('missing_upload_bucket')
    await uploadFileToS3(bucket, key, finalOut, 'video/mp4')

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
