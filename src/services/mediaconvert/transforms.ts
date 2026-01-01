import { MEDIA_CONVERT_NORMALIZE_AUDIO } from '../../config'
import { applyAudioNormalization } from '../../jobs'

export type MediaConvertTransformContext = {
  config: any
  upload: any
  videoDurationSeconds: number | null
  productionUlid: string
}

export async function applyConfiguredTransforms(settings: any, ctx: MediaConvertTransformContext): Promise<void> {
  applyAudioNormalizationIfEnabled(settings)
  await applyCubeLutIfConfigured(settings, ctx)
  await applyLowerThirdsIfConfigured(settings, ctx)
}

function applyAudioNormalizationIfEnabled(settings: any) {
  if (!MEDIA_CONVERT_NORMALIZE_AUDIO) return
  applyAudioNormalization(settings, { targetLkfs: -16, aacBitrate: 128000 })
}

async function applyCubeLutIfConfigured(_settings: any, _ctx: MediaConvertTransformContext): Promise<void> {
  // no-op (future plan)
}

async function applyLowerThirdsIfConfigured(_settings: any, _ctx: MediaConvertTransformContext): Promise<void> {
  // no-op (future plan)
}

