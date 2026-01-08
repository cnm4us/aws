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
