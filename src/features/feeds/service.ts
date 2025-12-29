import { listGlobalFeedRows, getSpaceFeedPinnedRowByProductionUlid } from './repo'
import { enhanceUploadRow } from '../../utils/enhance'
import { type FeedResponse } from './types'
import { listSpaceFeedRows } from './repo'
import { clampLimit, parseTsIdCursor, buildTsIdCursor } from '../../core/pagination'
import { SpacePublicationStatus, SpacePublicationVisibility } from '../../db'

export async function getGlobalFeed(opts: { userId: number; limit?: number; cursor?: string | null }): Promise<FeedResponse> {
  const limit = clampLimit(opts.limit, 20, 1, 100)
  const parsed = parseTsIdCursor(opts.cursor ?? null)
  const cursorPublishedAt = parsed?.ts ?? null
  const cursorId = parsed?.id ?? null

  const rows = await listGlobalFeedRows({ cursorPublishedAt, cursorId, limit, userId: opts.userId })
  const items = rows.map((row) => {
    let distribution: any = null
    if (row.distribution_flags) {
      try { distribution = JSON.parse(row.distribution_flags) } catch { distribution = null }
    }
    const publication = {
      id: Number(row.publication_id),
      upload_id: Number(row.upload_id),
      production_id: row.production_id != null ? Number(row.production_id) : (row.production_id_resolved != null ? Number(row.production_id_resolved) : null),
      production_ulid: row.production_ulid ? String(row.production_ulid) : null,
      space_id: Number(row.space_id),
      likes_count: row.likes_count != null ? Number(row.likes_count) : 0,
      comments_count: row.comments_count != null ? Number(row.comments_count) : 0,
      liked_by_me: Boolean(row.liked_by_me),
      commented_by_me: Boolean(row.commented_by_me),
      reported_by_me: Boolean(row.reported_by_me),
      status: String(row.publication_status) as SpacePublicationStatus,
      requested_by: row.requested_by == null ? null : Number(row.requested_by),
      approved_by: row.approved_by == null ? null : Number(row.approved_by),
      is_primary: Boolean(Number(row.is_primary)),
      visibility: (row.publication_visibility || 'inherit') as SpacePublicationVisibility,
      distribution_flags: distribution,
      published_at: row.published_at ? String(row.published_at) : null,
      unpublished_at: row.unpublished_at ? String(row.unpublished_at) : null,
      created_at: String(row.publication_created_at),
      updated_at: String(row.publication_updated_at),
    }
    const uploadRaw: any = {
      id: Number(row.upload_id),
      s3_bucket: row.s3_bucket,
      s3_key: row.s3_key,
      original_filename: row.original_filename,
      modified_filename: row.modified_filename ? String(row.modified_filename) : row.original_filename,
      description: row.upload_description != null ? String(row.upload_description) : null,
      content_type: row.content_type,
      size_bytes: row.size_bytes != null ? Number(row.size_bytes) : null,
      width: row.width != null ? Number(row.width) : null,
      height: row.height != null ? Number(row.height) : null,
      duration_seconds: row.duration_seconds != null ? Number(row.duration_seconds) : null,
      status: row.upload_status,
      etag: row.etag,
      mediaconvert_job_id: row.mediaconvert_job_id,
      output_prefix: row.output_prefix,
      asset_uuid: row.asset_uuid,
      date_ymd: row.date_ymd,
      profile: row.profile,
      orientation: row.orientation,
      created_at: String(row.upload_created_at),
      uploaded_at: row.uploaded_at ? String(row.uploaded_at) : null,
      user_id: row.upload_user_id != null ? Number(row.upload_user_id) : null,
      space_id: row.upload_space_id != null ? Number(row.upload_space_id) : null,
      origin_space_id: row.origin_space_id != null ? Number(row.origin_space_id) : null,
    }
    const upload = enhanceUploadRow(uploadRaw)
    const owner = row.owner_id
      ? {
          id: Number(row.owner_id),
          displayName: row.owner_display_name,
          email: row.owner_email,
          avatarUrl: row.owner_avatar_url ? String(row.owner_avatar_url) : null,
        }
      : null
    return { publication, upload, owner }
  })

  let nextCursor: string | null = null
  if (rows.length === limit && items.length) {
    const last = items[items.length - 1].publication as any
    if (last.published_at) nextCursor = buildTsIdCursor(last.published_at, last.id)
  }

  return { items, nextCursor }
}

export async function getSpaceFeed(spaceId: number, opts: { userId: number; limit?: number; cursor?: string | null }): Promise<FeedResponse> {
  const limit = clampLimit(opts.limit, 20, 1, 100)
  const parsed = parseTsIdCursor(opts.cursor ?? null)
  const cursorPublishedAt = parsed?.ts ?? null
  const cursorId = parsed?.id ?? null

  const rows = await listSpaceFeedRows(spaceId, { cursorPublishedAt, cursorId, limit, userId: opts.userId })
  const items = rows.map((row) => {
    let distribution: any = null
    if (row.distribution_flags) {
      try { distribution = JSON.parse(row.distribution_flags) } catch { distribution = null }
    }
    const publication = {
      id: Number(row.publication_id),
      upload_id: Number(row.upload_id),
      production_id: row.production_id != null ? Number(row.production_id) : (row.production_id_resolved != null ? Number(row.production_id_resolved) : null),
      production_ulid: row.production_ulid ? String(row.production_ulid) : null,
      space_id: Number(row.space_id),
      likes_count: row.likes_count != null ? Number(row.likes_count) : 0,
      comments_count: row.comments_count != null ? Number(row.comments_count) : 0,
      liked_by_me: Boolean(row.liked_by_me),
      commented_by_me: Boolean(row.commented_by_me),
      reported_by_me: Boolean(row.reported_by_me),
      status: String(row.publication_status) as SpacePublicationStatus,
      requested_by: row.requested_by == null ? null : Number(row.requested_by),
      approved_by: row.approved_by == null ? null : Number(row.approved_by),
      is_primary: Boolean(Number(row.is_primary)),
      visibility: (row.publication_visibility || 'inherit') as SpacePublicationVisibility,
      distribution_flags: distribution,
      published_at: row.published_at ? String(row.published_at) : null,
      unpublished_at: row.unpublished_at ? String(row.unpublished_at) : null,
      created_at: String(row.publication_created_at),
      updated_at: String(row.publication_updated_at),
    }
    const uploadRaw: any = {
      id: Number(row.upload_id),
      s3_bucket: row.s3_bucket,
      s3_key: row.s3_key,
      original_filename: row.original_filename,
      modified_filename: row.modified_filename ? String(row.modified_filename) : row.original_filename,
      description: row.upload_description != null ? String(row.upload_description) : null,
      content_type: row.content_type,
      size_bytes: row.size_bytes != null ? Number(row.size_bytes) : null,
      width: row.width != null ? Number(row.width) : null,
      height: row.height != null ? Number(row.height) : null,
      duration_seconds: row.duration_seconds != null ? Number(row.duration_seconds) : null,
      status: row.upload_status,
      etag: row.etag,
      mediaconvert_job_id: row.mediaconvert_job_id,
      output_prefix: row.output_prefix,
      asset_uuid: row.asset_uuid,
      date_ymd: row.date_ymd,
      profile: row.profile,
      orientation: row.orientation,
      created_at: String(row.upload_created_at),
      uploaded_at: row.uploaded_at ? String(row.uploaded_at) : null,
      user_id: row.upload_user_id != null ? Number(row.upload_user_id) : null,
      space_id: row.upload_space_id != null ? Number(row.upload_space_id) : null,
      origin_space_id: row.origin_space_id != null ? Number(row.origin_space_id) : null,
    }
    const upload = enhanceUploadRow(uploadRaw)
    const owner = row.owner_id
      ? {
          id: Number(row.owner_id),
          displayName: row.owner_display_name,
          email: row.owner_email,
          avatarUrl: row.owner_avatar_url ? String(row.owner_avatar_url) : null,
        }
      : null
    return { publication, upload, owner }
  })

  let nextCursor: string | null = null
  if (rows.length === limit && items.length) {
    const last = items[items.length - 1].publication as any
    if (last.published_at) nextCursor = buildTsIdCursor(last.published_at, last.id)
  }

  return { items, nextCursor }
}

export async function getPinnedSpaceFeedItem(spaceId: number, opts: { userId: number; productionUlid: string }): Promise<FeedResponse['items'][number] | null> {
  const productionUlid = String(opts.productionUlid || '').trim()
  if (!productionUlid) return null
  const row = await getSpaceFeedPinnedRowByProductionUlid(spaceId, { productionUlid, userId: opts.userId })
  if (!row) return null

  let distribution: any = null
  if (row.distribution_flags) {
    try { distribution = JSON.parse(row.distribution_flags) } catch { distribution = null }
  }
  const publication = {
    id: Number(row.publication_id),
    upload_id: Number(row.upload_id),
    production_id: row.production_id != null ? Number(row.production_id) : (row.production_id_resolved != null ? Number(row.production_id_resolved) : null),
    production_ulid: row.production_ulid ? String(row.production_ulid) : null,
    space_id: Number(row.space_id),
    likes_count: row.likes_count != null ? Number(row.likes_count) : 0,
    comments_count: row.comments_count != null ? Number(row.comments_count) : 0,
    liked_by_me: Boolean(row.liked_by_me),
    commented_by_me: Boolean(row.commented_by_me),
    reported_by_me: Boolean(row.reported_by_me),
    status: String(row.publication_status) as SpacePublicationStatus,
    requested_by: row.requested_by == null ? null : Number(row.requested_by),
    approved_by: row.approved_by == null ? null : Number(row.approved_by),
    is_primary: Boolean(Number(row.is_primary)),
    visibility: (row.publication_visibility || 'inherit') as SpacePublicationVisibility,
    distribution_flags: distribution,
    published_at: row.published_at ? String(row.published_at) : null,
    unpublished_at: row.unpublished_at ? String(row.unpublished_at) : null,
    created_at: String(row.publication_created_at),
    updated_at: String(row.publication_updated_at),
  }
  const uploadRaw: any = {
    id: Number(row.upload_id),
    s3_bucket: row.s3_bucket,
    s3_key: row.s3_key,
    original_filename: row.original_filename,
    modified_filename: row.modified_filename ? String(row.modified_filename) : row.original_filename,
    description: row.upload_description != null ? String(row.upload_description) : null,
    content_type: row.content_type,
    size_bytes: row.size_bytes != null ? Number(row.size_bytes) : null,
    width: row.width != null ? Number(row.width) : null,
    height: row.height != null ? Number(row.height) : null,
    duration_seconds: row.duration_seconds != null ? Number(row.duration_seconds) : null,
    status: row.upload_status,
    etag: row.etag,
    mediaconvert_job_id: row.mediaconvert_job_id,
    output_prefix: row.output_prefix,
    asset_uuid: row.asset_uuid,
    date_ymd: row.date_ymd,
    profile: row.profile,
    orientation: row.orientation,
    created_at: String(row.upload_created_at),
    uploaded_at: row.uploaded_at ? String(row.uploaded_at) : null,
    user_id: row.upload_user_id != null ? Number(row.upload_user_id) : null,
    space_id: row.upload_space_id != null ? Number(row.upload_space_id) : null,
    origin_space_id: row.origin_space_id != null ? Number(row.origin_space_id) : null,
  }
  const upload = enhanceUploadRow(uploadRaw)
  const owner = row.owner_id
    ? {
        id: Number(row.owner_id),
        displayName: row.owner_display_name,
        email: row.owner_email,
        avatarUrl: row.owner_avatar_url ? String(row.owner_avatar_url) : null,
      }
    : null
  return { publication, upload, owner }
}
