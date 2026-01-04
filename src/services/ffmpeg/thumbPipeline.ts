import fs from 'fs'
import os from 'os'
import path from 'path'
import { downloadS3ObjectToFile, runFfmpeg, uploadFileToS3 } from './audioPipeline'

export async function createUploadThumbJpeg(opts: {
  uploadBucket: string
  uploadId: number
  video: { bucket: string; key: string }
  outKey: string
  longEdgePx?: number
}): Promise<{ bucket: string; key: string; s3Url: string }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacs-upload-thumb-'))
  const videoPath = path.join(tmpDir, 'video')
  const outPath = path.join(tmpDir, 'thumb.jpg')

  try {
    await downloadS3ObjectToFile(opts.video.bucket, opts.video.key, videoPath)
    const longEdge = Math.max(64, Math.min(4096, Math.round(Number(opts.longEdgePx ?? 640))))

    // Preserve aspect ratio and constrain the LONG edge to `longEdge`.
    // - Landscape: scale=longEdge:-2
    // - Portrait:  scale=-2:longEdge
    const vf = `scale=w='if(gte(iw,ih),${longEdge},-2)':h='if(gte(iw,ih),-2,${longEdge})':flags=lanczos`

    await runFfmpeg(
      [
        '-ss',
        '0',
        '-i',
        videoPath,
        '-frames:v',
        '1',
        '-vf',
        vf,
        '-q:v',
        '3',
        outPath,
      ],
      undefined
    )

    await uploadFileToS3(opts.uploadBucket, opts.outKey, outPath, 'image/jpeg')
    return { bucket: opts.uploadBucket, key: opts.outKey, s3Url: `s3://${opts.uploadBucket}/${opts.outKey}` }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}

