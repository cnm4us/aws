import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { downloadS3ObjectToFile, runFfmpeg } from './audioPipeline'

type S3Pointer = { bucket: string; key: string }

export type OverlayPosition =
  | 'top_left' | 'top_center' | 'top_right'
  | 'middle_left' | 'middle_center' | 'middle_right'
  | 'bottom_left' | 'bottom_center' | 'bottom_right'
  | 'center'

export type OverlayFade = 'none' | 'in' | 'out' | 'in_out'

export type LogoConfigSnapshot = {
  position?: OverlayPosition
  sizePctWidth?: number
  opacityPct?: number
  timingRule?: 'entire' | 'start_after' | 'first_only' | 'last_only'
  timingSeconds?: number | null
  fade?: OverlayFade
  insetXPreset?: 'small' | 'medium' | 'large' | null
  insetYPreset?: 'small' | 'medium' | 'large' | null
  // Create Video v1 uses px insets (scaled from 1080×1920).
  insetXPx?: number
  insetYPx?: number
}

export type LowerThirdImageConfigSnapshot = {
  sizeMode?: 'pct' | 'match_image'
  baselineWidth?: 1080 | 1920
  position?: OverlayPosition
  sizePctWidth?: number
  opacityPct?: number
  timingRule?: 'first_only' | 'entire'
  timingSeconds?: number | null
  fade?: OverlayFade
  insetXPreset?: 'small' | 'medium' | 'large' | null
  insetYPreset?: 'small' | 'medium' | 'large' | null
}

function clampInt(n: any, min: number, max: number): number {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return min
  return Math.min(Math.max(v, min), max)
}

function clampNum(n: any, min: number, max: number): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return min
  return Math.min(Math.max(v, min), max)
}

function normalizeLegacyPosition(pos: string): string {
  return pos === 'center' ? 'middle_center' : pos
}

function insetPctForPreset(preset: any): number {
  const p = String(preset || '').toLowerCase()
  if (p === 'small') return 0.06
  if (p === 'large') return 0.14
  return 0.10 // medium default
}

function computeOverlayRect(outputW: number, outputH: number, imgW: number, imgH: number, cfg: LogoConfigSnapshot) {
  const pct = clampInt(cfg.sizePctWidth ?? 15, 1, 100)
  const opacity = clampInt(cfg.opacityPct ?? 100, 0, 100)
  const aspect = imgW > 0 && imgH > 0 ? (imgH / imgW) : 1
  let renderW = Math.max(1, Math.round(outputW * (pct / 100)))
  let renderH = Math.max(1, Math.round(renderW * aspect))
  if (renderH > outputH) {
    renderH = outputH
    renderW = Math.max(1, Math.min(outputW, Math.round(renderH / aspect)))
  }

  const posRaw = cfg.position || 'bottom_right'
  const pos = normalizeLegacyPosition(posRaw)
  const [row, col] = String(pos).split('_') as [string, string]
  const yMode = row === 'top' ? 'top' : row === 'bottom' ? 'bottom' : 'middle'
  const xMode = col === 'left' ? 'left' : col === 'right' ? 'right' : 'center'

  const insetXPxRaw = cfg.insetXPx == null ? NaN : Number(cfg.insetXPx)
  const insetYPxRaw = cfg.insetYPx == null ? NaN : Number(cfg.insetYPx)
  const marginXPx = Number.isFinite(insetXPxRaw) ? Math.max(0, Math.round(insetXPxRaw)) : null
  const marginYPx = Number.isFinite(insetYPxRaw) ? Math.max(0, Math.round(insetYPxRaw)) : null
  const marginX =
    xMode === 'center'
      ? 0
      : marginXPx != null
          ? Math.round(outputW * (marginXPx / 1080))
          : Math.round(outputW * insetPctForPreset(cfg.insetXPreset))
  const marginY =
    yMode === 'middle'
      ? 0
      : marginYPx != null
          ? Math.round(outputH * (marginYPx / 1920))
          : Math.round(outputH * insetPctForPreset(cfg.insetYPreset))

  let x = 0
  let y = 0
  if (xMode === 'left') x = marginX
  else if (xMode === 'right') x = outputW - renderW - marginX
  else x = Math.round((outputW - renderW) / 2)

  if (yMode === 'top') y = marginY
  else if (yMode === 'bottom') y = outputH - renderH - marginY
  else y = Math.round((outputH - renderH) / 2)

  x = clampNum(x, 0, Math.max(0, outputW - renderW))
  y = clampNum(y, 0, Math.max(0, outputH - renderH))

  return { x, y, width: renderW, height: renderH, opacity }
}

function computeFullFrameCoverRect(outputW: number, outputH: number, imgW: number, imgH: number, cfg: { opacityPct?: any }) {
  const opacity = clampInt((cfg as any).opacityPct ?? 100, 0, 100)
  const w = Math.max(1, clampNum(imgW, 1, 999999))
  const h = Math.max(1, clampNum(imgH, 1, 999999))
  const scale = Math.max(outputW / w, outputH / h)
  const renderW = Math.max(1, Math.round(w * scale))
  const renderH = Math.max(1, Math.round(h * scale))
  const x = Math.round((outputW - renderW) / 2)
  const y = Math.round((outputH - renderH) / 2)
  return { x, y, width: renderW, height: renderH, opacity }
}

function computeTimingSeconds(cfg: { timingRule?: any; timingSeconds?: any }, videoDurationSeconds: number | null) {
  const rule = String(cfg.timingRule || 'entire')
  const secs = cfg.timingSeconds == null ? null : clampInt(cfg.timingSeconds, 0, 3600)
  const fallbackDurationSeconds = 60 * 60
  const totalS =
    videoDurationSeconds != null && Number.isFinite(videoDurationSeconds) && videoDurationSeconds > 0
      ? Math.max(1, Number(videoDurationSeconds))
      : fallbackDurationSeconds

  if (rule === 'entire') return { startS: 0, durationS: totalS }
  if (rule === 'start_after') {
    const startS = secs ?? 0
    return { startS, durationS: Math.max(1, totalS - startS) }
  }
  if (rule === 'first_only') {
    const d = secs ?? 0
    return { startS: 0, durationS: Math.max(0, Math.min(d, totalS)) }
  }
  // last_only
  const d = secs ?? totalS
  if (videoDurationSeconds != null && videoDurationSeconds > 0 && secs != null) {
    const startS = Math.max(0, videoDurationSeconds - secs)
    return { startS, durationS: Math.max(0, Math.min(d, totalS)) }
  }
  return { startS: 0, durationS: Math.max(0, Math.min(d, totalS)) }
}

function computeFadeSeconds(cfg: { fade?: any }) {
  const fadeMs = 500
  const fadeS = fadeMs / 1000
  const fade = String(cfg.fade || 'none')
  if (fade === 'in') return { fadeInS: fadeS, fadeOutS: 0 }
  if (fade === 'out') return { fadeInS: 0, fadeOutS: fadeS }
  if (fade === 'in_out') return { fadeInS: fadeS, fadeOutS: fadeS }
  return { fadeInS: 0, fadeOutS: 0 }
}

export async function probeVideoDisplayDimensions(filePath: string): Promise<{ width: number; height: number }> {
  return await new Promise((resolve, reject) => {
    const p = spawn(
      'ffprobe',
      [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height:stream_tags=rotate:side_data_list',
        '-of', 'json',
        filePath,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => { out += String(d) })
    p.stderr.on('data', (d) => { err += String(d) })
    p.on('error', reject)
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe_failed:${code}:${err.slice(0, 400)}`))
      try {
        const parseProbeDims = (stdout: string): { width: number; height: number; rotate: number } => {
          const trimmed = String(stdout || '').trim()
          if (!trimmed) throw new Error('ffprobe_json_empty')

          const extractFirstJsonObject = (s: string) => {
            const start = s.indexOf('{')
            if (start < 0) return null
            let depth = 0
            let inString = false
            let escape = false
            for (let i = start; i < s.length; i++) {
              const ch = s[i]
              if (inString) {
                if (escape) {
                  escape = false
                } else if (ch === '\\') {
                  escape = true
                } else if (ch === '"') {
                  inString = false
                }
                continue
              }
              if (ch === '"') {
                inString = true
              } else if (ch === '{') {
                depth++
              } else if (ch === '}') {
                depth--
                if (depth === 0) return s.slice(start, i + 1)
              }
            }
            return null
          }

          const parseFromJson = (rawJson: string) => {
            const j = JSON.parse(rawJson)
            const s = Array.isArray(j.streams) ? j.streams[0] : null
            const width = s && s.width != null ? Number(s.width) : NaN
            const height = s && s.height != null ? Number(s.height) : NaN
            let rotate = 0
            if (s && s.tags && s.tags.rotate != null) rotate = Number(s.tags.rotate)
            if (!Number.isFinite(rotate) && Array.isArray(s?.side_data_list)) {
              for (const sd of s.side_data_list) {
                if (sd && sd.rotation != null) rotate = Number(sd.rotation)
              }
            }
            return { width, height, rotate: Number.isFinite(rotate) ? rotate : 0 }
          }

          try {
            return parseFromJson(trimmed)
          } catch {
            const extracted = extractFirstJsonObject(trimmed)
            if (extracted) {
              try {
                return parseFromJson(extracted)
              } catch {
                // fall through
              }
            }

            const width = Number((trimmed.match(/"width"\s*:\s*(\d+)/) || [])[1])
            const height = Number((trimmed.match(/"height"\s*:\s*(\d+)/) || [])[1])
            const rotateTag = (trimmed.match(/"rotate"\s*:\s*"?(?<rot>-?\d+(?:\.\d+)?)"?/) as any)?.groups?.rot
            const rotationSideData = (trimmed.match(/"rotation"\s*:\s*(?<rot>-?\d+(?:\.\d+)?)/) as any)?.groups?.rot
            const rotate = Number(rotateTag ?? rotationSideData ?? 0)

            if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
              return { width, height, rotate: Number.isFinite(rotate) ? rotate : 0 }
            }

            throw new Error(`ffprobe_json_parse_failed:${trimmed.slice(0, 220).replace(/\s+/g, ' ')}`)
          }
        }

        const dims = parseProbeDims(out)
        const w = dims.width
        const h = dims.height
        const rot = Number.isFinite(dims.rotate) ? Math.abs(Math.round(dims.rotate)) % 360 : 0
        if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return reject(new Error('ffprobe_missing_dims'))
        if (rot === 90 || rot === 270) return resolve({ width: h, height: w })
        resolve({ width: w, height: h })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        reject(new Error(`${msg} (ffprobe stdout: ${String(out).slice(0, 260).replace(/\s+/g, ' ')})`))
      }
    })
  })
}

export async function downloadOverlayPngToFile(ptr: S3Pointer, outPath: string) {
  await downloadS3ObjectToFile(ptr.bucket, ptr.key, outPath)
}

export async function burnPngOverlaysIntoMp4(opts: {
  inPath: string
  outPath: string
  videoDurationSeconds: number | null
  overlays: Array<{
    pngPath: string
    imgW: number
    imgH: number
    cfg: LogoConfigSnapshot
    mode?: 'full_frame_cover'
    startSeconds?: number
    endSeconds?: number
  }>
  logPaths?: { stdoutPath?: string; stderrPath?: string }
}): Promise<void> {
  if (!opts.overlays.length) {
    fs.copyFileSync(opts.inPath, opts.outPath)
    return
  }

  const dims = await probeVideoDisplayDimensions(opts.inPath)
  const parts: string[] = []
  parts.push(`[0:v]setpts=PTS-STARTPTS[v0]`)

  let current = 'v0'
  for (let i = 0; i < opts.overlays.length; i++) {
    const ov = opts.overlays[i]
    const idx = i + 1

    const rect =
      ov.mode === 'full_frame_cover'
        ? computeFullFrameCoverRect(dims.width, dims.height, ov.imgW, ov.imgH, ov.cfg)
        : computeOverlayRect(dims.width, dims.height, ov.imgW, ov.imgH, ov.cfg)
    const opacity = clampNum(rect.opacity / 100, 0, 1)
    const timing =
      ov.startSeconds != null && ov.endSeconds != null
        ? { startS: Math.max(0, Number(ov.startSeconds) || 0), durationS: Math.max(0, (Number(ov.endSeconds) || 0) - (Number(ov.startSeconds) || 0)) }
        : computeTimingSeconds(ov.cfg, opts.videoDurationSeconds)
    const fades = computeFadeSeconds(ov.cfg)
    const durationS = Math.max(0, Number(timing.durationS) || 0)
    const startS = Math.max(0, Number(timing.startS) || 0)

    const ovLabel = `ov${idx}`
    const ovTimed = `ovt${idx}`
    const vNext = `v${idx}`

    const fadeFilters: string[] = []
    if (fades.fadeInS > 0) fadeFilters.push(`fade=t=in:st=0:d=${fades.fadeInS.toFixed(3)}:alpha=1`)
    if (fades.fadeOutS > 0) fadeFilters.push(`fade=t=out:st=${durationS.toFixed(3)}:d=${fades.fadeOutS.toFixed(3)}:alpha=1`)
    const trimDur = Math.max(0.1, durationS + fades.fadeOutS)

    const ovChain =
      [
        `[${idx}:v]format=rgba`,
        `scale=${rect.width}:${rect.height}:flags=lanczos`,
        `colorchannelmixer=aa=${opacity.toFixed(3)}`,
        `setpts=PTS-STARTPTS`,
        ...fadeFilters,
        `trim=duration=${trimDur.toFixed(3)}`,
        `setpts=PTS+${startS.toFixed(3)}/TB`,
      ].join(',') + ` [${ovTimed}]`
    parts.push(ovChain)

    parts.push(`[${current}][${ovTimed}]overlay=${rect.x}:${rect.y}:eof_action=pass[${vNext}]`)
    current = vNext
    void ovLabel
  }

  const filter = parts.join(';')
  const args: string[] = ['-i', opts.inPath]
  for (const ov of opts.overlays) {
    args.push('-loop', '1', '-i', ov.pngPath)
  }
  args.push(
    '-filter_complex',
    filter,
    '-map',
    `[${current}]`,
    '-map',
    '0:a?',
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

export async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  try {
    return await fn(dir)
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}
