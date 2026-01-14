export type CreateVideoProjectStatus = 'active' | 'archived'

export type CreateVideoClipV1 = {
  id: string
  uploadId: number
  sourceStartSeconds: number
  sourceEndSeconds: number
}

export type CreateVideoTimelineV1 = {
  version: 'create_video_v1'
  playheadSeconds?: number
  clips: CreateVideoClipV1[]
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

