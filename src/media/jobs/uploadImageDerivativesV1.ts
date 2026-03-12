import {
  IMAGE_VARIANT_PROFILE_BY_KEY,
  IMAGE_VARIANT_PROFILES,
  type ImageVariantProfile,
  type ImageVariantUsage,
} from '../../config'
import type { UploadImageDerivativesV1Input } from '../../features/media-jobs/types'
import * as uploadImageVariants from '../../features/upload-image-variants/service'
import { createUploadImageVariant } from '../../services/ffmpeg/imageVariantPipeline'
import { buildUploadImageVariantKey } from '../../utils/uploadImageVariant'

function normalizeKind(raw: unknown): 'image' | 'logo' {
  return String(raw || '').trim().toLowerCase() === 'logo' ? 'logo' : 'image'
}

function normalizeImageRole(raw: unknown): string | null {
  const v = String(raw || '').trim().toLowerCase()
  return v || null
}

function inferUsage(kind: 'image' | 'logo', imageRole: string | null): ImageVariantUsage[] {
  if (kind === 'logo') return ['logo']
  if (imageRole === 'lower_third') return ['lower_third']
  return ['prompt_bg', 'graphic_overlay']
}

function selectProfiles(input: UploadImageDerivativesV1Input): ImageVariantProfile[] {
  const requested = Array.isArray(input.profileKeys)
    ? input.profileKeys.map((x) => String(x || '').trim()).filter(Boolean)
    : []
  if (requested.length) {
    const out: ImageVariantProfile[] = []
    for (const key of requested) {
      const profile = IMAGE_VARIANT_PROFILE_BY_KEY.get(key)
      if (profile) out.push(profile)
    }
    if (out.length) return out
  }

  const kind = normalizeKind(input.kind)
  const usageSet = new Set(inferUsage(kind, normalizeImageRole(input.imageRole)))
  return IMAGE_VARIANT_PROFILES.filter((p) => usageSet.has(p.usage))
}

function errorCodeFor(err: unknown): string {
  const msg = String((err as any)?.message || err || '').trim().toLowerCase()
  if (!msg) return 'variant_failed'
  if (msg.includes('ffmpeg')) return 'variant_ffmpeg_failed'
  if (msg.includes('missing')) return 'variant_input_missing'
  if (msg.includes('s3')) return 'variant_s3_failed'
  return 'variant_failed'
}

export async function runUploadImageDerivativesV1Job(
  input: UploadImageDerivativesV1Input,
  logPaths?: { stdoutPath?: string; stderrPath?: string }
): Promise<{
  output: { bucket: string; prefix: string }
  generated: Array<{ profileKey: string; usage: ImageVariantUsage; key: string; sizeBytes: number | null }>
  skipped: Array<{ profileKey: string; usage: ImageVariantUsage; key: string }>
  failed: Array<{ profileKey: string; usage: ImageVariantUsage; key: string; errorCode: string }>
  metricsInput?: any
  ffmpegCommands?: string[]
}> {
  const uploadId = Number(input.uploadId)
  if (!Number.isFinite(uploadId) || uploadId <= 0) throw new Error('invalid_upload_id')
  const sourceBucket = String(input.image?.bucket || '').trim()
  const sourceKey = String(input.image?.key || '').trim()
  if (!sourceBucket || !sourceKey) throw new Error('missing_source_pointer')
  const outputBucket = String(input.outputBucket || '').trim()
  if (!outputBucket) throw new Error('missing_output_bucket')

  const profiles = selectProfiles(input)
  if (!profiles.length) throw new Error('no_profiles_selected')

  const force = Boolean(input.force)
  const generated: Array<{ profileKey: string; usage: ImageVariantUsage; key: string; sizeBytes: number | null }> = []
  const skipped: Array<{ profileKey: string; usage: ImageVariantUsage; key: string }> = []
  const failed: Array<{ profileKey: string; usage: ImageVariantUsage; key: string; errorCode: string }> = []
  const ffmpegCommands: string[] = []
  let metricsInput: any = null

  for (const profile of profiles) {
    const outKey = buildUploadImageVariantKey(uploadId, profile.key, profile.format)

    if (!force) {
      try {
        const existing = await uploadImageVariants.getVariantByProfile(uploadId, profile.key)
        if (existing && existing.status === 'ready') {
          skipped.push({ profileKey: profile.key, usage: profile.usage, key: existing.s3Key || outKey })
          continue
        }
      } catch {}
    }

    try {
      const result = await createUploadImageVariant({
        source: { bucket: sourceBucket, key: sourceKey },
        output: { bucket: outputBucket, key: outKey },
        profile,
        logPaths: logPaths ? { ...logPaths, commandLog: ffmpegCommands } : undefined,
      })
      if (!metricsInput && result.metricsInput) metricsInput = result.metricsInput
      await uploadImageVariants.upsertVariant({
        uploadId,
        profileKey: profile.key,
        usage: profile.usage,
        format: profile.format,
        width: result.width,
        height: result.height,
        sizeBytes: result.sizeBytes,
        s3Bucket: result.output.bucket,
        s3Key: result.output.key,
        etag: result.output.etag,
        status: 'ready',
        errorCode: null,
      })
      generated.push({
        profileKey: profile.key,
        usage: profile.usage,
        key: result.output.key,
        sizeBytes: result.sizeBytes,
      })
    } catch (err) {
      const errorCode = errorCodeFor(err)
      try {
        await uploadImageVariants.upsertVariant({
          uploadId,
          profileKey: profile.key,
          usage: profile.usage,
          format: profile.format,
          width: null,
          height: null,
          sizeBytes: null,
          s3Bucket: outputBucket,
          s3Key: outKey,
          etag: null,
          status: 'failed',
          errorCode,
        })
      } catch {}
      failed.push({ profileKey: profile.key, usage: profile.usage, key: outKey, errorCode })
    }
  }

  if (!generated.length && !skipped.length) {
    throw new Error('image_variants_all_failed')
  }

  const prefix = generated[0]?.key.replace(/[^/]+$/, '') || skipped[0]?.key.replace(/[^/]+$/, '') || ''
  return {
    output: { bucket: outputBucket, prefix },
    generated,
    skipped,
    failed,
    metricsInput,
    ffmpegCommands,
  }
}
