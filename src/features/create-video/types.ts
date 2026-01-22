export type CreateVideoProjectStatus = 'active' | 'archived'

export type CreateVideoClipV1 = {
  id: string
  uploadId: number
  // Absolute placement on the timeline; when omitted, defaults to sequential placement after the previous clip.
  startSeconds?: number
  sourceStartSeconds: number
  sourceEndSeconds: number
  // Deprecated (Plan 64): freezes are now explicit still segments (stills[]).
  // Kept temporarily for backward compatibility with existing projects.
  freezeStartSeconds?: number
  // Deprecated (Plan 64): freezes are now explicit still segments (stills[]).
  // Kept temporarily for backward compatibility with existing projects.
  freezeEndSeconds?: number
}

export type CreateVideoGraphicV1 = {
  id: string
  uploadId: number
  startSeconds: number
  endSeconds: number
}

export type CreateVideoLogoConfigSnapshotV1 = {
  id: number
  name: string
  position: string
  sizePctWidth: number
  opacityPct: number
  timingRule: string
  timingSeconds: number | null
  fade: string
  insetXPreset?: string | null
  insetYPreset?: string | null
}

export type CreateVideoLogoV1 = {
  id: string
  uploadId: number
  startSeconds: number
  endSeconds: number
  configId: number
  configSnapshot: CreateVideoLogoConfigSnapshotV1
}

export type CreateVideoLowerThirdConfigSnapshotV1 = {
  id: number
  name: string
  description?: string | null
  sizeMode: 'pct' | 'match_image'
  baselineWidth: 1080 | 1920
  position: string
  sizePctWidth: number
  opacityPct: number
  timingRule: 'first_only' | 'entire'
  timingSeconds: number | null
  fade: string
  insetXPreset?: string | null
  insetYPreset?: string | null
}

export type CreateVideoLowerThirdV1 = {
  id: string
  uploadId: number
  startSeconds: number
  endSeconds: number
  configId: number
  configSnapshot: CreateVideoLowerThirdConfigSnapshotV1
}

export type CreateVideoScreenTitlePresetSnapshotV1 = {
  id: number
  name: string
  style: 'none' | 'pill' | 'strip' | 'outline'
  fontKey: string
  fontSizePct: number
  trackingPct: number
  lineSpacingPct?: number
  fontColor: string
  shadowColor?: string
  shadowOffsetPx?: number
  shadowBlurPx?: number
  shadowOpacityPct?: number
  fontGradientKey?: string | null
  outlineWidthPct?: number | null
  outlineOpacityPct?: number | null
  outlineColor?: string | null
  pillBgColor: string
  pillBgOpacityPct: number
  alignment?: 'left' | 'center' | 'right'
  position: 'top' | 'middle' | 'bottom'
  maxWidthPct: number
  insetXPreset: 'small' | 'medium' | 'large' | null
  insetYPreset: 'small' | 'medium' | 'large' | null
  marginLeftPct?: number | null
  marginRightPct?: number | null
  marginTopPct?: number | null
  marginBottomPct?: number | null
  fade: 'none' | 'in' | 'out' | 'in_out'
}

export type CreateVideoScreenTitleV1 = {
  id: string
  startSeconds: number
  endSeconds: number
  presetId: number | null
  presetSnapshot: CreateVideoScreenTitlePresetSnapshotV1 | null
  text: string
  renderUploadId: number | null
}

export type CreateVideoStillV1 = {
  id: string
  uploadId: number
  startSeconds: number
  endSeconds: number
  // Optional linkage for debugging/UX (e.g. which clip generated this).
  sourceClipId?: string
}

export type CreateVideoAudioTrackV1 = {
  uploadId: number
  audioConfigId: number
  startSeconds: number
  endSeconds: number
}

export type CreateVideoAudioSegmentV1 = {
  id: string
  uploadId: number
  audioConfigId: number
  startSeconds: number
  endSeconds: number
  // Offset into the audio file for where this segment begins (in seconds).
  // This enables split/trim to play the continuation instead of restarting at 0.
  sourceStartSeconds?: number
}

export type CreateVideoNarrationSegmentV1 = {
  id: string
  uploadId: number
  startSeconds: number
  endSeconds: number
  sourceStartSeconds?: number
  gainDb?: number
}

export type CreateVideoTimelineV1 = {
  version: 'create_video_v1'
  playheadSeconds?: number
  clips: CreateVideoClipV1[]
  stills?: CreateVideoStillV1[]
  graphics?: CreateVideoGraphicV1[]
  guidelines?: number[]
  logos?: CreateVideoLogoV1[]
  lowerThirds?: CreateVideoLowerThirdV1[]
  screenTitles?: CreateVideoScreenTitleV1[]
  narration?: CreateVideoNarrationSegmentV1[]
  audioSegments?: CreateVideoAudioSegmentV1[]
  // Deprecated: retained for backward compatibility with existing projects.
  audioTrack?: CreateVideoAudioTrackV1 | null
}

export type CreateVideoProjectRow = {
  id: number
  user_id: number
  status: CreateVideoProjectStatus
  timeline_json: any
  last_export_upload_id: number | null
  last_export_job_id: number | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

export type CreateVideoProjectDto = {
  id: number
  status: CreateVideoProjectStatus
  timeline: CreateVideoTimelineV1
  lastExportUploadId: number | null
  lastExportJobId: number | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}
