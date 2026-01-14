export type ProductionDraftStatus = 'active' | 'archived'

export type ProductionDraftRow = {
  id: number
  user_id: number
  upload_id: number
  status: ProductionDraftStatus
  config_json: any
  rendered_production_id: number | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

export type ProductionDraftDto = {
  id: number
  uploadId: number
  status: ProductionDraftStatus
  config: any
  renderedProductionId: number | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

