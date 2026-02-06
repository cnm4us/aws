import fs from 'fs'
import os from 'os'
import path from 'path'
import { downloadS3ObjectToFile, runFfmpeg, uploadFileToS3 } from './audioPipeline'
import { probeMediaInfo, type MediaInfo } from './metrics'

export async function createUploadEditProxyMp4(opts: {
  uploadBucket: string
  uploadId: number
  video: { bucket: string; key: string }
  outKey: string
  longEdgePx?: number
  fps?: number
  gop?: number
  logPaths?: { stdoutPath?: string; stderrPath?: string }
}): Promise<{ bucket: string; key: string; s3Url: string; metricsInput?: MediaInfo | null }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacs-upload-edit-proxy-'))
  const videoPath = path.join(tmpDir, 'video')
  const outPath = path.join(tmpDir, 'edit_proxy.mp4')

  try {
    await downloadS3ObjectToFile(opts.video.bucket, opts.video.key, videoPath)
    const metricsInput = await probeMediaInfo(videoPath)
    const longEdge = Math.max(160, Math.min(1080, Math.round(Number(opts.longEdgePx ?? 540))))
    const fps = Math.max(15, Math.min(60, Math.round(Number(opts.fps ?? 30))))
    const gop = Math.max(2, Math.min(300, Math.round(Number(opts.gop ?? 8))))

    // Preserve aspect ratio and constrain the LONG edge to `longEdge`.
    // - Landscape: scale=longEdge:-2
    // - Portrait:  scale=-2:longEdge
    const vf = `scale=w='if(gte(iw,ih),${longEdge},-2)':h='if(gte(iw,ih),-2,${longEdge})':flags=bicubic`

    await runFfmpeg(
      [
        '-i',
        videoPath,
        '-vf',
        vf,
        '-r',
        String(fps),
        '-map',
        '0:v:0',
        '-map',
        '0:a?',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-profile:v',
        'main',
        '-g',
        String(gop),
        '-keyint_min',
        String(gop),
        '-sc_threshold',
        '0',
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
        outPath,
      ],
      opts.logPaths
    )

    await uploadFileToS3(opts.uploadBucket, opts.outKey, outPath, 'video/mp4')
    return { bucket: opts.uploadBucket, key: opts.outKey, s3Url: `s3://${opts.uploadBucket}/${opts.outKey}`, metricsInput }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}
