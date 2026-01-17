import fs from 'fs'
import os from 'os'
import path from 'path'
import { downloadS3ObjectToFile, runFfmpeg, uploadFileToS3 } from './audioPipeline'

export async function createUploadFreezeFramePng(opts: {
  proxy: { bucket: string; key: string }
  atSeconds: number
  uploadBucket: string
  outKey: string
  longEdgePx?: number
}): Promise<{ bucket: string; key: string; s3Url: string; sizeBytes: number }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacs-upload-freeze-frame-'))
  const inPath = path.join(tmpDir, 'proxy.mp4')
  const outPath = path.join(tmpDir, 'freeze.png')

  try {
    await downloadS3ObjectToFile(opts.proxy.bucket, opts.proxy.key, inPath)
    const longEdge = Math.max(64, Math.min(2160, Math.round(Number(opts.longEdgePx ?? 1080))))
    const at = Math.max(0, Number(opts.atSeconds) || 0)

    // Preserve aspect ratio and constrain the LONG edge to `longEdge`.
    // - Landscape: scale=longEdge:-2
    // - Portrait:  scale=-2:longEdge
    const vf = `scale=w='if(gte(iw,ih),${longEdge},-2)':h='if(gte(iw,ih),-2,${longEdge})':flags=lanczos`

    await runFfmpeg(
      [
        '-hide_banner',
        '-ss',
        String(at),
        '-i',
        inPath,
        '-frames:v',
        '1',
        '-vf',
        vf,
        '-f',
        'image2',
        '-y',
        outPath,
      ],
      undefined
    )

    const st = fs.statSync(outPath)
    await uploadFileToS3(opts.uploadBucket, opts.outKey, outPath, 'image/png')
    return { bucket: opts.uploadBucket, key: opts.outKey, s3Url: `s3://${opts.uploadBucket}/${opts.outKey}`, sizeBytes: Number(st.size) }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}

