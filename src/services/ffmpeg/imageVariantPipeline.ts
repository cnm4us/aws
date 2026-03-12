import { PutObjectCommand } from '@aws-sdk/client-s3'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  IMAGE_VARIANTS_WITHOUT_ENLARGEMENT,
  type ImageVariantFormat,
  type ImageVariantProfile,
} from '../../config'
import { s3 } from '../s3'
import { downloadS3ObjectToFile, runFfmpeg } from './audioPipeline'
import { probeMediaInfo, type MediaInfo } from './metrics'

function toSafeInt(value: number | null | undefined, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.max(1, Math.round(n))
}

function buildContainFilter(profile: ImageVariantProfile): string {
  const width = profile.width != null ? toSafeInt(profile.width, 1) : null
  const height = profile.height != null ? toSafeInt(profile.height, 1) : null
  const withoutEnlargement = IMAGE_VARIANTS_WITHOUT_ENLARGEMENT

  if (width != null && height != null) {
    if (withoutEnlargement) {
      return `scale=w='min(${width}\\,iw)':h='min(${height}\\,ih)':force_original_aspect_ratio=decrease:flags=lanczos`
    }
    return `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos`
  }
  if (width != null) {
    return withoutEnlargement
      ? `scale=w='min(${width}\\,iw)':h=-2:flags=lanczos`
      : `scale=${width}:-2:flags=lanczos`
  }
  if (height != null) {
    return withoutEnlargement
      ? `scale=w=-2:h='min(${height}\\,ih)':flags=lanczos`
      : `scale=-2:${height}:flags=lanczos`
  }
  return 'scale=iw:ih:flags=lanczos'
}

function buildCoverFilter(profile: ImageVariantProfile): string {
  const width = toSafeInt(profile.width, 1)
  const height = toSafeInt(profile.height, 1)
  const withoutEnlargement = IMAGE_VARIANTS_WITHOUT_ENLARGEMENT

  if (withoutEnlargement) {
    return `scale=w='min(${width}\\,iw)':h='min(${height}\\,ih)':force_original_aspect_ratio=decrease:flags=lanczos`
  }
  return `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height}`
}

function buildFilter(profile: ImageVariantProfile): string {
  if (profile.fit === 'cover' && profile.width != null && profile.height != null) return buildCoverFilter(profile)
  return buildContainFilter(profile)
}

function encoderArgs(profile: ImageVariantProfile): string[] {
  const fmt: ImageVariantFormat = profile.format === 'png' ? 'png' : 'webp'
  if (fmt === 'png') {
    return ['-frames:v', '1', '-c:v', 'png', '-compression_level', '9', '-pix_fmt', profile.alpha ? 'rgba' : 'rgb24']
  }
  const quality = profile.quality == null ? 80 : Math.max(1, Math.min(100, Math.round(profile.quality)))
  return [
    '-frames:v',
    '1',
    '-c:v',
    'libwebp',
    '-preset',
    'picture',
    '-compression_level',
    '6',
    '-q:v',
    String(quality),
    '-pix_fmt',
    profile.alpha ? 'yuva420p' : 'yuv420p',
  ]
}

function contentTypeFor(format: ImageVariantFormat): string {
  return format === 'png' ? 'image/png' : 'image/webp'
}

export async function createUploadImageVariant(opts: {
  source: { bucket: string; key: string }
  output: { bucket: string; key: string }
  profile: ImageVariantProfile
  logPaths?: { stdoutPath?: string; stderrPath?: string; commandLog?: string[] }
}): Promise<{
  output: { bucket: string; key: string; s3Url: string; etag: string | null }
  width: number | null
  height: number | null
  sizeBytes: number | null
  metricsInput?: MediaInfo | null
}> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacs-image-variant-'))
  const sourcePath = path.join(tmpDir, 'source')
  const ext = opts.profile.format === 'png' ? 'png' : 'webp'
  const outputPath = path.join(tmpDir, `variant.${ext}`)
  try {
    await downloadS3ObjectToFile(opts.source.bucket, opts.source.key, sourcePath)
    const metricsInput = await probeMediaInfo(sourcePath)
    const ffArgs = ['-i', sourcePath, '-vf', buildFilter(opts.profile), ...encoderArgs(opts.profile), outputPath]
    await runFfmpeg(
      ffArgs,
      opts.logPaths
        ? { ...opts.logPaths, commandLog: opts.logPaths.commandLog, commandLabel: `upload_image_derivatives_v1:${opts.profile.key}` }
        : undefined
    )
    const outInfo = await probeMediaInfo(outputPath)
    const sizeBytes = (() => {
      try { return fs.statSync(outputPath).size } catch { return null }
    })()
    const put = await s3.send(
      new PutObjectCommand({
        Bucket: opts.output.bucket,
        Key: opts.output.key,
        Body: fs.createReadStream(outputPath),
        ContentType: contentTypeFor(opts.profile.format),
        CacheControl: 'public, max-age=31536000, immutable',
      })
    )
    return {
      output: {
        bucket: opts.output.bucket,
        key: opts.output.key,
        s3Url: `s3://${opts.output.bucket}/${opts.output.key}`,
        etag: put.ETag == null ? null : String(put.ETag).replace(/"/g, ''),
      },
      width: outInfo?.width != null ? Number(outInfo.width) : null,
      height: outInfo?.height != null ? Number(outInfo.height) : null,
      sizeBytes: sizeBytes == null ? null : Number(sizeBytes),
      metricsInput,
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}
