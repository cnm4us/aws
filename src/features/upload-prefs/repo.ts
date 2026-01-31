import { getPool } from '../../db'

export async function listPrefsForUserAndUploadIds(
  userId: number,
  uploadIds: number[]
): Promise<Map<number, { isFavorite: boolean; lastUsedAt: string | null }>> {
  const uid = Number(userId)
  if (!Number.isFinite(uid) || uid <= 0) return new Map()
  const ids = Array.isArray(uploadIds) ? uploadIds : []
  const cleaned = ids.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
  const uniq = Array.from(new Set(cleaned)).slice(0, 500)
  if (!uniq.length) return new Map()

  const db = getPool()
  const [rows] = await db.query(
    `SELECT upload_id, is_favorite, last_used_at
       FROM user_upload_prefs
      WHERE user_id = ?
        AND upload_id IN (?)`,
    [uid, uniq]
  )

  const out = new Map<number, { isFavorite: boolean; lastUsedAt: string | null }>()
  for (const r of rows as any[]) {
    const uploadId = Number(r.upload_id)
    if (!Number.isFinite(uploadId) || uploadId <= 0) continue
    out.set(uploadId, {
      isFavorite: Number(r.is_favorite || 0) === 1,
      lastUsedAt: r.last_used_at == null ? null : String(r.last_used_at),
    })
  }
  return out
}

export async function setFavorite(userId: number, uploadId: number, favorite: boolean): Promise<void> {
  const uid = Number(userId)
  const upId = Number(uploadId)
  if (!Number.isFinite(uid) || uid <= 0) return
  if (!Number.isFinite(upId) || upId <= 0) return

  const db = getPool()
  await db.query(
    `INSERT INTO user_upload_prefs (user_id, upload_id, is_favorite, last_used_at)
     VALUES (?, ?, ?, NULL)
     ON DUPLICATE KEY UPDATE is_favorite = VALUES(is_favorite)`,
    [uid, upId, favorite ? 1 : 0]
  )
}

export async function markUsed(userId: number, uploadId: number): Promise<void> {
  const uid = Number(userId)
  const upId = Number(uploadId)
  if (!Number.isFinite(uid) || uid <= 0) return
  if (!Number.isFinite(upId) || upId <= 0) return

  const db = getPool()
  await db.query(
    `INSERT INTO user_upload_prefs (user_id, upload_id, is_favorite, last_used_at)
     VALUES (?, ?, 0, NOW())
     ON DUPLICATE KEY UPDATE last_used_at = VALUES(last_used_at)`,
    [uid, upId]
  )
}
