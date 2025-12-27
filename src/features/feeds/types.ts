import { SpacePublicationStatus, SpacePublicationVisibility } from '../../db'

export type FeedPublication = {
  id: number
  upload_id: number
  likes_count: number
  comments_count: number
  liked_by_me: boolean
  commented_by_me: boolean
  reported_by_me?: boolean
  production_id?: number | null
  production_ulid?: string | null
  space_id: number
  status: SpacePublicationStatus
  requested_by: number | null
  approved_by: number | null
  is_primary: boolean
  visibility: SpacePublicationVisibility
  distribution_flags: any | null
  published_at: string | null
  unpublished_at: string | null
  created_at: string
  updated_at: string
}

export type FeedOwner = { id: number; displayName: string | null; email: string | null } | null

export type GlobalFeedItem = {
  publication: FeedPublication
  upload: any
  owner: FeedOwner
}

export type FeedResponse = { items: GlobalFeedItem[]; nextCursor: string | null }
