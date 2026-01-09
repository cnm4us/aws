import { SpacePublicationStatus, SpacePublicationVisibility } from '../../db'

// Consolidated: reuse canonical types from db.ts to avoid drift
export type Visibility = SpacePublicationVisibility
export type PublicationStatus = SpacePublicationStatus

export type Publication = {
  id: number
  upload_id: number
  production_id: number | null
  space_id: number
  status: PublicationStatus
  requested_by: number | null
  approved_by: number | null
  is_primary: boolean
  visibility: Visibility
  distribution_flags: any | null
  owner_user_id: number | null
  visible_in_space: boolean
  visible_in_global: boolean
  story_text: string | null
  story_updated_at: string | null
  story_source?: 'production' | 'custom' | string
  published_at: string | null
  unpublished_at: string | null
  created_at: string
  updated_at: string
}

export type PublicationEvent = {
  id: number
  publication_id: number
  actor_user_id: number | null
  action: string
  detail: any | null
  created_at: string
}

export type CreateFromUploadInput = {
  uploadId: number
  spaceId: number
  visibility?: Visibility
  distributionFlags?: any
}

export type CreateFromProductionInput = {
  productionId: number
  spaceId: number
  visibility?: Visibility
  distributionFlags?: any
}

export type PermissionChecker = unknown

export type ServiceContext = {
  userId: number
  checker?: PermissionChecker
}
