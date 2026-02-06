import { spawn } from 'child_process'

export type MediaInfo = {
  durationSeconds?: number
  width?: number
  height?: number
  fps?: number
  videoCodec?: string
  audioCodec?: string
  bitrateKbps?: number
}

function parseFps(raw: string | null | undefined): number | undefined {
  const v = String(raw || '').trim()
  if (!v) return undefined
  if (v.includes('/')) {
    const [a, b] = v.split('/')
    const n = Number(a)
    const d = Number(b)
    if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return undefined
    const fps = n / d
    return Number.isFinite(fps) ? fps : undefined
  }
  const fps = Number(v)
  return Number.isFinite(fps) ? fps : undefined
}

export async function probeMediaInfo(filePath: string): Promise<MediaInfo | null> {
  return await new Promise<MediaInfo | null>((resolve) => {
    const p = spawn(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
    let out = ''
    p.stdout.on('data', (d) => { out += String(d) })
    p.on('error', () => resolve(null))
    p.on('close', (code) => {
      if (code !== 0) return resolve(null)
      try {
        const parsed = JSON.parse(String(out || '{}'))
        const streams = Array.isArray(parsed?.streams) ? parsed.streams : []
        const format = parsed?.format || {}
        const video = streams.find((s: any) => s?.codec_type === 'video') || null
        const audio = streams.find((s: any) => s?.codec_type === 'audio') || null
        const width = Number(video?.width)
        const height = Number(video?.height)
        const durationSecondsRaw = Number(format?.duration ?? video?.duration ?? audio?.duration)
        const bitrate = Number(format?.bit_rate ?? video?.bit_rate ?? audio?.bit_rate)
        const fps = parseFps(video?.avg_frame_rate || video?.r_frame_rate)

        const info: MediaInfo = {
          durationSeconds: Number.isFinite(durationSecondsRaw) ? durationSecondsRaw : undefined,
          width: Number.isFinite(width) && width > 0 ? width : undefined,
          height: Number.isFinite(height) && height > 0 ? height : undefined,
          fps: Number.isFinite(fps) ? fps : undefined,
          videoCodec: video?.codec_name ? String(video.codec_name) : undefined,
          audioCodec: audio?.codec_name ? String(audio.codec_name) : undefined,
          bitrateKbps: Number.isFinite(bitrate) && bitrate > 0 ? Math.round(bitrate / 1000) : undefined,
        }
        resolve(info)
      } catch {
        resolve(null)
      }
    })
  })
}
