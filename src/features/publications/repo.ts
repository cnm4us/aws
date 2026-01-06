import { getPool, SpacePublicationStatus, SpacePublicationVisibility } from '../../db'
import { type Publication, type PublicationEvent } from './types'

// NOTE: This module will hold all SQL for publications and related projections.
// Each function should accept an optional connection/transaction handle.

export async function getById(id: number, conn?: any): Promise<Publication | null> {
  const db = conn || getPool()
  const [rows] = await db.query(`SELECT * FROM space_publications WHERE id = ? LIMIT 1`, [id])
  const r = (rows as any[])[0]
  if (!r) return null
  return {
    id: Number(r.id),
    upload_id: Number(r.upload_id),
    production_id: r.production_id == null ? null : Number(r.production_id),
    space_id: Number(r.space_id),
    status: String(r.status) as SpacePublicationStatus,
    requested_by: r.requested_by == null ? null : Number(r.requested_by),
    approved_by: r.approved_by == null ? null : Number(r.approved_by),
    is_primary: Boolean(Number(r.is_primary)),
    visibility: String(r.visibility) as SpacePublicationVisibility,
    distribution_flags: r.distribution_flags ? (() => { try { return JSON.parse(String(r.distribution_flags)) } catch { return null } })() : null,
    owner_user_id: r.owner_user_id == null ? null : Number(r.owner_user_id),
    visible_in_space: Boolean(Number(r.visible_in_space)),
    visible_in_global: Boolean(Number(r.visible_in_global)),
    story_text: r.story_text == null ? null : String(r.story_text),
    story_updated_at: r.story_updated_at == null ? null : String(r.story_updated_at),
    published_at: r.published_at ? String(r.published_at) : null,
    unpublished_at: r.unpublished_at ? String(r.unpublished_at) : null,
    created_at: String(r.created_at),
    updated_at: r.updated_at ? String(r.updated_at) : String(r.created_at),
  }
}

export async function updateStory(publicationId: number, storyText: string | null, conn?: any): Promise<void> {
  const db = conn || getPool()
  const txt = storyText == null ? null : String(storyText)
  await db.query(
    `UPDATE space_publications
        SET story_text = ?,
            story_updated_at = NOW(),
            updated_at = NOW()
      WHERE id = ?`,
    [txt, publicationId]
  )
}

export async function getByProductionSpace(productionId: number, spaceId: number, _conn?: any): Promise<Publication | null> {
  const db = _conn || getPool()
  const [rows] = await db.query(`SELECT * FROM space_publications WHERE production_id = ? AND space_id = ? LIMIT 1`, [productionId, spaceId])
  const r = (rows as any[])[0]
  if (!r) return null
  return await getById(Number(r.id), db)
}

export async function listByUpload(uploadId: number, _conn?: any): Promise<Publication[]> {
  throw new Error('not_implemented: publications.repo.listByUpload')
}

export async function listByProduction(productionId: number, _conn?: any): Promise<Publication[]> {
  throw new Error('not_implemented: publications.repo.listByProduction')
}

export async function insert(data: {
  uploadId: number
  productionId: number | null
  spaceId: number
  status: string
  requestedBy: number | null
  approvedBy: number | null
  isPrimary: boolean
  visibility: 'inherit' | 'members' | 'public'
  distributionFlags: any | null
  ownerUserId: number | null
  visibleInSpace: boolean
  visibleInGlobal: boolean
  publishedAt?: Date | string | null
  unpublishedAt?: Date | string | null
}, conn?: any): Promise<Publication> {
  const db = conn || getPool()
  const publishedAt = data.publishedAt ? new Date(data.publishedAt).toISOString().slice(0,19).replace('T',' ') : null
  const unpublishedAt = data.unpublishedAt ? new Date(data.unpublishedAt).toISOString().slice(0,19).replace('T',' ') : null
  const distribution = data.distributionFlags == null ? null : JSON.stringify(data.distributionFlags)
  const [result] = await db.query(
    `INSERT INTO space_publications
       (upload_id, production_id, space_id, status, requested_by, approved_by, is_primary, visibility, distribution_flags, owner_user_id, visible_in_space, visible_in_global, published_at, unpublished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.uploadId,
      data.productionId,
      data.spaceId,
      data.status,
      data.requestedBy,
      data.approvedBy,
      data.isPrimary ? 1 : 0,
      data.visibility,
      distribution,
      data.ownerUserId,
      data.visibleInSpace ? 1 : 0,
      data.visibleInGlobal ? 1 : 0,
      publishedAt,
      unpublishedAt,
    ]
  )
  const id = Number((result as any).insertId)
  const created = await getById(id, db)
  if (!created) throw new Error('failed_to_create_space_publication')
  return created
}

export async function updateStatus(id: number, data: { status: string; approvedBy?: number | null; publishedAt?: Date | string | null; unpublishedAt?: Date | string | null; distributionFlags?: any }, conn?: any): Promise<Publication> {
  const db = conn || getPool()
  const publishedAt = data.publishedAt ? new Date(data.publishedAt).toISOString().slice(0, 19).replace('T', ' ') : null
  const unpublishedAt = data.unpublishedAt ? new Date(data.unpublishedAt).toISOString().slice(0, 19).replace('T', ' ') : null
  const distribution = data.distributionFlags == null ? null : JSON.stringify(data.distributionFlags)
  await db.query(
    `UPDATE space_publications
        SET status = ?,
            approved_by = COALESCE(?, approved_by),
            distribution_flags = COALESCE(?, distribution_flags),
            published_at = ?,
            unpublished_at = ?,
            updated_at = NOW()
      WHERE id = ?`,
    [data.status, data.approvedBy ?? null, distribution, publishedAt, unpublishedAt, id]
  )
  const updated = await getById(id, db)
  if (!updated) throw new Error('publication_not_found')
  return updated
}

export async function insertEvent(publicationId: number, actorUserId: number | null, action: string, detail: any | undefined, conn?: any): Promise<void> {
  const db = conn || getPool()
  const payload = detail == null ? null : JSON.stringify(detail)
  await db.query(
    `INSERT INTO space_publication_events (publication_id, actor_user_id, action, detail) VALUES (?, ?, ?, ?)`,
    [publicationId, actorUserId ?? null, action, payload]
  )
}

export async function listEvents(publicationId: number, conn?: any): Promise<PublicationEvent[]> {
  const db = conn || getPool()
  const [rows] = await db.query(
    `SELECT id, publication_id, actor_user_id, action, detail, created_at
       FROM space_publication_events
      WHERE publication_id = ?
      ORDER BY created_at ASC, id ASC`,
    [publicationId]
  )
  return (rows as any[]).map((e) => ({
    id: Number(e.id),
    publication_id: Number(e.publication_id),
    actor_user_id: e.actor_user_id == null ? null : Number(e.actor_user_id),
    action: String(e.action || ''),
    detail: (() => { try { return e.detail ? JSON.parse(String(e.detail)) : null } catch { return null } })(),
    created_at: String(e.created_at),
  }))
}

// Projections for dependent rows (space/upload/production) kept small and explicit to reduce coupling.
export async function loadUpload(uploadId: number, conn?: any): Promise<{ id: number; user_id: number | null; origin_space_id: number | null } | null> {
  const db = conn || getPool()
  const [rows] = await db.query(`SELECT id, user_id, origin_space_id FROM uploads WHERE id = ? LIMIT 1`, [uploadId])
  const row = (rows as any[])[0]
  if (!row) return null
  return { id: Number(row.id), user_id: row.user_id == null ? null : Number(row.user_id), origin_space_id: row.origin_space_id == null ? null : Number(row.origin_space_id) }
}

export async function loadProduction(productionId: number, conn?: any): Promise<{ id: number; upload_id: number; user_id: number } | null> {
  const db = conn || getPool()
  const [rows] = await db.query(`SELECT id, upload_id, user_id FROM productions WHERE id = ? LIMIT 1`, [productionId])
  const row = (rows as any[])[0]
  if (!row) return null
  return { id: Number(row.id), upload_id: Number(row.upload_id), user_id: Number(row.user_id) }
}

export async function loadSpace(spaceId: number, conn?: any): Promise<{ id: number; type: string; owner_user_id: number | null; settings: any; slug?: string } | null> {
  const db = conn || getPool()
  const [rows] = await db.query(`SELECT id, type, owner_user_id, settings, slug FROM spaces WHERE id = ? LIMIT 1`, [spaceId])
  const row = (rows as any[])[0]
  if (!row) return null
  return {
    id: Number(row.id),
    type: String(row.type || ''),
    owner_user_id: row.owner_user_id == null ? null : Number(row.owner_user_id),
    settings: row.settings,
    slug: row.slug ? String(row.slug) : undefined,
  }
}

export async function loadSiteSettings(conn?: any): Promise<{ require_group_review: boolean; require_channel_review: boolean } | null> {
  const db = conn || getPool()
  try {
    const [rows] = await db.query(`SELECT require_group_review, require_channel_review FROM site_settings WHERE id = 1 LIMIT 1`)
    const row = (rows as any[])[0]
    if (!row) return null
    return {
      require_group_review: Boolean(Number(row.require_group_review)),
      require_channel_review: Boolean(Number(row.require_channel_review)),
    }
  } catch {
    return null
  }
}

// Minimal projection for listing publications of a production
export async function listPublicationsForProduction(productionId: number, conn?: any): Promise<Array<{
  id: number
  space_id: number
  space_name: string
  space_type: string
  status: string
  published_at: string | null
  unpublished_at: string | null
  has_story: boolean
  story_preview: string | null
}>> {
  const db = conn || getPool()
  const [rows] = await db.query(
    `SELECT
        sp.id,
        sp.space_id,
        sp.status,
        sp.published_at,
        sp.unpublished_at,
        s.name AS space_name,
        s.type AS space_type,
        CASE WHEN sp.story_text IS NULL OR TRIM(sp.story_text) = '' THEN 0 ELSE 1 END AS has_story,
        CASE
          WHEN sp.story_text IS NULL OR TRIM(sp.story_text) = '' THEN NULL
          ELSE LEFT(REPLACE(REPLACE(TRIM(sp.story_text), CHAR(13), ''), CHAR(10), ' '), 200)
        END AS story_preview
       FROM space_publications sp
       JOIN spaces s ON s.id = sp.space_id
      WHERE sp.production_id = ?
      ORDER BY sp.published_at DESC, sp.id DESC`,
    [productionId]
  )
  return (rows as any[]).map((r) => ({
    id: Number(r.id),
    space_id: Number(r.space_id),
    space_name: String(r.space_name || ''),
    space_type: String(r.space_type || ''),
    status: String(r.status || ''),
    published_at: r.published_at ? String(r.published_at) : null,
    unpublished_at: r.unpublished_at ? String(r.unpublished_at) : null,
    has_story: Boolean(Number(r.has_story)),
    story_preview: r.story_preview == null ? null : String(r.story_preview),
  }))
}

export async function listPublicationsForUpload(uploadId: number, conn?: any): Promise<Array<{
  id: number
  space_id: number
  space_name: string
  space_type: string
  status: string
  published_at: string | null
  unpublished_at: string | null
  has_story: boolean
  story_preview: string | null
}>> {
  const db = conn || getPool()
  const [rows] = await db.query(
    `SELECT
        sp.id,
        sp.space_id,
        sp.status,
        sp.published_at,
        sp.unpublished_at,
        s.name AS space_name,
        s.type AS space_type,
        CASE WHEN sp.story_text IS NULL OR TRIM(sp.story_text) = '' THEN 0 ELSE 1 END AS has_story,
        CASE
          WHEN sp.story_text IS NULL OR TRIM(sp.story_text) = '' THEN NULL
          ELSE LEFT(REPLACE(REPLACE(TRIM(sp.story_text), CHAR(13), ''), CHAR(10), ' '), 200)
        END AS story_preview
       FROM space_publications sp
       JOIN spaces s ON s.id = sp.space_id
      WHERE sp.upload_id = ?
      ORDER BY sp.published_at DESC, sp.id DESC`,
    [uploadId]
  )
  return (rows as any[]).map((r) => ({
    id: Number(r.id),
    space_id: Number(r.space_id),
    space_name: String(r.space_name || ''),
    space_type: String(r.space_type || ''),
    status: String(r.status || ''),
    published_at: r.published_at ? String(r.published_at) : null,
    unpublished_at: r.unpublished_at ? String(r.unpublished_at) : null,
    has_story: Boolean(Number(r.has_story)),
    story_preview: r.story_preview == null ? null : String(r.story_preview),
  }))
}

export async function listJumpSpacesForProduction(productionId: number, opts: { excludeSpaceIds?: number[] } = {}, conn?: any): Promise<Array<{
  space_id: number
  space_ulid: string | null
  space_name: string
  space_slug: string
  space_type: string
  space_settings: any
}>> {
  const db = conn || getPool()
  const exclude = (opts.excludeSpaceIds || []).filter((n) => Number.isFinite(n) && Number(n) > 0).map((n) => Number(n))
  const excludeSql = exclude.length ? `AND sp.space_id NOT IN (${exclude.map(() => '?').join(',')})` : ''
  const params: any[] = [productionId, ...exclude]
  const [rows] = await db.query(
    `SELECT s.id AS space_id, s.ulid AS space_ulid, s.name AS space_name, s.slug AS space_slug, s.type AS space_type, s.settings AS space_settings
       FROM space_publications sp
       JOIN spaces s ON s.id = sp.space_id
      WHERE sp.production_id = ?
        AND sp.status = 'published'
        AND sp.visible_in_space = 1
        AND s.type IN ('group', 'channel')
        ${excludeSql}
      GROUP BY s.id, s.ulid, s.name, s.slug, s.type
      ORDER BY s.name ASC, s.id ASC`,
    params
  )
  return (rows as any[]).map((r) => ({
    space_id: Number(r.space_id),
    space_ulid: r.space_ulid == null ? null : String(r.space_ulid),
    space_name: String(r.space_name || ''),
    space_slug: String(r.space_slug || ''),
    space_type: String(r.space_type || ''),
    space_settings: r.space_settings,
  }))
}

export async function findLatestCompletedProductionForUpload(uploadId: number, conn?: any): Promise<number | null> {
  const db = conn || getPool()
  const [rows] = await db.query(`SELECT id FROM productions WHERE upload_id = ? AND status = 'completed' ORDER BY id DESC LIMIT 1`, [uploadId])
  const row = (rows as any[])[0]
  return row ? Number(row.id) : null
}

// Convenience: fetch a user's default comments flag
export async function getUserDefaultCommentsEnabled(userId: number, conn?: any): Promise<number> {
  const db = conn || getPool()
  try {
    const [rows] = await db.query(`SELECT default_comments_enabled FROM users WHERE id = ? LIMIT 1`, [userId])
    const row = (rows as any[])[0]
    if (!row) return 1
    return row.default_comments_enabled != null ? Number(row.default_comments_enabled) : 1
  } catch {
    return 1
  }
}

// Convenience: update comments_enabled after creation to avoid widening insert signature
export async function setCommentsEnabled(publicationId: number, enabled: number | null, conn?: any): Promise<void> {
  const db = conn || getPool()
  await db.query(`UPDATE space_publications SET comments_enabled = ? WHERE id = ?`, [enabled, publicationId])
}

// For bulk unpublish: list publication ids for an upload across a set of spaces
export async function listPublicationIdsForUploadSpaces(uploadId: number, spaceIds: number[], conn?: any): Promise<Array<{ id: number; space_id: number }>> {
  if (!spaceIds.length) return []
  const db = conn || getPool()
  const placeholders = spaceIds.map(() => '?').join(',')
  const [rows] = await db.query(
    `SELECT id, space_id FROM space_publications WHERE upload_id = ? AND space_id IN (${placeholders})`,
    [uploadId, ...spaceIds]
  )
  return (rows as any[]).map((r) => ({ id: Number(r.id), space_id: Number(r.space_id) }))
}
