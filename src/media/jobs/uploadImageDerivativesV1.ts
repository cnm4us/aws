import {
  IMAGE_VARIANT_PROFILE_BY_KEY,
  IMAGE_VARIANT_PROFILES,
  type ImageVariantProfile,
  type ImageVariantUsage,
} from '../../config'
import { SpanStatusCode, trace } from '@opentelemetry/api'
import type { UploadImageDerivativesV1Input } from '../../features/media-jobs/types'
import * as uploadImageVariants from '../../features/upload-image-variants/service'
import { createUploadImageVariant } from '../../services/ffmpeg/imageVariantPipeline'
import { buildUploadImageVariantKey } from '../../utils/uploadImageVariant'
import { getLogger } from '../../lib/logger'

const imageVariantTracer = trace.getTracer('aws.uploads.image_variants')
const imageVariantLogger = getLogger({ component: 'mediajobs.upload_image_derivatives' })

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
  return ['message_bg', 'graphic_overlay']
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
    await imageVariantTracer.startActiveSpan(
      'uploads.image_variant.generate',
      {
        attributes: {
          'app.operation': 'uploads.image_variant.generate',
          upload_id: uploadId,
          variant_profile_key: profile.key,
          variant_usage: profile.usage,
          variant_format: profile.format,
          variant_force: force ? 1 : 0,
        },
      },
      async (span) => {
        const t0 = Date.now()
        try {
          imageVariantLogger.info(
            {
              upload_id: uploadId,
              profile_key: profile.key,
              usage: profile.usage,
              format: profile.format,
              source_bucket: sourceBucket,
              source_key: sourceKey,
              output_bucket: outputBucket,
              output_key: outKey,
              force,
            },
            'uploads.image_variant.generate.start'
          )

          if (!force) {
            try {
              const existing = await uploadImageVariants.getVariantByProfile(uploadId, profile.key)
              if (existing && existing.status === 'ready') {
                skipped.push({ profileKey: profile.key, usage: profile.usage, key: existing.s3Key || outKey })
                span.setAttributes({
                  app_outcome: 'redirect',
                  variant_skipped: true,
                  variant_skip_reason: 'already_ready',
                  variant_size_bytes: existing.sizeBytes ?? 0,
                })
                span.setStatus({ code: SpanStatusCode.OK })
                imageVariantLogger.info(
                  {
                    upload_id: uploadId,
                    profile_key: profile.key,
                    usage: profile.usage,
                    output_key: existing.s3Key || outKey,
                    duration_ms: Date.now() - t0,
                  },
                  'uploads.image_variant.generate.skipped'
                )
                return
              }
            } catch {}
          }

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
          span.setAttributes({
            app_outcome: 'success',
            variant_skipped: false,
            variant_width: result.width ?? undefined,
            variant_height: result.height ?? undefined,
            variant_size_bytes: result.sizeBytes ?? 0,
          })
          span.setStatus({ code: SpanStatusCode.OK })
          imageVariantLogger.info(
            {
              upload_id: uploadId,
              profile_key: profile.key,
              usage: profile.usage,
              format: profile.format,
              output_key: result.output.key,
              width: result.width,
              height: result.height,
              size_bytes: result.sizeBytes,
              duration_ms: Date.now() - t0,
            },
            'uploads.image_variant.generate.finish'
          )
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
          span.recordException(err as any)
          span.setAttributes({
            app_outcome: 'server_error',
            error_class: errorCode,
            variant_skipped: false,
          })
          span.setStatus({ code: SpanStatusCode.ERROR, message: String((err as any)?.message || err || errorCode) })
          imageVariantLogger.warn(
            {
              upload_id: uploadId,
              profile_key: profile.key,
              usage: profile.usage,
              format: profile.format,
              output_key: outKey,
              error_code: errorCode,
              duration_ms: Date.now() - t0,
              err: String((err as any)?.message || err || errorCode),
            },
            'uploads.image_variant.generate.failed'
          )
        } finally {
          span.end()
        }
      }
    )
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
