import { isMember, loadSpace } from '../../services/spaceMembership'
import { hasActiveSubscription } from '../spaces/repo'
import { can } from '../../security/permissions'
import { PERM } from '../../security/perm'
import { getPool, type Queryable } from '../../db'

export type FeedSelection = {
  cursorPublishedAt?: string | null; cursorId?: number | null; limit: number; userId?: number | null;
  publicationId?: number; publicationIds?:number[]; newerThan?: { ts: string; id: number }; ascending?: boolean;
};
function addSelection(where: string[], params: any[], opts: FeedSelection) {
  if(opts.publicationIds){where.push('sp.id IN (?)');params.push(opts.publicationIds);}
  if (opts.publicationId !== undefined) { where.push('sp.id = ?'); params.push(opts.publicationId); }
  if (opts.newerThan) {
    where.push('(sp.published_at > ? OR (sp.published_at = ? AND sp.id > ?))');
    params.push(opts.newerThan.ts, opts.newerThan.ts, opts.newerThan.id);
  }
}
export async function listGlobalFeedRows(opts: FeedSelection, db: Queryable = getPool()) {
  const params: any[] = []
  const userId = opts.userId ?? null
  // First params are for liked_by_me / commented_by_me / reported_by_me EXISTS() subqueries
  params.push(userId, userId, userId)
  const where: string[] = [
    'sp.visible_in_global = 1',
    "EXISTS (SELECT 1 FROM spaces global_destination WHERE global_destination.id = sp.space_id AND global_destination.slug IN ('global','global-feed'))",
    "sp.visibility <> 'members'",
    "sp.status = 'published'",
    'sp.published_at IS NOT NULL',
    "u.status = 'completed'",
  ]
  if (opts.cursorPublishedAt && opts.cursorId != null) {
    where.push('(sp.published_at < ? OR (sp.published_at = ? AND sp.id < ?))')
    params.push(opts.cursorPublishedAt, opts.cursorPublishedAt, opts.cursorId)
  }
  addSelection(where, params, opts)
  const direction = opts.ascending ? 'ASC' : 'DESC'
  const sql = `
    SELECT
      EXISTS (
        SELECT 1 FROM publication_likes pl
        WHERE pl.publication_id = sp.id AND pl.user_id = ?
      ) AS liked_by_me,
      EXISTS (
        SELECT 1 FROM publication_comments pc
        WHERE pc.publication_id = sp.id AND pc.user_id = ?
      ) AS commented_by_me,
      EXISTS (
        SELECT 1 FROM space_publication_reports spr
        WHERE spr.space_publication_id = sp.id AND spr.reporter_user_id = ?
      ) AS reported_by_me,
      CASE WHEN sp.story_text IS NULL OR TRIM(sp.story_text) = '' THEN 0 ELSE 1 END AS has_story,
      CASE
        WHEN sp.story_text IS NULL OR TRIM(sp.story_text) = '' THEN NULL
        ELSE LEFT(REPLACE(REPLACE(TRIM(sp.story_text), CHAR(13), ''), CHAR(10), ' '), 200)
      END AS story_preview,
      CASE WHEN pcaps.id IS NULL THEN 0 ELSE 1 END AS has_captions,
      sp.id AS publication_id,
      sp.upload_id,
      sp.production_id,
      sp.space_id,
      sp.likes_count,
      sp.comments_count,
      sp.status AS publication_status,
      sp.requested_by,
      sp.approved_by,
      sp.is_primary,
      sp.visibility AS publication_visibility,
      sp.distribution_flags,
      sp.published_at,
      sp.unpublished_at,
      sp.created_at AS publication_created_at,
      sp.updated_at AS publication_updated_at,
      u.id AS upload_id,
      u.s3_bucket,
      u.s3_key,
      u.original_filename,
      u.modified_filename,
      u.description AS upload_description,
      u.content_type,
      u.size_bytes,
      u.width,
      u.height,
      u.duration_seconds,
      u.status AS upload_status,
      u.etag,
      u.mediaconvert_job_id,
      COALESCE(p.output_prefix, u.output_prefix) AS output_prefix,
      u.asset_uuid,
      u.date_ymd,
      u.profile,
      u.orientation,
      u.created_at AS upload_created_at,
      u.uploaded_at,
      u.user_id AS upload_user_id,
      u.space_id AS upload_space_id,
      u.origin_space_id,
      owner.id AS owner_id,
      owner.display_name AS owner_display_name,
      owner.email AS owner_email,
      prof.avatar_url AS owner_avatar_url,
      p.id AS production_id_resolved,
      p.ulid AS production_ulid
    FROM space_publications sp
    JOIN uploads u ON u.id = sp.upload_id
    LEFT JOIN productions p ON p.id = sp.production_id
    LEFT JOIN production_captions pcaps ON pcaps.production_id = sp.production_id AND pcaps.status = 'ready'
    LEFT JOIN users owner ON owner.id = u.user_id
    LEFT JOIN profiles prof ON prof.user_id = owner.id
    WHERE ${where.join(' AND ')}
    ORDER BY sp.published_at ${direction}, sp.id ${direction}
    LIMIT ?
  `
  params.push(opts.limit)
  const [rows] = await db.query(sql, params)
  return rows as any[]
}

export async function getGlobalFeedPinnedRowByProductionUlid(
  opts: { productionUlid: string; userId?: number | null }
) {
  const db = getPool()
  const userId = opts.userId ?? null
  const params: any[] = [userId, userId, userId, String(opts.productionUlid)]
  const where: string[] = [
    'sp.visible_in_global = 1',
    "EXISTS (SELECT 1 FROM spaces global_destination WHERE global_destination.id = sp.space_id AND global_destination.slug IN ('global','global-feed'))",
    "sp.visibility <> 'members'",
    "sp.status = 'published'",
    'sp.published_at IS NOT NULL',
    "u.status = 'completed'",
    'p.ulid = ?',
  ]
  const sql = `
    SELECT
      EXISTS (
        SELECT 1 FROM publication_likes pl
        WHERE pl.publication_id = sp.id AND pl.user_id = ?
      ) AS liked_by_me,
      EXISTS (
        SELECT 1 FROM publication_comments pc
        WHERE pc.publication_id = sp.id AND pc.user_id = ?
      ) AS commented_by_me,
      EXISTS (
        SELECT 1 FROM space_publication_reports spr
        WHERE spr.space_publication_id = sp.id AND spr.reporter_user_id = ?
      ) AS reported_by_me,
      CASE WHEN sp.story_text IS NULL OR TRIM(sp.story_text) = '' THEN 0 ELSE 1 END AS has_story,
      CASE
        WHEN sp.story_text IS NULL OR TRIM(sp.story_text) = '' THEN NULL
        ELSE LEFT(REPLACE(REPLACE(TRIM(sp.story_text), CHAR(13), ''), CHAR(10), ' '), 200)
      END AS story_preview,
      CASE WHEN pcaps.id IS NULL THEN 0 ELSE 1 END AS has_captions,
      sp.id AS publication_id,
      sp.upload_id,
      sp.production_id,
      sp.space_id,
      sp.likes_count,
      sp.comments_count,
      sp.status AS publication_status,
      sp.requested_by,
      sp.approved_by,
      sp.is_primary,
      sp.visibility AS publication_visibility,
      sp.distribution_flags,
      sp.published_at,
      sp.unpublished_at,
      sp.created_at AS publication_created_at,
      sp.updated_at AS publication_updated_at,
      u.id AS upload_id,
      u.s3_bucket,
      u.s3_key,
      u.original_filename,
      u.modified_filename,
      u.description AS upload_description,
      u.content_type,
      u.size_bytes,
      u.width,
      u.height,
      u.duration_seconds,
      u.status AS upload_status,
      u.etag,
      u.mediaconvert_job_id,
      COALESCE(p.output_prefix, u.output_prefix) AS output_prefix,
      u.asset_uuid,
      u.date_ymd,
      u.profile,
      u.orientation,
      u.created_at AS upload_created_at,
      u.uploaded_at,
      u.user_id AS upload_user_id,
      u.space_id AS upload_space_id,
      u.origin_space_id,
      owner.id AS owner_id,
      owner.display_name AS owner_display_name,
      owner.email AS owner_email,
      prof.avatar_url AS owner_avatar_url,
      p.id AS production_id_resolved,
      p.ulid AS production_ulid
    FROM space_publications sp
    JOIN uploads u ON u.id = sp.upload_id
    LEFT JOIN productions p ON p.id = sp.production_id
    LEFT JOIN production_captions pcaps ON pcaps.production_id = sp.production_id AND pcaps.status = 'ready'
    LEFT JOIN users owner ON owner.id = u.user_id
    LEFT JOIN profiles prof ON prof.user_id = owner.id
    WHERE ${where.join(' AND ')}
    ORDER BY sp.published_at DESC, sp.id DESC
    LIMIT 1
  `
  const [rows] = await db.query(sql, params)
  return (rows as any[])[0] || null
}

export async function getSpaceFeedPinnedRowByProductionUlid(
  spaceId: number,
  opts: { productionUlid: string; userId?: number | null }
) {
  const db = getPool()
  const userId = opts.userId ?? null
  const params: any[] = [userId, userId, userId, spaceId, String(opts.productionUlid)]
  const where: string[] = [
    'sp.space_id = ?',
    'sp.visible_in_space = 1',
    await membersVisibilityClause(spaceId, userId),
    "sp.status = 'published'",
    'sp.published_at IS NOT NULL',
    "u.status = 'completed'",
    'p.ulid = ?',
  ]
  const sql = `
    SELECT
      EXISTS (
        SELECT 1 FROM publication_likes pl
        WHERE pl.publication_id = sp.id AND pl.user_id = ?
      ) AS liked_by_me,
      EXISTS (
        SELECT 1 FROM publication_comments pc
        WHERE pc.publication_id = sp.id AND pc.user_id = ?
      ) AS commented_by_me,
      EXISTS (
        SELECT 1 FROM space_publication_reports spr
        WHERE spr.space_publication_id = sp.id AND spr.reporter_user_id = ?
      ) AS reported_by_me,
      CASE WHEN sp.story_text IS NULL OR TRIM(sp.story_text) = '' THEN 0 ELSE 1 END AS has_story,
      CASE
        WHEN sp.story_text IS NULL OR TRIM(sp.story_text) = '' THEN NULL
        ELSE LEFT(REPLACE(REPLACE(TRIM(sp.story_text), CHAR(13), ''), CHAR(10), ' '), 200)
      END AS story_preview,
      CASE WHEN pcaps.id IS NULL THEN 0 ELSE 1 END AS has_captions,
      sp.id AS publication_id,
      sp.upload_id,
      sp.production_id,
      sp.space_id,
      sp.likes_count,
      sp.comments_count,
      sp.status AS publication_status,
      sp.requested_by,
      sp.approved_by,
      sp.is_primary,
      sp.visibility AS publication_visibility,
      sp.distribution_flags,
      sp.published_at,
      sp.unpublished_at,
      sp.created_at AS publication_created_at,
      sp.updated_at AS publication_updated_at,
      u.id AS upload_id,
      u.s3_bucket,
      u.s3_key,
      u.original_filename,
      u.modified_filename,
      u.description AS upload_description,
      u.content_type,
      u.size_bytes,
      u.width,
      u.height,
      u.duration_seconds,
      u.status AS upload_status,
      u.etag,
      u.mediaconvert_job_id,
      COALESCE(p.output_prefix, u.output_prefix) AS output_prefix,
      u.asset_uuid,
      u.date_ymd,
      u.profile,
      u.orientation,
      u.created_at AS upload_created_at,
      u.uploaded_at,
      u.user_id AS upload_user_id,
      u.space_id AS upload_space_id,
      u.origin_space_id,
      owner.id AS owner_id,
      owner.display_name AS owner_display_name,
      owner.email AS owner_email,
      prof.avatar_url AS owner_avatar_url,
      p.id AS production_id_resolved,
      p.ulid AS production_ulid
    FROM space_publications sp
    JOIN uploads u ON u.id = sp.upload_id
    LEFT JOIN productions p ON p.id = sp.production_id
    LEFT JOIN production_captions pcaps ON pcaps.production_id = sp.production_id AND pcaps.status = 'ready'
    LEFT JOIN users owner ON owner.id = u.user_id
    LEFT JOIN profiles prof ON prof.user_id = owner.id
    WHERE ${where.join(' AND ')}
    ORDER BY sp.published_at DESC, sp.id DESC
    LIMIT 1
  `
  const [rows] = await db.query(sql, params)
  return (rows as any[])[0] || null
}

export async function listSpaceFeedRows(
  spaceId: number,
  opts: FeedSelection,
  db: Queryable = getPool()
) {
  const userId = opts.userId ?? null
  const params: any[] = [userId, userId, userId, spaceId]
  const where: string[] = [
    'sp.space_id = ?',
    'sp.visible_in_space = 1',
    await membersVisibilityClause(spaceId, userId, db),
    "sp.status = 'published'",
    'sp.published_at IS NOT NULL',
    "u.status = 'completed'",
  ]
  if (opts.cursorPublishedAt && opts.cursorId != null) {
    where.push('(sp.published_at < ? OR (sp.published_at = ? AND sp.id < ?))')
    params.push(opts.cursorPublishedAt, opts.cursorPublishedAt, opts.cursorId)
  }
  addSelection(where, params, opts)
  const direction = opts.ascending ? 'ASC' : 'DESC'
  const sql = `
    SELECT
      EXISTS (
        SELECT 1 FROM publication_likes pl
        WHERE pl.publication_id = sp.id AND pl.user_id = ?
      ) AS liked_by_me,
      EXISTS (
        SELECT 1 FROM publication_comments pc
        WHERE pc.publication_id = sp.id AND pc.user_id = ?
      ) AS commented_by_me,
      EXISTS (
        SELECT 1 FROM space_publication_reports spr
        WHERE spr.space_publication_id = sp.id AND spr.reporter_user_id = ?
      ) AS reported_by_me,
      CASE WHEN sp.story_text IS NULL OR TRIM(sp.story_text) = '' THEN 0 ELSE 1 END AS has_story,
      CASE
        WHEN sp.story_text IS NULL OR TRIM(sp.story_text) = '' THEN NULL
        ELSE LEFT(REPLACE(REPLACE(TRIM(sp.story_text), CHAR(13), ''), CHAR(10), ' '), 200)
      END AS story_preview,
      CASE WHEN pcaps.id IS NULL THEN 0 ELSE 1 END AS has_captions,
      sp.id AS publication_id,
      sp.upload_id,
      sp.production_id,
      sp.space_id,
      sp.likes_count,
      sp.comments_count,
      sp.status AS publication_status,
      sp.requested_by,
      sp.approved_by,
      sp.is_primary,
      sp.visibility AS publication_visibility,
      sp.distribution_flags,
      sp.published_at,
      sp.unpublished_at,
      sp.created_at AS publication_created_at,
      sp.updated_at AS publication_updated_at,
      u.id AS upload_id,
      u.s3_bucket,
      u.s3_key,
      u.original_filename,
      u.modified_filename,
      u.description AS upload_description,
      u.content_type,
      u.size_bytes,
      u.width,
      u.height,
      u.duration_seconds,
      u.status AS upload_status,
      u.etag,
      u.mediaconvert_job_id,
      COALESCE(p.output_prefix, u.output_prefix) AS output_prefix,
      u.asset_uuid,
      u.date_ymd,
      u.profile,
      u.orientation,
      u.created_at AS upload_created_at,
      u.uploaded_at,
      u.user_id AS upload_user_id,
      u.space_id AS upload_space_id,
      u.origin_space_id,
      owner.id AS owner_id,
      owner.display_name AS owner_display_name,
      owner.email AS owner_email,
      prof.avatar_url AS owner_avatar_url,
      p.id AS production_id_resolved,
      p.ulid AS production_ulid
    FROM space_publications sp
    JOIN uploads u ON u.id = sp.upload_id
    LEFT JOIN productions p ON p.id = sp.production_id
    LEFT JOIN production_captions pcaps ON pcaps.production_id = sp.production_id AND pcaps.status = 'ready'
    LEFT JOIN users owner ON owner.id = u.user_id
    LEFT JOIN profiles prof ON prof.user_id = owner.id
    WHERE ${where.join(' AND ')}
    ORDER BY sp.published_at ${direction}, sp.id ${direction}
    LIMIT ?
  `
  params.push(opts.limit)
  const [rows] = await db.query(sql, params)
  return rows as any[]
}

async function membersVisibilityClause(spaceId: number, userId: number | null, db: Queryable = getPool()) {
  let allowed = false;
  if (userId) {
    const space = await loadSpace(spaceId, db);
    allowed = space?.owner_user_id === userId || await isMember(db, spaceId, userId)
      || await hasActiveSubscription(spaceId, userId, db) || await can(userId, PERM.VIDEO_DELETE_ANY, {db});
  }
  return allowed ? '1=1' : "sp.visibility <> 'members'";
}
