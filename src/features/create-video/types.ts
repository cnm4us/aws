export type CreateVideoProjectStatus = 'active' | 'archived'

export type CreateVideoClipV1 = {
  id: string
  uploadId: number
  // Absolute placement on the timeline; when omitted, defaults to sequential placement after the previous clip.
  startSeconds?: number
  sourceStartSeconds: number
  sourceEndSeconds: number
  audioEnabled?: boolean
  // Optional per-clip loudness adjustment (MVP: 0/+3/+6/+9).
  boostDb?: number
  // Optional background fill (landscape->portrait only).
  bgFillStyle?: 'none' | 'blur' | 'color' | 'image'
  bgFillBrightness?: 'light3' | 'light2' | 'light1' | 'neutral' | 'dim1' | 'dim2' | 'dim3'
  bgFillBlur?: 'soft' | 'medium' | 'strong' | 'very_strong'
  bgFillColor?: string
  bgFillImageUploadId?: number | null
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
  // Optional placement fields (v1).
  fitMode?: 'cover_full' | 'contain_transparent'
  sizePctWidth?: number
  position?:
    | 'top_left'
    | 'top_center'
    | 'top_right'
    | 'middle_left'
    | 'middle_center'
    | 'middle_right'
    | 'bottom_left'
    | 'bottom_center'
    | 'bottom_right'
  insetXPx?: number
  insetYPx?: number
  // Optional presentation effects (v1).
  borderWidthPx?: 0 | 2 | 4 | 6
  borderColor?: string
  fade?: 'none' | 'in' | 'out' | 'in_out'
  fadeDurationMs?: number
  // Optional motion effects (v1.1).
  animate?: 'none' | 'slide_in' | 'slide_out' | 'slide_in_out' | 'doc_reveal'
  animateDurationMs?: number
}

export type CreateVideoVideoOverlayV1 = {
  id: string
  uploadId: number
  // Absolute placement on the timeline; when omitted, defaults to sequential placement after the previous overlay.
  startSeconds?: number
  sourceStartSeconds: number
  sourceEndSeconds: number
  sizePctWidth: number
  position:
    | 'top_left'
    | 'top_center'
    | 'top_right'
    | 'middle_left'
    | 'middle_center'
    | 'middle_right'
  | 'bottom_left'
  | 'bottom_center'
  | 'bottom_right'
  audioEnabled?: boolean
  // Optional per-overlay loudness adjustment (MVP: 0/+3/+6/+9).
  boostDb?: number
  // Optional overlay plate (frame/band) styling.
  plateStyle?: 'none' | 'thin' | 'medium' | 'thick' | 'band'
  plateColor?: string
  plateOpacityPct?: number
}

export type CreateVideoVideoOverlayStillV1 = {
  id: string
  uploadId: number
  startSeconds: number
  endSeconds: number
  // Optional linkage for debugging/UX (e.g. which overlay generated this).
  sourceVideoOverlayId?: string
  // Optional: keep the still pinned to the same overlay box layout as its originating overlay (when known).
  sizePctWidth?: number
  position?: CreateVideoVideoOverlayV1['position']
}

export type CreateVideoLogoV1 = {
  id: string
  uploadId: number
  startSeconds: number
  endSeconds: number
  sizePctWidth?: number
  position?:
    | 'top_left'
    | 'top_center'
    | 'top_right'
    | 'middle_left'
    | 'middle_center'
    | 'middle_right'
    | 'bottom_left'
    | 'bottom_center'
    | 'bottom_right'
  opacityPct?: number
  fade?: 'none' | 'in' | 'out' | 'in_out'
  insetXPx?: number
  insetYPx?: number
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
  instances?: Array<{
    id: string
    text: string
    customStyle?: {
      position?: 'top' | 'middle' | 'bottom'
      alignment?: 'left' | 'center' | 'right'
      marginXPx?: number
      marginYPx?: number
      offsetXPx?: number
      offsetYPx?: number
      fontKey?: string
      fontSizePct?: number
      fontColor?: string
      fontGradientKey?: string | null
    } | null
  }>
  customStyle?: {
    position?: 'top' | 'middle' | 'bottom'
    alignment?: 'left' | 'center' | 'right'
    marginXPx?: number
    marginYPx?: number
    offsetXPx?: number
    offsetYPx?: number
    fontKey?: string
    fontSizePct?: number
    fontColor?: string
    fontGradientKey?: string | null
  } | null
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
  // Deprecated legacy audio config reference; Create Video MVP uses per-segment musicMode/musicLevel instead.
  audioConfigId?: number
  startSeconds: number
  endSeconds: number
  // Offset into the audio file for where this segment begins (in seconds).
  // This enables split/trim to play the continuation instead of restarting at 0.
  sourceStartSeconds?: number
  // If false, this segment contributes no audio (explicit mute).
  audioEnabled?: boolean
  // Object-centric music config (required for export when any music segments exist).
  musicMode?: 'opener_cutoff' | 'replace' | 'mix' | 'mix_duck'
  musicLevel?: 'quiet' | 'medium' | 'loud'
  duckingIntensity?: 'min' | 'medium' | 'max'
}

export type CreateVideoNarrationSegmentV1 = {
  id: string
  uploadId: number
  startSeconds: number
  endSeconds: number
  sourceStartSeconds?: number
  // Legacy continuous gain slider (may still exist in older projects).
  gainDb?: number
  // If false, narration is explicitly muted.
  audioEnabled?: boolean
  // Optional per-segment loudness adjustment (MVP: 0/+3/+6/+9). If present, overrides gainDb for export.
  boostDb?: number
}

export type CreateVideoTimelineV1 = {
  version: 'create_video_v1'
  playheadSeconds?: number
  timelineBackgroundMode?: 'none' | 'color' | 'image'
  timelineBackgroundColor?: string
  timelineBackgroundUploadId?: number | null
  // UI-only: allows the editor to show/scroll past the last content end
  // without affecting export duration (export duration is derived from content).
  // Stored/persisted so a refresh doesn't "snap back" shorter.
  viewportEndSeconds?: number
  clips: CreateVideoClipV1[]
  stills?: CreateVideoStillV1[]
  videoOverlays?: CreateVideoVideoOverlayV1[]
  videoOverlayStills?: CreateVideoVideoOverlayStillV1[]
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
  name: string | null
  description: string | null
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
  name: string | null
  description: string | null
  status: CreateVideoProjectStatus
  timeline: CreateVideoTimelineV1
  lastExportUploadId: number | null
  lastExportJobId: number | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export type CreateVideoProjectListItemDto = {
  id: number
  name: string | null
  description: string | null
  status: CreateVideoProjectStatus
  lastExportUploadId: number | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}
