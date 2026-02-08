export type MediaJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'dead'

export type MediaJobType =
  | 'audio_master_v1'
  | 'video_master_v1'
  | 'create_video_export_v1'
  | 'upload_thumb_v1'
  | 'upload_edit_proxy_v1'
  | 'upload_audio_envelope_v1'
  | 'upload_freeze_frame_v1'
  | 'assemblyai_transcript_v1'
  | 'assemblyai_upload_transcript_v1'

export type MediaJobRow = {
  id: number
  type: string
  status: MediaJobStatus
  priority: number
  attempts: number
  max_attempts: number
  run_after: string | null
  locked_at: string | null
  locked_by: string | null
  input_json: any
  result_json: any
  error_code: string | null
  error_message: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

export type MediaJobAttemptRow = {
  id: number
  job_id: number
  attempt_no: number
  worker_id: string | null
  started_at: string
  finished_at: string | null
  exit_code: number | null
  stdout_s3_bucket: string | null
  stdout_s3_key: string | null
  stderr_s3_bucket: string | null
  stderr_s3_key: string | null
  artifacts_s3_bucket: string | null
  artifacts_s3_prefix: string | null
  scratch_manifest_json: any
}

export type S3Pointer = { bucket: string; key: string }

export type LogoOverlayV1 = {
  image: S3Pointer
  width: number
  height: number
  config: {
    position?: any
    sizePctWidth?: any
    opacityPct?: any
    timingRule?: any
    timingSeconds?: any
    fade?: any
    insetXPreset?: any
    insetYPreset?: any
  }
}

export type LowerThirdImageOverlayV1 = {
  image: S3Pointer
  width: number
  height: number
  config: {
    sizeMode?: any
    baselineWidth?: any
    position?: any
    sizePctWidth?: any
    opacityPct?: any
    timingRule?: any
    timingSeconds?: any
    fade?: any
    insetXPreset?: any
    insetYPreset?: any
  }
}

export type ScreenTitlePresetSnapshotV1 = {
  id?: number
  name?: string
  style?: 'none' | 'pill' | 'strip' | 'outline'
  fontKey?: string
  fontSizePct?: number
  trackingPct?: number
  lineSpacingPct?: number
  fontColor?: string
  shadowColor?: string
  shadowOffsetPx?: number
  shadowBlurPx?: number
  shadowOpacityPct?: number
  fontGradientKey?: string | null
  outlineWidthPct?: number | null
  outlineOpacityPct?: number | null
  outlineColor?: string | null
  pillBgColor?: string
  pillBgOpacityPct?: number
  alignment?: 'left' | 'center' | 'right'
  // Back-compat: older snapshots may still have top_* / bottom_* values.
  position?: 'top' | 'middle' | 'bottom' | 'top_left' | 'top_center' | 'top_right' | 'bottom_left' | 'bottom_center' | 'bottom_right'
  maxWidthPct?: number
  insetXPreset?: 'small' | 'medium' | 'large' | null
  insetYPreset?: 'small' | 'medium' | 'large' | null
  marginLeftPct?: number | null
  marginRightPct?: number | null
  marginTopPct?: number | null
  marginBottomPct?: number | null
  timingRule?: 'entire' | 'first_only'
  timingSeconds?: number | null
  fade?: 'none' | 'in' | 'out' | 'in_out'
}

export type ScreenTitleV1 = {
  text: string
  preset: ScreenTitlePresetSnapshotV1
}

export type IntroV1 =
  | { kind: 'freeze_first_frame'; seconds: number }
  | { kind: 'title_image'; uploadId: number; holdSeconds: number; titleImage: S3Pointer }

export type EditRecipeV1 = {
  trimStartSeconds?: number | null
  trimEndSeconds?: number | null
  ranges?: Array<{ start: number; end: number }> | null
}

export type TimelineOverlayImageV1 = {
  id: string
  kind: 'image'
  track: 'A'
  uploadId: number
  startSeconds: number
  endSeconds: number
  fit: 'cover'
  opacityPct: number
  image: S3Pointer
  width: number
  height: number
}

export type AudioMasterV1Input = {
  productionId: number
  productionUlid: string
  userId: number
  uploadId: number
  dateYmd: string
  originalLeaf: string
  videoDurationSeconds: number | null
  video: S3Pointer
  music: S3Pointer
  edit?: EditRecipeV1 | null
  screenTitle?: ScreenTitleV1 | null
  logo?: LogoOverlayV1 | null
  lowerThirdImage?: LowerThirdImageOverlayV1 | null
  intro?: IntroV1 | null
  timeline?: { overlays?: TimelineOverlayImageV1[] } | null
  // Legacy (Plan 37): kept for backward compatibility with older queued jobs.
  introSeconds?: number | null
  mode: 'replace' | 'mix'
  videoGainDb: number
  musicGainDb: number
  duckingMode: 'none' | 'rolling' | 'abrupt'
  duckingGate: 'sensitive' | 'normal' | 'strict'
  duckingAmountDb: number
  openerCutFadeBeforeSeconds?: number | null
  openerCutFadeAfterSeconds?: number | null
  audioDurationSeconds: number | null
  audioFadeEnabled: boolean
  normalizeAudio: boolean
  normalizeTargetLkfs: number
  videoHighpassEnabled?: boolean
  videoHighpassHz?: number
  outputBucket: string
}

export type VideoMasterV1Input = {
  productionId: number
  productionUlid: string
  userId: number
  uploadId: number
  dateYmd: string
  originalLeaf: string
  videoDurationSeconds: number | null
  video: S3Pointer
  edit?: EditRecipeV1 | null
  screenTitle?: ScreenTitleV1 | null
  logo?: LogoOverlayV1 | null
  lowerThirdImage?: LowerThirdImageOverlayV1 | null
  intro?: IntroV1 | null
  timeline?: { overlays?: TimelineOverlayImageV1[] } | null
  // Legacy (Plan 37): kept for backward compatibility with older queued jobs.
  introSeconds?: number
  outputBucket: string
}

export type UploadThumbV1Input = {
  uploadId: number
  userId: number
  video: S3Pointer
  outputBucket: string
  outputKey: string
  longEdgePx: number
  seekSeconds?: number
  force?: boolean
}

export type UploadEditProxyV1Input = {
  uploadId: number
  userId: number
  video: S3Pointer
  outputBucket: string
  outputKey: string
  longEdgePx: number
  fps: number
  gop: number
}

export type UploadAudioEnvelopeV1Input = {
  uploadId: number
  userId: number
  proxy: S3Pointer
  outputBucket: string
  outputKey: string
  intervalSeconds: number
}

export type UploadFreezeFrameV1Input = {
  freezeUploadId: number
  uploadId: number
  userId: number
  proxy: S3Pointer
  atSeconds: number
  outputBucket: string
  outputKey: string
  longEdgePx: number
}

export type AssemblyAiTranscriptV1Input = {
  productionId: number
}

export type AssemblyAiUploadTranscriptV1Input = {
  uploadId: number
  userId?: number
}

export type MediaJobInputByType = {
  audio_master_v1: AudioMasterV1Input
  video_master_v1: VideoMasterV1Input
  upload_thumb_v1: UploadThumbV1Input
  upload_edit_proxy_v1: UploadEditProxyV1Input
  upload_audio_envelope_v1: UploadAudioEnvelopeV1Input
  upload_freeze_frame_v1: UploadFreezeFrameV1Input
  assemblyai_transcript_v1: AssemblyAiTranscriptV1Input
  assemblyai_upload_transcript_v1: AssemblyAiUploadTranscriptV1Input
}
