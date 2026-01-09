import { getPool } from '../../db'

export async function listForUser(userId: number) {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT p.*,
            u.original_filename,
            u.modified_filename,
            u.description AS upload_description,
            u.status AS upload_status,
            u.size_bytes,
            u.width,
            u.height,
            u.created_at AS upload_created_at,
            u.s3_key AS upload_s3_key,
            u.profile AS upload_profile,
            COALESCE(p.output_prefix, u.output_prefix) AS upload_output_prefix
       FROM productions p
       LEFT JOIN uploads u ON u.id = p.upload_id
      WHERE p.user_id = ?
      ORDER BY p.created_at DESC
      LIMIT 200`,
    [userId]
  )
  return rows as any[]
}

export async function getWithUpload(id: number) {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT p.*,
            u.original_filename,
            u.modified_filename,
            u.description AS upload_description,
            u.status AS upload_status,
            u.size_bytes,
            u.width,
            u.height,
            u.created_at AS upload_created_at,
            u.s3_key AS upload_s3_key,
            u.profile AS upload_profile,
            COALESCE(p.output_prefix, u.output_prefix) AS upload_output_prefix
       FROM productions p
       LEFT JOIN uploads u ON u.id = p.upload_id
      WHERE p.id = ?
      LIMIT 1`,
    [id]
  )
  return (rows as any[])[0] || null
}

export async function loadUpload(uploadId: number) {
  const db = getPool()
  const [rows] = await db.query(`SELECT * FROM uploads WHERE id = ? LIMIT 1`, [uploadId])
  return (rows as any[])[0] || null
}

export async function updateProductionNameIfEmpty(id: number, name: string) {
  const db = getPool()
  await db.query(`UPDATE productions SET name = ? WHERE id = ? AND (name IS NULL OR name = '')`, [name, id])
}

export async function countSpacePublicationsForProduction(productionId: number): Promise<number> {
  const db = getPool()
  // Only count "active" publications that should block deleting a production.
  // Unpublished/rejected entries are safe to leave as history and should not block deletion.
  const [rows] = await db.query(
    `SELECT COUNT(*) AS c
       FROM space_publications
      WHERE production_id = ?
        AND status NOT IN ('unpublished','rejected')`,
    [productionId]
  )
  return Number((rows as any[])[0]?.c || 0)
}

export async function listSummariesForUploadIds(userId: number, uploadIds: number[]) {
  const ids = Array.isArray(uploadIds) ? uploadIds.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0) : []
  if (!ids.length) return []
  const db = getPool()
  const placeholders = ids.map(() => '?').join(', ')
  const [rows] = await db.query(
    `SELECT id, upload_id, name, status, created_at, started_at, completed_at
       FROM productions
      WHERE user_id = ?
        AND upload_id IN (${placeholders})
      ORDER BY created_at DESC`,
    [Number(userId), ...ids]
  )
  return rows as any[]
}

export async function getDefaultStory(productionId: number): Promise<{ text: string | null; updatedAt: string | null } | null> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT default_story_text, default_story_updated_at
       FROM productions
      WHERE id = ?
      LIMIT 1`,
    [productionId]
  )
  const row = (rows as any[])[0]
  if (!row) return null
  return {
    text: row.default_story_text == null ? null : String(row.default_story_text),
    updatedAt: row.default_story_updated_at == null ? null : String(row.default_story_updated_at),
  }
}

export async function setDefaultStory(productionId: number, storyText: string | null): Promise<void> {
  const db = getPool()
  const txt = storyText == null ? null : String(storyText)
  await db.query(
    `UPDATE productions
        SET default_story_text = ?,
            default_story_updated_at = CASE WHEN ? IS NULL THEN NULL ELSE NOW() END,
            updated_at = NOW()
      WHERE id = ?`,
    [txt, txt, productionId]
  )
}

export async function propagateDefaultStoryToPublications(productionId: number, storyText: string | null): Promise<void> {
  const db = getPool()
  const txt = storyText == null ? null : String(storyText)
  await db.query(
    `UPDATE space_publications
        SET story_text = ?,
            story_updated_at = CASE WHEN ? IS NULL THEN NULL ELSE NOW() END,
            updated_at = NOW()
      WHERE production_id = ?
        AND story_source = 'production'`,
    [txt, txt, productionId]
  )
}
