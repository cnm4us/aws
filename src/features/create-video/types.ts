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

export type CreateVideoTimelineV1 = {
  version: 'create_video_v1'
  playheadSeconds?: number
  clips: CreateVideoClipV1[]
  stills?: CreateVideoStillV1[]
  graphics?: CreateVideoGraphicV1[]
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
