export type Visibility = 'inherit' | 'members' | 'public'
export type PublicationStatus = 'draft' | 'pending' | 'approved' | 'published' | 'unpublished' | 'rejected'

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

