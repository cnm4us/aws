export type MediaJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'dead'

export type MediaJobType = 'audio_master_v1' | 'video_master_v1'

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
  introSeconds: number
  outputBucket: string
}

export type MediaJobInputByType = {
  audio_master_v1: AudioMasterV1Input
  video_master_v1: VideoMasterV1Input
}
